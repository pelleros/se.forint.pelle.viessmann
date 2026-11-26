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

// Writes that did not take: after a successful command, the polls at least WRITE_CHECK_AFTER
// later check that the capability reports the value written. One poll with the value confirms
// the write. Viessmann's data can lag behind, so a write counts as not taken only when
// REJECT_AFTER_POLLS polls in a row report another value; a poll without the value, or one while
// the values count as frozen (frozenValues.js), judges nothing and starts the count again. Pure
// and kept in memory; whoever sends commands remembers the write, and the poll checks it.

const MINUTE = 60 * 1000;
// Viessmann needs a moment before a poll shows a write
const WRITE_CHECK_AFTER = MINUTE;
// A write whose value no poll reports within this time is forgotten without a message
const WRITE_CHECK_EXPIRY = 15 * MINUTE;
// Polls in a row that must report another value before a write counts as not taken
const REJECT_AFTER_POLLS = 2;

/**
 * True when a reported value is the value written (numbers within rounding).
 * @param {unknown} wanted
 * @param {unknown} actual
 * @returns {boolean}
 */
const sameValue = (wanted, actual) => (typeof wanted === 'number' && typeof actual === 'number'
  ? Math.abs(wanted - actual) < 0.01 : wanted === actual);

class WriteChecks {

  constructor() {
    /** @type {Map<string, { value: unknown, at: number, mismatches: number }>} */
    this.writes = new Map();
  }

  /**
   * Remembers a value written to a capability, to check it on a later poll.
   * @param {string} capabilityName
   * @param {unknown} value
   * @param {number} now
   */
  remember(capabilityName, value, now) {
    this.writes.set(capabilityName, { value, at: now, mismatches: 0 });
  }

  /**
   * Checks the remembered writes against a poll: the writes the device did not take (`actual` is
   * what it reports instead) and the ones it did.
   * @param {(capabilityName: string) => unknown} reportedValue the value the poll reports, or undefined
   * @param {number} now
   * @param {{ frozen?: boolean }} [poll] `frozen`: the poll's values count as frozen
   * @returns {{ rejected: { capabilityName: string, wanted: unknown, actual: unknown }[], confirmed: string[] }}
   */
  check(reportedValue, now, { frozen = false } = {}) {
    const rejected = [];
    const confirmed = [];
    for (const [capabilityName, write] of this.writes) {
      if (now - write.at < WRITE_CHECK_AFTER) continue;
      const actual = frozen ? undefined : reportedValue(capabilityName);
      if (actual === undefined || actual === null) {
        write.mismatches = 0;
        if (now - write.at > WRITE_CHECK_EXPIRY) this.writes.delete(capabilityName);
      } else if (sameValue(write.value, actual)) {
        this.writes.delete(capabilityName);
        confirmed.push(capabilityName);
      } else {
        write.mismatches += 1;
        if (write.mismatches >= REJECT_AFTER_POLLS) {
          this.writes.delete(capabilityName);
          rejected.push({ capabilityName, wanted: write.value, actual });
        }
      }
    }
    return { rejected, confirmed };
  }

}

module.exports = {
  WriteChecks, sameValue, WRITE_CHECK_AFTER, WRITE_CHECK_EXPIRY, REJECT_AFTER_POLLS,
};
