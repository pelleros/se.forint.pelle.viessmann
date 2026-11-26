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

// What the extra devices show: optional Homey devices beside the ViCare device, each one part of
// a Viessmann device as a device of its own, for Google Home, voice assistants, the Matter bridge
// and zones of their own:
//   circuit   a heating circuit as a thermostat: its set point, its room temperature (only from
//             a real room sensor) and Homey's standard mode (heat, off; cool and auto only where
//             the circuit can cool)
//   hotWater  hot water as a thermostat: its set point, the cylinder temperature, and heat/off
//             where the hot water can be switched off
//   room      a room of ViCare Smart Climate, read-only: temperature, humidity and set point
// Pure: which capabilities an extra device gets, their options, the values of a poll response,
// what a write sends and the paths a poll needs. The circuit and hot water devices read the same
// datapoints as the ViCare device, through its configuration (config/, featureMapper.js); rooms
// are a Viessmann device of their own (e.g. RoomControl-1) and are read here.

const { PATHS } = require('./config');
const { STANDARD_MODES, standardModesFor } = require('./config/modes');
const { featureMapper, readPropertyValue, isConnected } = require('./featureMapper');
const { resolveCircuitPath, normalizeCircuitFeatures, featureEntries } = require('./heatingCircuit');

/** @typedef {'circuit' | 'hotWater' | 'room'} ExtraKind */

/**
 * What an extra device knows about its part of the Viessmann device (its store).
 * @typedef {object} ExtraContext
 * @property {string} [heatingCircuitId] the heating circuit (circuit and hot water devices)
 * @property {string} [roomId] the room (room devices)
 * @property {string[]} [features] stored feature paths (circuit-normalized), only ever growing
 * @property {Record<string, Record<string, any>>} [constraints]
 * @property {Record<string, any>} [commandMetadata]
 * @property {{ id: string }[]} [operatingModes] the heating circuit's operating modes
 * @property {string} [language]
 */

/**
 * A value of an extra device and where it comes from.
 * @typedef {object} ExtraCapability
 * @property {string} name the capability on the extra device
 * @property {string[]} paths the feature paths that feed it (circuit-normalized; a room's with its
 *   index): one of them stored or reported gives the device the capability
 * @property {string} [source] the configured capability (config/) whose value it shows and
 *   through which it is written
 * @property {(value: any) => any} [fromSource] the value it shows for the source's value
 * @property {(value: any, state: WriteState) => any} [toSource] the source's value to write for
 *   its value; null when the source already has a fitting value (nothing to send)
 * @property {{ path: string, propertyPath: string }[]} [reads] read directly instead (rooms):
 *   the first path with a value
 * @property {(context: ExtraContext) => boolean} [available] an extra condition for having it
 * @property {(context: ExtraContext) => Record<string, any>} options its capability options
 * @property {boolean} [writable]
 */

/**
 * What a write needs to know besides the value.
 * @typedef {object} WriteState
 * @property {unknown} current the source's current value
 * @property {unknown} [lastOnMode] the hot water mode before it was switched off
 * @property {ExtraContext} context
 */

const TEMPERATURE = { units: '°C', decimals: 1 };
// Values the ViCare device shows too: their history stays there, so no second graph of them
const NO_SECOND_HISTORY = { preventInsights: true };
// Values only an extra device shows (rooms): their history is here
const OWN_HISTORY = { preventInsights: false };

const TITLES = {
  roomTemperature: {
    en: 'Room temperature', de: 'Raumtemperatur', nl: 'Kamertemperatuur', fr: 'Température ambiante', sv: 'Rumstemperatur',
  },
  hotWaterTarget: {
    en: 'Hot water set point',
    de: 'Warmwasser-Solltemperatur',
    nl: 'Gewenste warmwatertemperatuur',
    fr: 'Consigne eau chaude',
    sv: 'Börvärde varmvatten',
  },
  hotWaterTemperature: {
    en: 'Hot water temperature', de: 'Warmwassertemperatur', nl: 'Warmwatertemperatuur', fr: 'Température eau chaude', sv: 'Varmvattentemperatur',
  },
  hotWaterMode: {
    en: 'Hot water on/off', de: 'Warmwasser an/aus', nl: 'Warm water aan/uit', fr: 'Eau chaude marche/arrêt', sv: 'Varmvatten på/av',
  },
  thermostatMode: {
    en: 'Thermostat mode', de: 'Thermostatmodus', nl: 'Thermostaatmodus', fr: 'Mode du thermostat', sv: 'Termostatläge',
  },
  humidity: {
    en: 'Humidity', de: 'Luftfeuchtigkeit', nl: 'Luchtvochtigheid', fr: 'Humidité', sv: 'Luftfuktighet',
  },
  roomSetPoint: {
    en: 'Set point', de: 'Sollwert', nl: 'Ingestelde temperatuur', fr: 'Consigne', sv: 'Börvärde',
  },
};

