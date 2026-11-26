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

// "Frozen" values: Viessmann keeps answering, but the heating system stopped sending new values.
// They count as frozen when the newest feature timestamp of the responses has not moved for
// FROZEN_AFTER of successful polls. Only what the app has seen counts, not the age of the
// timestamps, so a clock that is off or an old response at the start never counts as frozen.

const FROZEN_AFTER = 6 * 60 * 60 * 1000;

/**
 * The newest feature timestamp of a response (epoch milliseconds), or undefined.
 * @param {{ data: any[] }} response
 * @returns {number | undefined}
 */
function newestTimestamp(response) {
  let newest;
  for (const feature of response.data) {
    const time = Date.parse(feature?.timestamp);
    if (Number.isFinite(time) && (newest === undefined || time > newest)) newest = time;
  }
  return newest;
}

class FrozenValues {

  /**
   * @param {number} [frozenAfter]
   */
  constructor(frozenAfter = FROZEN_AFTER) {
    this.frozenAfter = frozenAfter;
    /** @type {{ newest: number, movedAt: number } | null} */
    this.seen = null;
  }

  /**
   * Takes a successful response; returns since when the values are frozen (the newest timestamp)
   * or null.
   * @param {{ data: any[] }} response
   * @param {number} now
   * @returns {number | null}
   */
  update(response, now) {
    const newest = newestTimestamp(response);
    if (newest !== undefined && (!this.seen || newest > this.seen.newest)) this.seen = { newest, movedAt: now };
    return this.seen && now - this.seen.movedAt >= this.frozenAfter ? this.seen.newest : null;
  }

}

module.exports = { FrozenValues, newestTimestamp, FROZEN_AFTER };
