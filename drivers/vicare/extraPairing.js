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

// Adding extra devices (extraProfiles.js): which Viessmann devices of the account can have them
// (heating devices for heating circuits and hot water, the ViCare Smart Climate device for rooms),
// and the entries of the device list: one per enabled heating circuit, one for hot water, one per
// room with a temperature sensor, each named clearly, with what the device stores. Pure;
// extraDriver.js reads the installations and each Viessmann device's features once.

const { modelName, deviceName } = require('./pairSession');
const { readDeviceMetadata } = require('./deviceMetadata');
const { enabledCircuits, featureEntries } = require('./heatingCircuit');
const { isConnected } = require('./featureMapper');
const { pollingKey } = require('./pollPlan');
const { profileOf, capabilitiesFor, optionsFor } = require('./extraProfiles');

/** @typedef {import('./extraProfiles').ExtraKind} ExtraKind */
/** @typedef {import('./extraProfiles').ExtraContext} ExtraContext */
/** @typedef {(key: string, tags?: Record<string, unknown>) => string} Translate */

// The driver of each kind (frozen once released: devices belong to their driver)
const EXTRA_DRIVERS = { circuit: 'heating-circuit', hotWater: 'hot-water', room: 'room' };
// The Viessmann device type each kind is listed for
const SOURCE_TYPES = { circuit: 'heating', hotWater: 'heating', room: 'roomControl' };

// A circuit name that only says which circuit it is (Viessmann's or the anonymized default)
const DEFAULT_CIRCUIT_NAME = /^heating circuit \d+$/i;

/**
 * The `data.id` of an extra device. Frozen once released (CONTRIBUTING.md, ground rule 1): the
 * Viessmann device's id (as the ViCare device's), the kind and the circuit or room.
 * @param {ExtraKind} kind
 * @param {{ installationId: unknown, gatewaySerial: unknown, deviceId: unknown }} ids
 * @param {string} [part] the heating circuit or the room
 * @returns {string}
 */
function extraDataId(kind, ids, part) {
  const key = pollingKey(ids);
  if (kind === 'circuit') return `${key}-circuit-${part}`;
  if (kind === 'hotWater') return `${key}-hotwater`;
  return `${key}-room-${part}`;
}

/**
 * The Viessmann devices of the account that can have extra devices of this kind, with their
 * gateway, in the order of the installations response.
 * @param {ExtraKind} kind
 * @param {any} installations the installations response
 * @returns {{ gateway: any, device: any }[]}
 */
function sourceDevices(kind, installations) {
  const list = Array.isArray(installations?.data) ? installations.data : [];
  return list.flatMap((installation) => (installation?.gateways || [])
    .flatMap((gateway) => (gateway?.devices || [])
      .filter((device) => device?.deviceType === SOURCE_TYPES[kind])
      .map((device) => ({ gateway, device }))));
}

/**
 * Only what the extra device needs of the Viessmann device's metadata: its features, limits and
 * commands on the paths of its values.
 * @param {ExtraKind} kind
 * @param {ExtraContext} context
 * @returns {ExtraContext}
 */
function trimmed(kind, context) {
  const paths = new Set(profileOf(kind, context).flatMap((capability) => capability.paths));
  /** @param {Record<string, any> | undefined} perPath */
  const only = (perPath) => Object.fromEntries(Object.entries(perPath || {}).filter(([path]) => paths.has(path)));
  return {
    ...context,
    features: (context.features || []).filter((path) => paths.has(path)),
    constraints: only(context.constraints),
    commandMetadata: only(context.commandMetadata),
  };
}

/**
 * The name of the heating device in an extra device's name: its model, or what it is.
 * @param {any} device the device in the installations response
 * @param {Translate} t
 * @returns {string}
 */
function heatingDeviceName(device, t) {
  return modelName(device?.modelId) || deviceName(device, [], t);
}

/**
 * The name a heating circuit has in the Viessmann app, when it is more than "Heating circuit N".
 * @param {any[]} data the features
 * @param {string} circuitId
 * @returns {string | undefined}
 */
function circuitName(data, circuitId) {
  const name = [`heating.circuits.${circuitId}`, `heating.circuits.${circuitId}.name`]
    .map((path) => data.find((feature) => feature.feature === path)?.properties?.name?.value)
    .find((value) => typeof value === 'string' && value.trim() !== '');
  return name && !DEFAULT_CIRCUIT_NAME.test(name.trim()) ? name.trim() : undefined;
}

/**
 * A device list entry.
 * @param {ExtraKind} kind
 * @param {{ gateway: any, device: any }} source
 * @param {ExtraContext} context
 * @param {{ name: string, part?: string, version: string }} entry
 */