// Hot water heats (any of its modes) or is off; only where its mode command has `off`
const HOT_WATER_OFF = 'off';
const standardTitle = (/** @type {string} */ id) => STANDARD_MODES.find((mode) => mode.id === id)?.title;

/**
 * The modes the hot water mode command accepts (from the stored constraints), or [].
 * @param {ExtraContext} context
 * @returns {string[]}
 */
function hotWaterModes(context) {
  const accepted = context.constraints?.[PATHS.HOT_WATER_MODE]?.mode?.enum;
  return Array.isArray(accepted) ? accepted.filter((mode) => typeof mode === 'string') : [];
}

/**
 * The options of a configured capability for the path the device has (with the API's limits).
 * @param {string} source
 * @param {ExtraContext} context
 */
function sourceOptions(source, context) {
  const path = featureMapper.commandTarget(source, context.features)?.path || '';
  return featureMapper.optionsFor(source, path, context.constraints, {
    operatingModes: context.operatingModes, commandMetadata: context.commandMetadata, features: context.features,
  });
}

/**
 * Only the limits of a configured set point: min, max and step.
 * @param {string} source
 * @param {ExtraContext} context
 */
function limitsOf(source, context) {
  const { min, max, step } = sourceOptions(source, context);
  return { min, max, step };
}

/** @type {Record<'circuit' | 'hotWater', ExtraCapability[]>} */
const CONFIGURED = {
  circuit: [
    {
      name: 'target_temperature',
      source: 'target_temperature',
      paths: [PATHS.HEATING_CIRCUIT_0_TARGET, PATHS.HEATING_CIRCUIT_0_TARGET_E3],
      writable: true,
      options: (context) => ({ ...sourceOptions('target_temperature', context), ...NO_SECOND_HISTORY }),
    },
    {
      // Only a real room sensor: Homey uses it as the temperature of the device's zone
      name: 'measure_temperature',
      source: 'measure_temperature',
      paths: [PATHS.HEATING_CIRCUIT_0_ROOM_TEMPERATURE],
      options: () => ({ title: TITLES.roomTemperature, ...TEMPERATURE, ...NO_SECOND_HISTORY }),
    },
    {
      name: 'thermostat_mode',
      source: 'thermostat_mode',
      paths: [PATHS.HEATING_CIRCUIT_0_MODE],
      writable: true,
      options: (context) => ({
        title: TITLES.thermostatMode,
        values: standardModesFor(context.operatingModes).map(({ id, title }) => ({ id, title })),
        preventInsights: true,
      }),
    },
  ],
  hotWater: [
    {
      name: 'target_temperature',
      source: 'target_temperature.hotWater',
      paths: [PATHS.HOT_WATER_TARGET],
      writable: true,
      options: (context) => ({
        title: TITLES.hotWaterTarget, units: '°C', ...limitsOf('target_temperature.hotWater', context), ...NO_SECOND_HISTORY,
      }),
    },
    {
      name: 'measure_temperature',
      source: 'measure_temperature.hotWater',
      paths: [PATHS.HOT_WATER_TEMP],
      options: () => ({ title: TITLES.hotWaterTemperature, ...TEMPERATURE, ...NO_SECOND_HISTORY }),
    },
    {
      name: 'thermostat_mode',
      source: 'thermostat_mode.hotWater',
      fromSource: (mode) => {
        if (typeof mode !== 'string') return mode;
        return mode === HOT_WATER_OFF ? 'off' : 'heat';
      },
      // eslint-disable-next-line no-use-before-define
      toSource: (value, state) => hotWaterModeFor(value, state),
      paths: [PATHS.HOT_WATER_MODE],
      writable: true,
      // Heat and off: only where the hot water can be switched off and on again
      available: (context) => hotWaterModes(context).includes(HOT_WATER_OFF) && hotWaterModes(context).length > 1,
      options: () => ({
        title: TITLES.hotWaterMode,
        values: ['heat', 'off'].map((id) => ({ id, title: standardTitle(id) })),
        preventInsights: true,
      }),
    },
  ],
};

