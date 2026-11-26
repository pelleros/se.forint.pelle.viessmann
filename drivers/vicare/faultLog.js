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

// Faults and logbook entries the heating system reports in its features: which faults are active,
// which of them are new (reported once while they last, also across restarts), and which logbook
// entries are new. Pure; the device keeps what it has seen in its store (`knownMessages`).

const { PATHS } = require('./config');
const {
  text, entriesOf, positionFrom, entriesAfter,
} = require('./messageEntries');

/** @typedef {import('./featureMapper').FeaturesResponse} FeaturesResponse */
/** @typedef {import('./messageEntries').ReadPosition<string>} LogbookPosition */

// Feature paths whose entries are faults
const FAULT_PATHS = Object.freeze([PATHS.DEVICE_ERRORS, PATHS.FUEL_CELL_ERRORS]);

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
 * What has been reported already: the active fault codes and the logbook's read position.
 * @typedef {{ faults: string[], logbook: LogbookPosition | null }} FaultLogState
 */

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
 * The logbook entries of a response, oldest first, or undefined without a logbook.
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
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
}

const logbookKey = (/** @type {LogbookEntry} */ entry) => `${entry.timestamp}|${entry.event}|${entry.actor}|${entry.status}`;

/**
 * The fault log state from the store, with defaults.
 * @param {any} stored
 * @returns {FaultLogState}
 */
function faultLogStateFrom(stored) {
  return {
    faults: Array.isArray(stored?.faults) ? stored.faults.filter((code) => typeof code === 'string') : [],
    logbook: positionFrom(stored?.logbook, (at) => typeof at === 'string'),
  };
}

class FaultLog {

  /**
   * @param {any} [stored] the stored FaultLogState
   */
  constructor(stored) {
    this.state = faultLogStateFrom(stored);
    /** @type {Fault[]} */
    this.faults = [];
  }

  /**
   * Reads a successful response: the active faults, the ones that are new, the new logbook entries
   * (oldest first; the first logbook seen is history) and whether the state should be stored.
   * @param {FeaturesResponse} response
   * @returns {{ faults: Fault[], newFaults: Fault[], logbook: LogbookEntry[], changed: boolean }}
   */
  read(response) {
    const faults = readFaults(response);
    /** @type {Fault[]} */
    let newFaults = [];
    let changed = false;
    if (faults !== undefined) {
      newFaults = faults.filter((fault) => !this.state.faults.includes(fault.code));
      changed = newFaults.length > 0 || faults.length !== this.state.faults.length;
      this.state.faults = faults.map((fault) => fault.code);
      this.faults = faults;
    }
    const entries = readLogbook(response) || [];
    const seen = this.state.logbook;
    const logbook = entriesAfter(entries, seen, (entry) => entry.timestamp, logbookKey);
    this.state.logbook = logbook.position;
    return {
      faults: this.faults, newFaults, logbook: seen ? logbook.fresh : [], changed: changed || logbook.changed,
    };
  }

}

module.exports = {
  FaultLog, readFaults, readLogbook, faultLogStateFrom, FAULT_PATHS,
};
