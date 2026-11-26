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

// A sliding-window limit on how often something may happen, e.g. writes to the heating
// controller from Flows: at most `limit` times in any `windowMs`. Kept in memory only.

class RateLimiter {

  /**
   * @param {number} limit
   * @param {number} windowMs
   * @param {() => number} [now]
   */
  constructor(limit, windowMs, now = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    /** @type {number[]} */
    this.times = [];
  }

  /**
   * Milliseconds until the next time is allowed; 0 when it is allowed now.
   * @returns {number}
   */
  waitTime() {
    const now = this.now();
    this.times = this.times.filter((time) => now - time < this.windowMs);
    if (this.times.length < this.limit) return 0;
    return this.times[0] + this.windowMs - now;
  }

  /**
   * Records one time, if allowed. Returns 0 when it was recorded, otherwise the milliseconds
   * until the next time is allowed (and records nothing).
   * @returns {number}
   */
  take() {
    const wait = this.waitTime();
    if (wait === 0) this.times.push(this.now());
    return wait;
  }

}

module.exports = RateLimiter;