/**
 * The values of a room (`rooms.<id>.*` of the ViCare Smart Climate device). The set point is the
 * room's heating set point in force now; a device that does not report it shows none (its
 * comfort, normal and reduced levels need not be the one in force).
 * @param {string} roomId
 * @returns {ExtraCapability[]}
 */
function roomCapabilities(roomId) {
  const room = `rooms.${roomId}`;
  /** @type {(path: string, propertyPath: string) => { path: string, propertyPath: string }} */
  const read = (path, propertyPath) => ({ path, propertyPath });
  return [
    {
      name: 'measure_temperature',
      paths: [`${room}.sensors.temperature`],
      reads: [read(`${room}.sensors.temperature`, 'value.value')],
      options: () => ({ title: TITLES.roomTemperature, ...TEMPERATURE, ...OWN_HISTORY }),
    },
    {
      name: 'measure_humidity',
      paths: [`${room}.sensors.humidity`],
      reads: [read(`${room}.sensors.humidity`, 'value.value')],
      options: () => ({
        title: TITLES.humidity, units: '%', decimals: 0, ...OWN_HISTORY,
      }),
    },
    {
      name: 'measure_temperature.setPoint',
      paths: [`${room}.temperature.levels.heating`],
      reads: [read(`${room}.temperature.levels.heating`, 'temperature.value')],
      options: () => ({ title: TITLES.roomSetPoint, ...TEMPERATURE, ...OWN_HISTORY }),
    },
  ];
}

/**
 * The values an extra device of this kind can have.
 * @param {ExtraKind} kind
 * @param {ExtraContext} context
 * @returns {ExtraCapability[]}
 */
function profileOf(kind, context) {
  if (kind === 'room') return roomCapabilities(String(context.roomId ?? '0'));
  const profile = CONFIGURED[kind];
  if (!profile) throw new Error(`Unknown kind of extra device: ${kind}`);
  return profile;
}

/**
 * The capabilities an extra device gets from its stored features, in the order it gets them.
 * @param {ExtraKind} kind
 * @param {ExtraContext} context
 * @returns {string[]}
 */
function capabilitiesFor(kind, context) {
  const stored = Array.isArray(context.features) ? context.features : [];
  return profileOf(kind, context)
    .filter((capability) => capability.paths.some((path) => stored.includes(path)))
    .filter((capability) => !capability.available || capability.available(context))
    .map((capability) => capability.name);
}

/**
 * The options of each capability an extra device gets.
 * @param {ExtraKind} kind
 * @param {ExtraContext} context
 * @returns {Record<string, Record<string, any>>}
 */
function optionsFor(kind, context) {
  const names = capabilitiesFor(kind, context);
  return Object.fromEntries(profileOf(kind, context)
    .filter((capability) => names.includes(capability.name))
    .map((capability) => [capability.name, capability.options(context)]));
}

/**
 * The feature paths a poll needs for an extra device, as the API names them (on its circuit).
 * @param {ExtraKind} kind
 * @param {ExtraContext} context
 * @returns {string[]}
 */
function pollPaths(kind, context) {
  return [...new Set(profileOf(kind, context)
    .flatMap((capability) => capability.paths)
    .map((path) => resolveCircuitPath(path, context.heatingCircuitId)))];
}

/**
 * The part of a poll response an extra device reads: the features of its values, on its heating
 * circuit (circuit and hot water devices). Null when the response holds none of them (a poll
 * made before the device joined, or for another circuit): it says nothing about the device.
 * @param {ExtraKind} kind
 * @param {ExtraContext} context
 * @param {{ data?: unknown }} rawResponse
 * @returns {{ data: any[] } | null}
 */
function responseFor(kind, context, rawResponse) {
  const paths = new Set(profileOf(kind, context).flatMap((capability) => capability.paths));
  const data = featureEntries(rawResponse?.data);
  const own = kind === 'room' ? data : normalizeCircuitFeatures({ data }, context.heatingCircuitId).data;
  const features = own.filter((feature) => paths.has(feature.feature));
  return features.length > 0 ? { data: features } : null;
}

/**
 * The feature paths of the device's values that a response reports as enabled and connected,
 * and that are not stored yet (a sensor connected later): they give the device more values.
 * @param {ExtraKind} kind
 * @param {ExtraContext} context
 * @param {{ data: any[] }} response from responseFor
 * @returns {string[]}
 */
