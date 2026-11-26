/*
 *
 *  Copyright (C) 2024 Per Rosengren
 *  This file is part of se.forint.pelle.viessmann project.
 *
 *  se.forint.pelle.viessmann project is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  se.forint.pelle.viessmann project is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with se.forint.pelle.viessmann project.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

// @ts-check

'use strict';

// The generic Flow cards for power users: read any feature value of the device, and run any of
// its commands, by Viessmann name, with autocomplete from what the device itself reports.
//
// Reading costs no API call for the features every poll requests: the device remembers the
// features of each response (recordFeatures). A feature outside the poll is read from the API
// on demand, one feature at a time, and reused until it is older than the poll interval (so a
// Flow that reads it often costs at most one call per poll interval). The autocomplete lists
// every feature of the device from its last complete (unfiltered) response: the device's own
// extended poll, or a read made for the autocomplete, reused for an hour. A read that is already
// running is shared (a complete one also with reads of single features), so queries that overlap
// while someone types cost one call, and a device never has two reads of the same features at a
// time.
//
// Paths are circuit-normalized (`heating.circuits.0.*`) inside the app, like everywhere else;
// the autocomplete shows them with the device's real circuit.

const { resolveCircuitPath, normalizeCircuitFeatures } = require('./heatingCircuit');
const { checkFeatureCommand, sendFeatureCommand } = require('./commands');
const { userError } = require('./userErrors');
const { takeWrite } = require('./writeLimits');

const COMPLETE_READ_MAX_AGE_MS = 60 * 60 * 1000;
const DEFAULT_MAX_AGE_MS = 3 * 60 * 1000;
const MAX_RESULTS = 50;

/**
 * @typedef {{ feature: string, isEnabled?: boolean, properties?: Record<string, any>,
 *   commands?: Record<string, any> }} Feature
 * @typedef {{ features: Map<string, { feature: Feature, at: number }>, completeAt: number,
 *   reading: Map<string, Promise<void>> }} FeatureCache
 * @typedef {import('./commands').CommandDevice & import('./userErrors').MessageDevice & {
 *   _featureCache?: FeatureCache,
 *   oAuth2Client: { getFeatures: (request: Record<string, any>) => Promise<any>,
 *     executeCommand: (request: Record<string, any>) => Promise<any> },
 *   driver?: { _calculatePollInterval?: () => number },
 * }} FeatureDevice
 * @typedef {{ name: string, description?: string, path: string, property?: string, command?: string }} Choice
 */

/**
 * @param {FeatureDevice} device
 * @returns {FeatureCache}
 */
function cacheOf(device) {
  if (!device._featureCache) device._featureCache = { features: new Map(), completeAt: 0, reading: new Map() };
  return device._featureCache;
}

/**
 * Remembers the features of a (circuit-normalized) response. `complete` marks an unfiltered
 * response, which lists every feature of the device.
 * @param {FeatureDevice} device
 * @param {{ data?: any[] }} response
 * @param {{ complete?: boolean, now?: number }} [options]
 */
function recordFeatures(device, response, { complete = false, now = Date.now() } = {}) {
  const cache = cacheOf(device);
  for (const feature of Array.isArray(response?.data) ? response.data : []) {
    if (feature && typeof feature.feature === 'string') cache.features.set(feature.feature, { feature, at: now });
  }
  if (complete) cache.completeAt = now;
}

/**
 * Reads features from the API (all of them, or the given circuit-normalized paths) and
 * remembers them. While a read of the same features is running, its result is shared instead
 * of starting another one.
 * @param {FeatureDevice} device
 * @param {string[]} [paths]
 * @returns {Promise<void>}
 */
