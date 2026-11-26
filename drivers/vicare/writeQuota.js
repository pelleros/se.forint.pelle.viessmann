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

// Whether the Viessmann account can spare an API call for a write now. The app counts its calls
// per Viessmann login (OAuth session), shared by all the account's devices (lib/apiQuota.js). A
// write is refused only when
// - after it, the calls left today (until 00:00 UTC) would no longer cover the updates planned
//   for the account's devices until then (pollPlan.js, pro rata), so that the updates keep
//   running; or
// - the account has sent WRITE_BURST_LIMIT writes in the last 10 minutes.
// Normal use comes nowhere near either. Undoing a temporary change (boost.js) is never refused.
// commands.js runs this for every write, after the command has passed its own checks; the
// per-device hourly limits for Flow cards are in writeLimits.js.

const {
  ApiQuota, DAILY_LIMIT, WRITE_BURST_LIMIT, nextReset,
} = require('../../lib/apiQuota');
const { formatDateTime } = require('../../lib/errorMessages');
const { userError } = require('./userErrors');

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/**
 * @typedef {{ reason: 'quota', left: number, resetsAt: number }
 *   | { reason: 'burst', waitMs: number }} WriteRefusal
 */

/**
 * The calls the planned updates need from `now` until the daily count starts again.
 * @param {number} plannedPerDay
 * @param {number} now
 * @returns {number}
 */
function plannedUntilReset(plannedPerDay, now) {
  return Math.ceil((plannedPerDay * (nextReset(now) - now)) / DAY);
}

/**
 * Why the account cannot spare a call for a write now, or null when it can.
 * @param {object} account
 * @param {number} account.usedToday the account's calls today (UTC)
 * @param {number} account.plannedPerDay the calls a day planned for its updates
 * @param {number} account.burstWaitMs time until its recent writes allow another one (0: now)
 * @param {number} account.now
 * @returns {WriteRefusal | null}
 */
function writeRefusal({
  usedToday, plannedPerDay, burstWaitMs, now,
}) {
  const left = Math.max(0, DAILY_LIMIT - usedToday);
  if (left - 1 < plannedUntilReset(plannedPerDay, now)) return { reason: 'quota', left, resetsAt: nextReset(now) };
  if (burstWaitMs > 0) return { reason: 'burst', waitMs: burstWaitMs };
  return null;
}

/**
 * The parts of a device the account check needs.
 * @typedef {import('./userErrors').MessageDevice & {
 *   getStoreValue?: (key: string) => any,
 *   driver?: { plannedCallsPerDay?: (sessionId: string | undefined) => number },
 * }} AccountDevice
 */

/**
 * The user's text for a refusal.
 * @param {AccountDevice} device
 * @param {WriteRefusal} refusal
 * @returns {Error & { code: string }}
 */
function refusalError(device, refusal) {
  if (refusal.reason === 'quota') {
    return userError(device, 'write_quota_reserved', { left: refusal.left, time: formatDateTime(device.homey, refusal.resetsAt) });
  }
  return userError(device, 'write_burst', { limit: WRITE_BURST_LIMIT, minutes: Math.ceil(refusal.waitMs / MINUTE) });
}

/**
 * Takes one write from the account's allowance, or throws the user's text (taking nothing) when
 * the account cannot spare the call. A `restoring` write is never refused; it is counted when
 * the window has room.
 * @param {AccountDevice} device
 * @param {{ restoring?: boolean, now?: () => number }} [options]
 */
function takeAccountWrite(device, { restoring = false, now = () => Date.now() } = {}) {
  const sessionId = device.getStoreValue?.('OAuth2SessionId');
  const quota = ApiQuota.for(device.homey);
  const window = quota.writeWindow(sessionId, now);
  if (!restoring) {
    const time = now();
    const refusal = writeRefusal({
      usedToday: quota.usedToday(sessionId, time),
      plannedPerDay: device.driver?.plannedCallsPerDay?.(sessionId) ?? 0,
      burstWaitMs: window.waitTime(),
      now: time,
    });
    if (refusal) throw refusalError(device, refusal);
  }
  window.take();
}

module.exports = { writeRefusal, plannedUntilReset, takeAccountWrite };
