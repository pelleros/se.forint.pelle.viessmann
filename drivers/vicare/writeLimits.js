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

// Whether a Flow card may write to the heating controller now. The limits stop runaway Flows
// (a Flow that fires far more often than intended); normal use, such as a PV-surplus Flow every
// 5 minutes, stays well below them. One sliding window per device and kind of write, per hour
// (lib/rateLimiter.js), kept in memory.
//
// The caller runs takeWrite after its own checks pass and before it sends, so a refused value
// never uses up a write. Restoring a temporary change does not call it: it must always happen.
// A new kind of write is one entry in WRITE_LIMITS. A further reason to refuse a write (for
// example a daily quota) is one more function in WRITE_CHECKS: it runs after the hourly limit
// and before the write is counted, and refuses by throwing a userError.

const RateLimiter = require('../../lib/rateLimiter');
const { userError } = require('./userErrors');

const HOUR = 60 * 60 * 1000;

/**
 * Writes per hour, by kind.
 * @type {Readonly<Record<string, number>>}
 */
const WRITE_LIMITS = Object.freeze({
  heatingCurve: 12,
  hotWaterBoost: 12,
  hotWaterCharge: 12,
  command: 30,
});

/**
 * @typedef {import('./userErrors').MessageDevice & { _writeLimiters?: Record<string, RateLimiter> }} WriteDevice
 * @typedef {(device: WriteDevice, kind: string) => void} WriteCheck throws to refuse the write
 */

/**
 * The device's hourly window for `kind`.
 * @param {WriteDevice} device
 * @param {string} kind
 * @param {() => number} now
 * @returns {RateLimiter}
 */
function limiterFor(device, kind, now) {
  const limit = WRITE_LIMITS[kind];
  if (!limit) throw new Error(`No write limit for "${kind}"`);
  if (!device._writeLimiters) device._writeLimiters = {};
  if (!device._writeLimiters[kind]) device._writeLimiters[kind] = new RateLimiter(limit, HOUR, now);
  return device._writeLimiters[kind];
}

/**
 * The checks every write must pass, in order, after the hourly limit.
 * @type {WriteCheck[]}
 */
const WRITE_CHECKS = [];

/**
 * Counts one write of `kind` for the device, or throws (counting nothing) when the device has
 * reached its hourly limit for that kind or one of WRITE_CHECKS refuses it.
 * @param {WriteDevice} device
 * @param {string} kind a key of WRITE_LIMITS
 * @param {() => number} [now]
 */
function takeWrite(device, kind, now = Date.now) {
  const limiter = limiterFor(device, kind, now);
  const wait = limiter.waitTime();
  if (wait > 0) throw userError(device, 'rate_limited', { limit: WRITE_LIMITS[kind], minutes: Math.ceil(wait / 60000) });
  for (const check of WRITE_CHECKS) check(device, kind);
  limiter.take();
}

module.exports = { WRITE_LIMITS, WRITE_CHECKS, takeWrite };