function fetchFeatures(device, paths) {
  const filter = paths ? paths.map((path) => resolveCircuitPath(path, device._heatingCircuitId)).join(',') : undefined;
  const { reading } = cacheOf(device);
  const key = filter ?? '*';
  // A complete read that is running already brings these features too
  const running = reading.get(key) || reading.get('*');
  if (running) return running;
  const read = (async () => {
    try {
      const response = await device.oAuth2Client.getFeatures({
        installationId: device._installationId,
        gatewaySerial: device._gatewaySerial,
        deviceId: device._deviceId,
        filter,
      });
      recordFeatures(device, normalizeCircuitFeatures(response, device._heatingCircuitId), { complete: !paths });
    } finally {
      reading.delete(key);
    }
  })();
  reading.set(key, read);
  return read;
}

/**
 * Every feature of the device, from a complete response at most an hour old.
 * @param {FeatureDevice} device
 * @param {number} [now]
 * @returns {Promise<Feature[]>}
 */
async function completeFeatures(device, now = Date.now()) {
  if (now - cacheOf(device).completeAt > COMPLETE_READ_MAX_AGE_MS) await fetchFeatures(device);
  return [...cacheOf(device).features.values()].map((entry) => entry.feature);
}

/**
 * True when every word of the query appears in the text (case-insensitive).
 * @param {string} text
 * @param {string} query
 */
function matches(text, query) {
  const haystack = text.toLowerCase();
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((word) => haystack.includes(word));
}

/**
 * A property value as it is shown in a list.
 * @param {{ value?: any, unit?: string } | undefined} property
 */
function describeValue(property) {
  const value = property?.value;
  const text = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
  const shortened = text.length > 60 ? `${text.slice(0, 57)}...` : text;
  return property?.unit ? `${shortened} ${property.unit}` : shortened;
}

/**
 * The feature values to choose from: `numbers` lists only numbers.
 * @param {FeatureDevice} device
 * @param {string} query
 * @param {{ numbers?: boolean }} [options]
 * @returns {Promise<Choice[]>}
 */
async function valueChoices(device, query, { numbers = false } = {}) {
  /** @type {Choice[]} */
  const choices = [];
  for (const feature of await completeFeatures(device)) {
    if (!feature.isEnabled || !feature.properties) continue;
    for (const [property, described] of Object.entries(feature.properties)) {
      if (!described || typeof described !== 'object' || !('value' in described)) continue;
      if (numbers ? typeof described.value !== 'number' : (typeof described.value === 'object' && described.value !== null)) continue;
      const realPath = resolveCircuitPath(feature.feature, device._heatingCircuitId);
      const name = property === 'value' ? realPath : `${realPath} · ${property}`;
      if (!matches(name, query)) continue;
      choices.push({
        name, description: describeValue(described), path: feature.feature, property,
      });
    }
  }
  return choices.sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_RESULTS);
}

/**
 * A command's parameters, as they are shown in a list.
 * @param {Record<string, any> | undefined} params
 */
function describeParameters(params) {
  const entries = Object.entries(params || {});
  if (entries.length === 0) return '{}';
  return entries.map(([name, param]) => {
    const constraints = param?.constraints || {};
    let range = '';
    if (Array.isArray(constraints.enum)) range = constraints.enum.join('|');
    else if (constraints.min !== undefined || constraints.max !== undefined) {
      range = `${constraints.min ?? ''}–${constraints.max ?? ''}${constraints.stepping ? ` step ${constraints.stepping}` : ''}`;
    }
    return `${name}: ${param?.type || '?'}${range ? ` ${range}` : ''}${param?.required ? '' : ' (optional)'}`;
  }).join(', ');
}

/**
 * The commands to choose from: every executable command in the device's command metadata.
 * @param {FeatureDevice} device
 * @param {string} query
 * @returns {Choice[]}
 */
function commandChoices(device, query) {
  /** @type {Choice[]} */
  const choices = [];
  for (const [path, commands] of Object.entries(device._commands || {})) {
    for (const [command, descriptor] of Object.entries(commands || {})) {
      if (!descriptor || descriptor.isExecutable === false) continue;
      const name = `${resolveCircuitPath(path, device._heatingCircuitId)} · ${command}`;
      if (!matches(name, query)) continue;
      choices.push({
        name, description: describeParameters(descriptor.params), path, command,
      });
    }
  }
  return choices.sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_RESULTS);
}