function entryOf(kind, { gateway, device }, context, { name, part, version }) {
  const ids = { installationId: gateway.installationId, gatewaySerial: gateway.serial, deviceId: device.id };
  const {
    features, constraints, commandMetadata, operatingModes, heatingCircuitId, roomId,
  } = context;
  return {
    name,
    data: { id: extraDataId(kind, ids, part) },
    capabilities: capabilitiesFor(kind, context),
    capabilitiesOptions: optionsFor(kind, context),
    store: {
      ...ids,
      roles: Array.isArray(device.roles) ? device.roles : [],
      ...(kind === 'room' ? { roomId } : { heatingCircuitId }),
      features,
      constraints,
      commandMetadata,
      ...(kind === 'circuit' ? { operatingModes } : {}),
      version,
    },
  };
}

/**
 * The heating circuits of a heating device that can be a thermostat: every enabled circuit with
 * a set point or an operating mode.
 * @param {{ gateway: any, device: any }} source
 * @param {{ data: any[] }} rawResponse the device's (unfiltered) features
 * @param {{ t: Translate, version: string }} options
 */
function circuitEntries(source, rawResponse, { t, version }) {
  const data = featureEntries(rawResponse?.data);
  return enabledCircuits(data).flatMap((circuitId) => {
    const context = trimmed('circuit', readDeviceMetadata({ data }, circuitId));
    const capabilities = capabilitiesFor('circuit', context);
    if (!capabilities.includes('target_temperature') && !capabilities.includes('thermostat_mode')) return [];
    const ownName = circuitName(data, circuitId);
    const name = t('pair.extra.circuit_name', { model: heatingDeviceName(source.device, t), circuit: circuitId })
      + (ownName ? ` (${ownName})` : '');
    return [entryOf('circuit', source, context, { name, part: circuitId, version })];
  });
}

/**
 * The hot water of a heating device, when it has a hot water set point.
 * @param {{ gateway: any, device: any }} source
 * @param {{ data: any[] }} rawResponse
 * @param {{ t: Translate, version: string }} options
 */
function hotWaterEntries(source, rawResponse, { t, version }) {
  const data = featureEntries(rawResponse?.data);
  const context = trimmed('hotWater', readDeviceMetadata({ data }, 'auto'));
  if (!capabilitiesFor('hotWater', context).includes('target_temperature')) return [];
  const name = t('pair.extra.hot_water_name', { model: heatingDeviceName(source.device, t) });
  return [entryOf('hotWater', source, context, { name, version })];
}

/**
 * The rooms of a ViCare Smart Climate device that report a temperature.
 * @param {{ gateway: any, device: any }} source
 * @param {{ data: any[] }} rawResponse
 * @param {{ t: Translate, version: string }} options
 */
function roomEntries(source, rawResponse, { t, version }) {
  const data = featureEntries(rawResponse?.data);
  const connected = data.filter((feature) => isConnected(feature)).map((feature) => feature.feature);
  const rooms = connected.map((path) => path.match(/^rooms\.(\d+)\.sensors\.temperature$/)?.[1])
    .filter((/** @type {string | undefined} */ roomId) => roomId !== undefined);
  return rooms.map((roomId) => {
    const context = trimmed('room', { roomId: String(roomId), features: connected });
    // Rooms are numbered from 1, as people count them; the id stays the API's
    const name = t('pair.extra.room_name', { room: Number(roomId) + 1 });
    return entryOf('room', source, context, { name, part: String(roomId), version });
  });
}

const ENTRIES = { circuit: circuitEntries, hotWater: hotWaterEntries, room: roomEntries };

/**
 * The entries with unique names: a second one of the same name gets a number (two heating
 * devices of the same model in one account), as the ViCare device's names do.
 * @param {any[]} entries
 * @returns {any[]}
 */
function withUniqueNames(entries) {
  /** @type {string[]} */
  const taken = [];
  return entries.map((entry) => {
    let { name } = entry;
    for (let number = 2; taken.includes(name); number++) name = `${entry.name} ${number}`;
    taken.push(name);
    return name === entry.name ? entry : { ...entry, name };
  });
}

/**
 * The device list entries of one Viessmann device for a kind of extra device.
 * @param {ExtraKind} kind
 * @param {{ gateway: any, device: any }} source
 * @param {{ data: any[] }} rawResponse the Viessmann device's features
 * @param {{ t: Translate, version: string }} options
 * @returns {any[]}
 */
function extraEntries(kind, source, rawResponse, options) {
  return ENTRIES[kind](source, rawResponse, options);
}

module.exports = {
  extraDataId, sourceDevices, extraEntries, withUniqueNames, circuitName, heatingDeviceName, EXTRA_DRIVERS, SOURCE_TYPES,
};