function newPaths(kind, context, response) {
  const stored = Array.isArray(context.features) ? context.features : [];
  const paths = profileOf(kind, context).flatMap((capability) => capability.paths);
  return response.data
    .filter((feature) => paths.includes(feature.feature) && !stored.includes(feature.feature) && isConnected(feature))
    .map((feature) => feature.feature)
    .filter((path, index, all) => all.indexOf(path) === index);
}

/**
 * Every value of an extra device in a response from responseFor: capability name → { value,
 * gone }. `value` undefined keeps the last value; `gone` means none of its paths is reported as
 * enabled and connected any more, so the value is cleared. `readings` are the configured
 * capabilities' readings (featureMapper.readValues) for circuit and hot water devices.
 * @param {ExtraKind} kind
 * @param {ExtraContext} context
 * @param {{ data: any[] }} response
 * @param {Map<string, { value: any, gone: boolean }>} [readings]
 * @returns {Map<string, { value: any, gone: boolean }>}
 */
function valuesFor(kind, context, response, readings = new Map()) {
  const reported = new Map(response.data.map((feature) => [feature.feature, feature]));
  /** @type {Map<string, { value: any, gone: boolean }>} */
  const values = new Map();
  for (const capability of profileOf(kind, context)) {
    if (capability.reads) {
      const connected = capability.reads.filter(({ path }) => isConnected(reported.get(path)));
      const value = connected.map(({ path, propertyPath }) => readPropertyValue(reported.get(path)?.properties, propertyPath))
        .find((candidate) => candidate !== undefined && candidate !== null);
      values.set(capability.name, { value: connected.length > 0 ? value : undefined, gone: connected.length === 0 });
    } else if (capability.source) {
      const reading = readings.get(capability.source) || { value: undefined, gone: false };
      const value = capability.fromSource ? capability.fromSource(reading.value) : reading.value;
      values.set(capability.name, { value, gone: reading.gone });
    }
  }
  return values;
}

/**
 * The configured capability an extra device's capability is written through, or undefined for
 * a value that cannot be changed.
 * @param {ExtraKind} kind
 * @param {ExtraContext} context
 * @param {string} name
 * @returns {ExtraCapability | undefined}
 */
function writableCapability(kind, context, name) {
  return profileOf(kind, context).find((capability) => capability.name === name && capability.writable && capability.source);
}

/**
 * The extra device's capabilities that show a configured capability's value (after a write),
 * with the value each shows.
 * @param {ExtraKind} kind
 * @param {ExtraContext} context
 * @param {string} source a configured capability
 * @param {any} value its value
 * @returns {{ name: string, value: any }[]}
 */
function shownFrom(kind, context, source, value) {
  return profileOf(kind, context)
    .filter((capability) => capability.source === source)
    .map((capability) => ({ name: capability.name, value: capability.fromSource ? capability.fromSource(value) : value }));
}

/**
 * The hot water mode that `heat` or `off` stands for: off, or (for heat) the mode it had before
 * it was switched off, else the first mode the device offers besides off. Null when the mode the
 * hot water has already fits (nothing to send).
 * @param {'heat' | 'off' | string} value
 * @param {{ current: unknown, lastOnMode?: unknown, context: ExtraContext }} state
 * @returns {string | null}
 */
function hotWaterModeFor(value, { current, lastOnMode, context }) {
  if (value !== 'heat' && value !== 'off') throw new Error(`Unknown thermostat mode: ${value}`);
  const modes = hotWaterModes(context);
  if (value === 'off') return current === HOT_WATER_OFF ? null : HOT_WATER_OFF;
  if (typeof current === 'string' && current !== HOT_WATER_OFF) return null;
  if (typeof lastOnMode === 'string' && lastOnMode !== HOT_WATER_OFF && (modes.length === 0 || modes.includes(lastOnMode))) return lastOnMode;
  const first = modes.find((mode) => mode !== HOT_WATER_OFF);
  if (!first) throw Object.assign(new Error('This hot water has no mode to switch it on'), { code: 'mode_not_available' });
  return first;
}

module.exports = {
  profileOf,
  capabilitiesFor,
  optionsFor,
  pollPaths,
  responseFor,
  newPaths,
  valuesFor,
  writableCapability,
  shownFrom,
  hotWaterModes,
  hotWaterModeFor,
  HOT_WATER_OFF,
};
