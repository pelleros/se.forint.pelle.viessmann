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

// The device's status from its features responses, without any Homey dependency: faults the
// heating system reports, new logbook entries, values that stopped updating ("frozen" data) and
// writes that did not take. deviceMonitor.js turns the result into alarm_problem, a warning on the
// device, Flow triggers and notifications.

const { PATHS } = require('./config');

/** @typedef {import('./featureMapper').FeaturesResponse} FeaturesResponse */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
// Values count as frozen when no feature timestamp has moved for this long while polls succeed
const FROZEN_AFTER = 6 * HOUR;
// A write is checked on the first poll at least this long after it (Viessmann needs a moment)
const WRITE_CHECK_AFTER = MINUTE;
// A write whose value no poll reports within this time is forgotten without a message
const WRITE_CHECK_EXPIRY = 15 * MINUTE;
// Feature paths whose entries are faults
const FAULT_PATHS = [PATHS.DEVICE_ERRORS, PATHS.FUEL_CELL_ERRORS];

/**
 * @typedef {object} Fault
 * @property {string} code e.g. F.160
 * @property {string} [priority]
 * @property {string} [timestamp]
 */

/**
 * @typedef {object} LogbookEntry
 * @property {string} event
 * @property {string} actor
 * @property {number | null} status
 * @property {string} circuit
 * @property {string} timestamp
 */

/**
 * What the device remembers between starts (store key `knownMessages`): the faults it has
 * reported and the newest logbook entries it has seen.
 * @typedef {object} KnownMessages
 * @property {string[]} faults
 * @property {{ timestamp: string, keys: string[] } | null} logbook
 */

/**
 * The text of a value, or undefined when it is no string or number.
 * @param {unknown} value
 * @returns {string | undefined}
 */