/**
 * A feature property's current value: from the last poll when it is recent enough, otherwise
 * read from the API (that feature only).
 * @param {FeatureDevice} device
 * @param {Choice | undefined} choice
 * @param {number} [now]
 * @returns {Promise<any>}
 */
async function readValue(device, choice, now = Date.now()) {
  if (!choice?.path || !choice.property) throw userError(device, 'choose_from_list');
  const pollInterval = device.driver?._calculatePollInterval?.();
  const maxAge = Number.isFinite(pollInterval) ? /** @type {number} */ (pollInterval) * 1.5 : DEFAULT_MAX_AGE_MS;
  let entry = cacheOf(device).features.get(choice.path);
  if (!entry || now - entry.at > maxAge) {
    await fetchFeatures(device, [choice.path]);
    entry = cacheOf(device).features.get(choice.path);
  }
  const realPath = resolveCircuitPath(choice.path, device._heatingCircuitId);
  if (!entry?.feature.isEnabled || !entry.feature.properties) throw userError(device, 'feature_not_reported', { feature: realPath });
  const property = entry.feature.properties[choice.property];
  if (!property || !('value' in property)) {
    throw userError(device, 'property_not_reported', { feature: realPath, property: choice.property });
  }
  if (property.value === null || property.value === undefined) throw userError(device, 'value_unknown');
  return property.value;
}

/**
 * The number token of the read card; throws when the value is not a number.
 * @param {FeatureDevice} device
 * @param {Choice | undefined} choice
 * @returns {Promise<{ number: number }>}
 */
async function readNumber(device, choice) {
  const value = await readValue(device, choice);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw userError(device, 'not_a_number', { feature: resolveCircuitPath(choice?.path || '', device._heatingCircuitId) });
  }
  return { number: value };
}

/**
 * The text token of the read card: strings as they are, numbers and booleans as text, lists
 * and objects as JSON.
 * @param {FeatureDevice} device
 * @param {Choice | undefined} choice
 * @returns {Promise<{ text: string }>}
 */
async function readText(device, choice) {
  const value = await readValue(device, choice);
  return { text: typeof value === 'object' ? JSON.stringify(value) : String(value) };
}

/**
 * Parses the parameters argument: a JSON object, or empty for none.
 * @param {FeatureDevice} device
 * @param {string | undefined} text
 * @returns {Record<string, any>}
 */
function parseParameters(device, text) {
  const trimmed = String(text ?? '').trim();
  if (trimmed === '') return {};
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw userError(device, 'invalid_parameters');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw userError(device, 'invalid_parameters');
  return parsed;
}

/**
 * Runs a command of the device: checked against its command metadata (no unknown parameters
 * either), limited per device, then sent to the device's heating circuit.
 * @param {FeatureDevice} device
 * @param {Choice | undefined} choice
 * @param {string | undefined} parametersText
 */
async function runCommand(device, choice, parametersText) {
  if (!choice?.path || !choice.command) throw userError(device, 'choose_from_list');
  const parameters = parseParameters(device, parametersText);
  if (!device._commands) throw userError(device, 'no_command_metadata');
  const known = device._commands[choice.path]?.[choice.command]?.params || {};
  const unknown = Object.keys(parameters).find((name) => !(name in known));
  if (unknown !== undefined) throw userError(device, 'unknown_parameter', { parameter: unknown });
  checkFeatureCommand(device, choice.path, choice.command, parameters);
  takeWrite(device, 'command');
  await sendFeatureCommand(device, choice.path, choice.command, parameters);
}

module.exports = {
  COMPLETE_READ_MAX_AGE_MS,
  recordFeatures,
  completeFeatures,
  valueChoices,
  commandChoices,
  readValue,
  readNumber,
  readText,
  parseParameters,
  runCommand,
};
