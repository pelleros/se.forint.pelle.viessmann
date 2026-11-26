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

// Values the device computes from a features response instead of copying a property: the
// capabilities marked `computed` in the config (power in W, Viessmann's consumption for
// yesterday, and the daily figures of the starts counters, see dailyCounters.js). No Homey
// dependency; the device stores the state of the daily counters (store key `dailyCounters`).
//
// Every value has a sound basis or is empty (null): a unit the app does not know, a day figure
// that is not from yesterday, a counter without a midnight baseline or one that went backwards.

const config = require('./config');
const { featureMapper: defaultMapper, isConnected } = require('./featureMapper');
const { updateDailyCounter, startsInLastHour, localDate } = require('./dailyCounters');

/** @typedef {import('./featureMapper').FeaturesResponse} FeaturesResponse */
/** @typedef {import('./featureMapper').Feature} Feature */
/** @typedef {import('./config/types').CapabilityConfig} CapabilityConfig */
/** @typedef {import('./dailyCounters').CounterState} CounterState */
/** @typedef {{ value: number | null, units?: string }} ComputedValue */
/**
 * What a response is read with: the time, Homey's time zone (none: no daily figures) and the
 * device's poll interval in milliseconds (dailyCounters.js; none: the default midnight gap).
 * @typedef {{ now: number, timeZone?: string, pollInterval?: number }} Context
 */

const MINUTE = 60 * 1000;
const DAILY_KINDS = Object.freeze(['startsToday', 'startsYesterday', 'runtimePerStartYesterday']);
// The `computed` kinds this module computes (others, such as alarm_problem, are deviceMonitor.js's)
const VALUE_KINDS = Object.freeze(['power', 'consumptionYesterday', ...DAILY_KINDS, 'startsLastHour']);

const POWER_FACTORS = Object.freeze({ kilowatt: 1000, watt: 1 });
const ENERGY_UNITS = Object.freeze({
  kilowattHour: { units: 'kWh', factor: 1 },
  wattHour: { units: 'kWh', factor: 0.001 },
  cubicMeter: { units: 'm³', factor: 1 },
});
// Capabilities whose figure is only shown in this unit (electricity); others take the response's unit
const FIXED_UNITS = Object.freeze({ measure_electricity_yesterday: 'kWh' });

const round = (value, decimals) => Math.round(value * (10 ** decimals)) / (10 ** decimals);
/**
 * @param {unknown} value
 * @returns {value is number}
 */
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * The device's electrical power in W from a `value` property in kW or W; undefined for any other
 * unit or a missing value.
 * @param {Record<string, any> | undefined} properties
 * @returns {number | undefined}
 */
function powerInWatts(properties) {
  const value = properties?.value?.value;
  const factor = POWER_FACTORS[properties?.value?.unit];
  if (!isNumber(value) || factor === undefined) return undefined;
  return Math.round(value * factor);
}

/**
 * Yesterday's consumption from a feature's day values: `day[0]` is the day the values were read
 * (`dayValueReadAt`), `day[1]` the complete day before it. So `day[1]` is yesterday only when the
 * values were read today (in Homey's time zone); values read before today are stale and give no
 * figure. The unit is the response's.
 * @param {Record<string, any> | undefined} properties
 * @param {number} now epoch milliseconds
 * @param {string} timeZone
 * @returns {{ value: number | null, units: string | undefined }}
 */
function yesterdayConsumption(properties, now, timeZone) {
  const unit = ENERGY_UNITS[properties?.day?.unit];
  const days = properties?.day?.value;
  const readAt = Date.parse(properties?.dayValueReadAt?.value);
  if (!unit) return { value: null, units: undefined };
  const fresh = Number.isFinite(readAt) && readAt <= now + 5 * MINUTE
    && localDate(readAt, timeZone) === localDate(now, timeZone);
  if (!fresh || !Array.isArray(days) || !isNumber(days[1]) || days[1] < 0) return { value: null, units: unit.units };
  return { value: round(days[1] * unit.factor, 3), units: unit.units };
}

/**
 * The computed capabilities of a configuration by name, each with its config and its paths
 * (primary paths before `fallbackFor` paths).
 * @param {Record<string, import('./config/types').FeatureConfig>} features
 * @returns {Map<string, { capability: CapabilityConfig, paths: string[] }>}
 */
function computedCapabilities(features) {
  /** @type {Map<string, { capability: CapabilityConfig, paths: string[], fallbacks: string[] }>} */
  const found = new Map();
  for (const [path, feature] of Object.entries(features)) {
    for (const capability of feature.capabilities) {
      if (!capability.computed || !VALUE_KINDS.includes(capability.computed)) continue;
      const entry = found.get(capability.capabilityName) || { capability, paths: [], fallbacks: [] };
      (feature.fallbackFor ? entry.fallbacks : entry.paths).push(path);
      found.set(capability.capabilityName, entry);
    }
  }
  return new Map([...found].map(([name, entry]) => [name, { capability: entry.capability, paths: [...entry.paths, ...entry.fallbacks] }]));
}

class ComputedValues {

