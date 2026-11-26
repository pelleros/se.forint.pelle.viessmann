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

// How often Flow cards may write to the heating controller, per device and kind of write, per
// hour. One sliding window per device and kind (lib/rateLimiter.js), kept in memory. A new kind
// of write gets an entry in WRITE_LIMITS; the caller counts a write with takeWrite after its
// checks pass and before it sends, so a refused value never uses up a write. Restoring a
// temporary change is not counted: it must always happen.

const RateLimiter = require('../../lib/rateLimiter');
const { userError } = require('./userErrors');

const HOUR = 60 * 60 * 1000;

/**
 * Writes per hour, by kind.
 * @type {Readonly<Record<string, number>>}
 */
const WRITE_LIMITS = Object.freeze({
  heatingCurve: 6,
  hotWaterBoost: 6,
  hotWaterCharge: 6,
  command: 20,
});

/**
 * Counts one write of `kind` for the device, or throws a translated error (counting nothing)
 * when the device has reached the limit for that kind.
 * @param {import('./userErrors').MessageDevice & { _writeLimiters?: Record<string, RateLimiter> }} device
 * @param {string} kind a key of WRITE_LIMITS
 * @param {() => number} [now]
 */
function takeWrite(device, kind, now = Date.now) {
  const limit = WRITE_LIMITS[kind];
  if (!limit) throw new Error(`No write limit for "${kind}"`);
  if (!device._writeLimiters) device._writeLimiters = {};
  if (!device._writeLimiters[kind]) device._writeLimiters[kind] = new RateLimiter(limit, HOUR, now);
  const wait = device._writeLimiters[kind].take();
  if (wait > 0) throw userError(device, 'rate_limited', { limit, minutes: Math.ceil(wait / 60000) });
}

module.exports = { WRITE_LIMITS, takeWrite };