function text(value) {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/**
 * The entries array of a feature, or none.
 * @param {any} feature
 * @returns {any[]}
 */
function entriesOf(feature) {
  const entries = feature?.isEnabled !== false ? feature?.properties?.entries?.value : undefined;
  return Array.isArray(entries) ? entries.filter((entry) => entry && typeof entry === 'object') : [];
}

/**
 * The faults a response reports, one per code. Undefined when the response has no fault feature
 * (a response without them says nothing about faults).
 * @param {FeaturesResponse} response
 * @returns {Fault[] | undefined}
 */
function readFaults(response) {
  const features = response.data.filter((feature) => FAULT_PATHS.includes(feature.feature));
  if (features.length === 0) return undefined;
  /** @type {Map<string, Fault>} */
  const faults = new Map();
  for (const entry of features.flatMap(entriesOf)) {
    const code = text(entry.errorCode) || text(entry.code) || text(entry.error);
    if (!code || faults.has(code)) continue;
    faults.set(code, { code, priority: text(entry.priority), timestamp: text(entry.timestamp) });
  }
  return [...faults.values()];
}

/**
 * The logbook entries of a response, newest first, or undefined without a logbook.
 * @param {FeaturesResponse} response
 * @returns {LogbookEntry[] | undefined}
 */
function readLogbook(response) {
  const feature = response.data.find((item) => item.feature === PATHS.LOGBOOK);
  if (!feature) return undefined;
  return entriesOf(feature)
    .map((entry) => ({
      event: text(entry.event) || '',
      actor: text(entry.actor) || '',
      status: typeof entry.status === 'number' && Number.isFinite(entry.status) ? entry.status : null,
      circuit: text(entry.circuit) || '',
      timestamp: text(entry.timestamp) || '',
    }))
    .filter((entry) => entry.event !== '' && entry.timestamp !== '')
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
}

const logbookKey = (/** @type {LogbookEntry} */ entry) => `${entry.timestamp}|${entry.event}|${entry.actor}|${entry.status}`;

/**
 * The newest feature timestamp of a response (epoch milliseconds), or undefined.
 * @param {FeaturesResponse} response
 * @returns {number | undefined}
 */
function newestTimestamp(response) {
  let newest;
  for (const feature of response.data) {
    const time = Date.parse(/** @type {any} */ (feature).timestamp);
    if (Number.isFinite(time) && (newest === undefined || time > newest)) newest = time;
  }
  return newest;
}

/**
 * The known messages from the store, with defaults.
 * @param {any} stored
 * @returns {KnownMessages}
 */
function knownMessagesFrom(stored) {
  return {
    faults: Array.isArray(stored?.faults) ? stored.faults.filter((code) => typeof code === 'string') : [],
    logbook: stored?.logbook && typeof stored.logbook.timestamp === 'string' && Array.isArray(stored.logbook.keys)
      ? { timestamp: stored.logbook.timestamp, keys: stored.logbook.keys } : null,
  };
}

class StatusTracker {

  /**
   * @param {object} [options]
   * @param {any} [options.known] the stored KnownMessages
   * @param {number} [options.frozenAfter]
   */
  constructor({ known, frozenAfter = FROZEN_AFTER } = {}) {
    this.known = knownMessagesFrom(known);
    this.frozenAfter = frozenAfter;
    /** @type {Fault[]} */
    this.faults = [];
    /** @type {{ newest: number, movedAt: number } | null} */
    this.timestamps = null;
    /** @type {Map<string, { value: any, at: number }>} */
    this.writes = new Map();
  }

  /**
   * Reads a successful features response.
   * @param {FeaturesResponse} response
   * @param {number} now
   * @returns {{ faults: Fault[], newFaults: Fault[], logbook: LogbookEntry[], frozenSince: number | null,
   *   knownChanged: boolean }}
   */
  read(response, now) {
    let knownChanged = false;

    // Faults: a code that was not active before is new; the stored list survives restarts, so a
    // fault is reported once while it lasts
    /** @type {Fault[]} */
    let newFaults = [];
    const faults = readFaults(response);
    if (faults !== undefined) {
      newFaults = faults.filter((fault) => !this.known.faults.includes(fault.code));
      const codes = faults.map((fault) => fault.code);
      if (codes.length !== this.known.faults.length || newFaults.length > 0) {
        this.known.faults = codes;
        knownChanged = true;
      }
      this.faults = faults;
    }

    // Logbook: entries newer than the newest one seen; the first logbook seen is history
    /** @type {LogbookEntry[]} */
    let logbook = [];
    const entries = readLogbook(response);
    if (entries !== undefined && entries.length > 0) {
      const seen = this.known.logbook;
      if (seen) {
        logbook = entries.filter((entry) => entry.timestamp > seen.timestamp
          || (entry.timestamp === seen.timestamp && !seen.keys.includes(logbookKey(entry))));
      }
      const newest = entries[0].timestamp;
      const keys = entries.filter((entry) => entry.timestamp === newest).map(logbookKey);
      if (!seen || newest > seen.timestamp || keys.some((key) => !seen.keys.includes(key))) {
        this.known.logbook = { timestamp: newest, keys: seen && seen.timestamp === newest ? [...new Set([...seen.keys, ...keys])] : keys };
        knownChanged = true;
      }
      logbook.reverse();
    }

    // Frozen data: the newest feature timestamp has not moved for a long time while polls work.
    // Only what this app has seen counts (not the age of the timestamps), so a clock that is off
    // or an old response at the start never counts as frozen.
    const newest = newestTimestamp(response);
    if (newest !== undefined) {
      if (!this.timestamps || newest > this.timestamps.newest) this.timestamps = { newest, movedAt: now };
    }
    const frozenSince = this.timestamps && now - this.timestamps.movedAt >= this.frozenAfter ? this.timestamps.newest : null;

    return {
      faults: this.faults, newFaults, logbook, frozenSince, knownChanged,
    };
  }

  /**
   * Remembers a value written to a capability, to check it on a later poll.
   * @param {string} capabilityName
   * @param {any} value
   * @param {number} now
   */
  rememberWrite(capabilityName, value, now) {
    this.writes.set(capabilityName, { value, at: now });
  }

  /**
   * Checks remembered writes against the values of a poll. Returns the writes the device did not
   * take (`actual` is what it reports instead) and the ones it did.
   * @param {(capabilityName: string) => any} reportedValue the value a poll reports, or undefined
   * @param {number} now
   * @returns {{ rejected: { capabilityName: string, wanted: any, actual: any }[], confirmed: string[] }}
   */
  checkWrites(reportedValue, now) {
    const rejected = [];
    const confirmed = [];
    for (const [capabilityName, { value, at }] of this.writes) {
      if (now - at < WRITE_CHECK_AFTER) continue;
      const actual = reportedValue(capabilityName);
      if (actual === undefined || actual === null) {
        if (now - at > WRITE_CHECK_EXPIRY) this.writes.delete(capabilityName);
        continue;
      }
      this.writes.delete(capabilityName);
      const same = typeof value === 'number' && typeof actual === 'number'
        ? Math.abs(value - actual) < 0.01 : value === actual;
      if (same) confirmed.push(capabilityName);
      else rejected.push({ capabilityName, wanted: value, actual });
    }
    return { rejected, confirmed };
  }

}

module.exports = {
  StatusTracker,
  readFaults,
  readLogbook,
  newestTimestamp,
  knownMessagesFrom,
  FROZEN_AFTER,
  WRITE_CHECK_AFTER,
  WRITE_CHECK_EXPIRY,
};
