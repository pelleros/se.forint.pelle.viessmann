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
// capabilities marked `computed` in the config. Pure functions and plain state, no Homey
// dependency; device.js stores the state of the daily counters (store key `dailyCounters`).
//
// Every value has a sound basis or is empty (null): a unit the app does not know, a day figure
// that is not from yesterday, a counter without a midnight baseline or one that went backwards.

const config = require('./config');
const { featureMapper: defaultMapper, isConnected } = require('./featureMapper');

/** @typedef {import('./featureMapper').FeaturesResponse} FeaturesResponse */
/** @typedef {import('./featureMapper').Feature} Feature */
/** @typedef {import('./config/types').CapabilityConfig} CapabilityConfig */

const MINUTE = 60 * 1000;
// The longest gap between the last poll before midnight and the first one after it that still
// gives a midnight baseline: the longest poll interval plus a little backoff. A start in that gap
// counts for the new day (the resolution of the poll interval).
const MIDNIGHT_GAP = 35 * MINUTE;
// "Starts in the last hour" compares with the counter about an hour ago, at most this much older
const HOUR_TOLERANCE = 35 * MINUTE;
// Average run time per start only when the run time is at least this many times the resolution
// of the hours counter (0.1 h, or 1 h for counters that only count whole hours): at most 10 % off
const RUNTIME_RESOLUTION_FACTOR = 10;

// The `computed` kinds this module computes (others, such as alarm_problem, are deviceMonitor.js's)
const VALUE_KINDS = Object.freeze(['power', 'consumptionYesterday', 'startsToday', 'startsYesterday',
  'runtimePerStartYesterday', 'startsLastHour']);

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
 * The local date (YYYY-MM-DD) of a moment in a time zone.
 * @param {number} time epoch milliseconds
 * @param {string} timeZone
 * @returns {string}
 */
function localDate(time, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(time));
}

/**
 * The date after a local date.
 * @param {string} date YYYY-MM-DD
 * @returns {string}
 */