  /**
   * @param {object} [options]
   * @param {Record<string, CounterState>} [options.dailyCounters] stored state of the daily counters
   * @param {{ FEATURES: Record<string, import('./config/types').FeatureConfig> }} [options.configuration]
   * @param {import('./featureMapper').FeatureMapper} [options.mapper]
   */
  constructor({ dailyCounters = {}, configuration = config, mapper = defaultMapper } = {}) {
    /** @type {Record<string, CounterState>} */
    this.dailyCounters = { ...(dailyCounters && typeof dailyCounters === 'object' ? dailyCounters : {}) };
    /** @type {Record<string, { at: number, starts: number }[]>} */
    this.hourly = {};
    this.configuration = configuration;
    this.mapper = mapper;
    this.capabilities = computedCapabilities(configuration.FEATURES);
  }

  /**
   * The computed values of a (circuit-normalized) response for the capabilities `roles` allow.
   * `value` null means empty; a capability that is missing from the result keeps its value (the
   * response has none of its features and no other mapped feature either). `units` is the unit
   * the response gives, where it can differ per device. `countersChanged` says when the daily
   * counters should be stored.
   * @param {FeaturesResponse} response
   * @param {string[]} roles
   * @param {Context} context
   * @returns {{ values: Map<string, ComputedValue>, countersChanged: boolean }}
   */
  read(response, roles, context) {
    const reported = new Map(response.data.map((feature) => [feature.feature, feature]));
    const anyMapped = response.data.some((feature) => this.configuration.FEATURES[feature.feature]);
    /** @type {Map<string, ComputedValue>} */
    const values = new Map();
    this.pending = { changed: false, daily: new Map() };
    for (const [name, { capability, paths }] of this.capabilities) {
      const allowed = paths.filter((path) => this.mapper.hasRequiredRole(path, roles));
      if (allowed.length === 0) continue;
      const connected = allowed.filter((path) => isConnected(reported.get(path)));
      if (connected.length > 0) {
        values.set(name, this.firstValue(name, capability, connected.map((path) => ({ path, feature: reported.get(path) })), context));
      } else if (anyMapped || allowed.some((path) => reported.has(path))) {
        // The datapoint is gone: empty, the capability stays
        values.set(name, { value: null });
      }
    }
    return { values, countersChanged: this.pending.changed };
  }

  /**
   * The value from the first source that gives one (fallback paths come last).
   * @param {string} name
   * @param {CapabilityConfig} capability
   * @param {{ path: string, feature: any }[]} sources
   * @param {Context} context
   * @returns {ComputedValue}
   */
  firstValue(name, capability, sources, context) {
    /** @type {ComputedValue} */
    let result = { value: null };
    for (const { path, feature } of sources) {
      result = this.compute(name, /** @type {string} */ (capability.computed), path, feature.properties || {}, context);
      if (result.value !== null) break;
    }
    return result;
  }

  /**
   * One computed value from one feature's properties.
   * @param {string} name
   * @param {string} kind
   * @param {string} path
   * @param {Record<string, any>} properties
   * @param {Context} context
   * @returns {ComputedValue}
   */
  compute(name, kind, path, properties, { now, timeZone, pollInterval }) {
    if (kind === 'power') return { value: powerInWatts(properties) ?? null };
    if (kind === 'consumptionYesterday') {
      // Without a time zone the day is unknown, but the unit is not
      const consumption = yesterdayConsumption(properties, now, timeZone || 'UTC');
      const fixed = FIXED_UNITS[name.split('.')[0]];
      if (!consumption.units || (fixed && consumption.units !== fixed)) return { value: null };
      return { value: timeZone ? consumption.value : null, units: consumption.units };
    }
    const starts = properties.starts?.value;
    if (!isNumber(starts)) return { value: null };
    if (kind === 'startsLastHour') {
      this.hourly[path] = this.hourly[path] || [];
      return { value: startsInLastHour(this.hourly[path], starts, now) };
    }
    if (!timeZone || !DAILY_KINDS.includes(kind)) return { value: null };
    return { value: this.dailyFigures(path, starts, properties.hours?.value, { now, timeZone, pollInterval })[kind] };
  }

  /**
   * The daily figures of a counter, updated once per response (the three figures share it).
   * @param {string} path
   * @param {number} starts
   * @param {unknown} hours
   * @param {{ now: number, timeZone: string, pollInterval?: number }} context
   * @returns {Record<string, number | null>}
   */
  dailyFigures(path, starts, hours, { now, timeZone, pollInterval }) {
    const { pending } = /** @type {{ pending: { changed: boolean, daily: Map<string, any> } }} */ (this);
    if (!pending.daily.has(path)) {
      const update = updateDailyCounter(this.dailyCounters[path], { starts, hours }, now, timeZone, { pollInterval });
      this.dailyCounters[path] = update.state;
      pending.changed = pending.changed || update.changed;
      pending.daily.set(path, update);
    }
    return pending.daily.get(path);
  }

}

module.exports = {
  ComputedValues, powerInWatts, yesterdayConsumption, VALUE_KINDS,
};