function nextDate(date) {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

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
 * Midnight baselines of a starts and hours counter, and yesterday's differences. Kept in the
 * device's store (`dailyCounters`), one entry per counter.
 * @typedef {object} CounterState
 * @property {string} date local date of the last reading
 * @property {number} at time of the last reading
 * @property {number} starts last starts value
 * @property {number | null} hours last hours value
 * @property {{ starts: number, hours: number | null } | null} base the counters at midnight today
 * @property {{ starts: number, hours: number | null } | null} yesterday yesterday's differences
 * @property {boolean} [fractionalHours] the hours counter has shown tenths
 */

/**
 * The daily figures of a counter after a new reading, and its new state. A new day takes the last
 * reading before midnight as its baseline, when that reading is recent (see MIDNIGHT_GAP); a
 * counter that goes backwards drops today's baseline.
 * @param {CounterState | undefined} state
 * @param {{ starts: number, hours: number | null }} reading
 * @param {number} now
 * @param {string} timeZone
 * @returns {{ state: CounterState, changed: boolean, startsToday: number | null,
 *   startsYesterday: number | null, runtimePerStartYesterday: number | null }}
 */
function updateDailyCounter(state, reading, now, timeZone) {
  const date = localDate(now, timeZone);
  const hours = isNumber(reading.hours) ? reading.hours : null;
  const fractionalHours = Boolean(state?.fractionalHours) || (hours !== null && !Number.isInteger(hours));
  /** @type {CounterState} */
  let next;
  let changed = false;
  if (!state || typeof state.date !== 'string' || !isNumber(state.starts)) {
    next = {
      date, at: now, starts: reading.starts, hours, base: null, yesterday: null, fractionalHours,
    };
    changed = true;
  } else if (state.date === date) {
    const backwards = reading.starts < state.starts || (hours !== null && isNumber(state.hours) && hours < state.hours);
    next = {
      ...state, at: now, starts: reading.starts, hours, base: backwards ? null : state.base, fractionalHours,
    };
    changed = (backwards && state.base !== null) || fractionalHours !== Boolean(state.fractionalHours);
  } else {
    const continuous = nextDate(state.date) === date && now - state.at <= MIDNIGHT_GAP && now >= state.at
      && reading.starts >= state.starts;
    const end = { starts: state.starts, hours: isNumber(state.hours) ? state.hours : null };
    const yesterday = continuous && state.base ? {
      starts: end.starts - state.base.starts,
      hours: end.hours !== null && isNumber(state.base.hours) ? end.hours - state.base.hours : null,
    } : null;
    next = {
      date, at: now, starts: reading.starts, hours, base: continuous ? end : null, yesterday, fractionalHours,
    };
    changed = true;
  }

  const startsToday = next.base && reading.starts >= next.base.starts ? reading.starts - next.base.starts : null;
  const startsYesterday = next.yesterday ? next.yesterday.starts : null;
  let runtimePerStartYesterday = null;
  const ran = next.yesterday?.hours;
  const resolution = next.fractionalHours ? 0.1 : 1;
  if (next.yesterday && next.yesterday.starts > 0 && isNumber(ran) && ran >= RUNTIME_RESOLUTION_FACTOR * resolution) {
    runtimePerStartYesterday = Math.round((ran * 60) / next.yesterday.starts);
  }
  return {
    state: next, changed, startsToday, startsYesterday, runtimePerStartYesterday,
  };
}

/**
 * Starts in the last hour from the starts counter: the difference with the newest reading at
 * least an hour old, if that reading is not much older (see HOUR_TOLERANCE). Readings are kept in
 * memory only, so the figure is empty for the first hour after a start of the app.
 * @param {{ at: number, starts: number }[]} history readings, oldest first (changed in place)
 * @param {number} starts
 * @param {number} now
 * @returns {number | null}
 */
function startsInLastHour(history, starts, now) {
  if (history.length > 0 && starts < history[history.length - 1].starts) history.splice(0);
  history.push({ at: now, starts });
  const hourAgo = now - 60 * MINUTE;
  while (history.length > 1 && history[1].at <= hourAgo) history.shift();
  const reference = history[0];
  if (reference.at > hourAgo || reference.at < hourAgo - HOUR_TOLERANCE) return null;
  return starts - reference.starts;
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
  }

  /**
   * The computed capabilities of the config by name, each with its paths (primary paths before
   * `fallbackFor` paths) and the capability config.
   * @returns {Map<string, { capability: CapabilityConfig, paths: string[] }>}
   */
  computedCapabilities() {
    if (this.capabilities) return this.capabilities;
    /** @type {Map<string, { capability: CapabilityConfig, paths: string[], fallbacks: string[] }>} */
    const found = new Map();
    for (const [path, feature] of Object.entries(this.configuration.FEATURES)) {
      for (const capability of feature.capabilities) {
        if (!capability.computed || !VALUE_KINDS.includes(capability.computed)) continue;
        const entry = found.get(capability.capabilityName) || { capability, paths: [], fallbacks: [] };
        (feature.fallbackFor ? entry.fallbacks : entry.paths).push(path);
        found.set(capability.capabilityName, entry);
      }
    }
    /** @type {Map<string, { capability: CapabilityConfig, paths: string[] }> | undefined} */
    this.capabilities = new Map([...found].map(([name, entry]) => [name, { capability: entry.capability, paths: [...entry.paths, ...entry.fallbacks] }]));
    return this.capabilities;
  }

  /**
   * The computed values of a (circuit-normalized) response for the capabilities `roles` allow.
   * `value` null means empty; a capability that is missing from the result keeps its value (the
   * response has none of its features and no other mapped feature either). `units` is the unit
   * the response gives, where it can differ per device.
   * @param {FeaturesResponse} response
   * @param {string[]} roles
   * @param {{ now: number, timeZone?: string }} context
   * @returns {{ values: Map<string, { value: number | null, units?: string }>, countersChanged: boolean }}
   */
  read(response, roles, { now, timeZone }) {
    const reported = new Map(response.data.map((feature) => [feature.feature, feature]));
    const anyMapped = response.data.some((feature) => this.configuration.FEATURES[feature.feature]);
    /** @type {Map<string, { value: number | null, units?: string }>} */
    const values = new Map();
    let countersChanged = false;
    /** @type {Map<string, ReturnType<typeof updateDailyCounter>>} */
    const daily = new Map();

    for (const [name, { capability, paths }] of this.computedCapabilities()) {
      const allowed = paths.filter((path) => this.mapper.hasRequiredRole(path, roles));
      if (allowed.length === 0) continue;
      const connected = allowed.map((path) => ({ path, feature: reported.get(path) }))
        .filter(({ feature }) => isConnected(feature));
      if (connected.length === 0) {
        if (anyMapped || allowed.some((path) => reported.has(path))) values.set(name, { value: null });
        continue;
      }
      /** @type {{ value: number | null, units?: string }} */
      let result = { value: null };
      for (const { path, feature } of connected) {
        const { properties } = /** @type {Feature} */ (feature);
        let value;
        switch (capability.computed) {
          case 'power':
            value = powerInWatts(properties);
            if (value !== undefined) result = { value };
            break;
          case 'consumptionYesterday': {
            // Without a time zone the day is unknown, but the unit is not
            const consumption = yesterdayConsumption(properties, now, timeZone || 'UTC');
            if (!timeZone) consumption.value = null;
            const fixed = FIXED_UNITS[name.split('.')[0]];
            if (fixed && consumption.units !== fixed) break;
            result = consumption.units ? { value: consumption.value, units: consumption.units } : { value: null };
            break;
          }
          case 'startsToday':
          case 'startsYesterday':
          case 'runtimePerStartYesterday': {
            if (!timeZone) break;
            const starts = properties?.starts?.value;
            if (!isNumber(starts)) break;
            if (!daily.has(path)) {
              const update = updateDailyCounter(this.dailyCounters[path], { starts, hours: properties?.hours?.value }, now, timeZone);
              this.dailyCounters[path] = update.state;
              countersChanged = countersChanged || update.changed;
              daily.set(path, update);
            }
            result = { value: /** @type {any} */ (daily.get(path))[capability.computed] };
            break;
          }
          case 'startsLastHour': {
            const starts = properties?.starts?.value;
            if (!isNumber(starts)) break;
            this.hourly[path] = this.hourly[path] || [];
            result = { value: startsInLastHour(this.hourly[path], starts, now) };
            break;
          }
          default:
            break;
        }
        if (result.value !== null) break;
      }
      values.set(name, result);
    }
    return { values, countersChanged };
  }

}

module.exports = {
  ComputedValues,
  localDate,
  powerInWatts,
  yesterdayConsumption,
  updateDailyCounter,
  startsInLastHour,
  MIDNIGHT_GAP,
  VALUE_KINDS,
};
