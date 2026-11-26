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

// How often a device is updated and how many API calls a day that plans for a Viessmann login:
// the device settings `pollInterval` ("auto", or minutes) and `eventLog` ("off", or minutes).
// Also what a poll asks for (the polled paths on the device's heating circuit, and now and then
// all features) and the key of a device's poller. Pure; driver.js asks for a device's interval,
// and deviceSettings.js refuses settings that plan too many calls (see lib/apiQuota.js). The wait
// after a failed poll is lib/apiError.js → retryDelay.

const { callsPerDay, PLANNED_LIMIT } = require('../../lib/apiQuota');
const { PATHS } = require('./config');
const { resolveCircuitPath } = require('./heatingCircuit');
const { eventLogMinutes } = require('./eventLog');

// Automatic: every 2 minutes per device, about 720 calls a day for all devices together
const AUTO_INTERVAL_PER_DEVICE = 2 * 60 * 1000;

/**
 * A device's poll interval in milliseconds: its setting in minutes (at least 2), or automatic.
 * @param {unknown} setting the `pollInterval` setting
 * @param {number} deviceCount all devices of the app
 * @returns {number}
 */
function pollInterval(setting, deviceCount) {
  const minutes = Number(setting);
  if (Number.isFinite(minutes) && minutes * 60 * 1000 >= AUTO_INTERVAL_PER_DEVICE) return minutes * 60 * 1000;
  return AUTO_INTERVAL_PER_DEVICE * Math.max(1, deviceCount);
}

/**
 * The API calls a day that the devices of one login plan: polls and event log reads.
 * @param {{ pollInterval?: unknown, eventLog?: unknown }[]} settings one entry per device of the login
 * @param {number} deviceCount all devices of the app (for the automatic interval)
 * @returns {number}
 */
function plannedCallsPerDay(settings, deviceCount) {
  return settings.reduce((calls, device) => calls
    + callsPerDay(pollInterval(device.pollInterval, deviceCount) / 60000)
    + callsPerDay(eventLogMinutes(device.eventLog)), 0);
}

/**
 * True when planned calls leave enough of Viessmann's daily calls for everything else.
 * @param {number} calls
 * @returns {boolean}
 */
const withinPlan = (calls) => calls <= PLANNED_LIMIT;

// About one poll in 30 reads all features instead of only PATHS, so that new features are found
const EXTENDED_POLL_SHARE = 0.03;

/**
 * True when this poll reads all features (statistically every 30th poll).
 * @param {number} [random] a number in [0, 1)
 * @returns {boolean}
 */
const isExtendedPoll = (random = Math.random()) => random < EXTENDED_POLL_SHARE;

/**
 * The paths a regular poll requests: every path in PATHS, on the device's heating circuit. A
 * feature without a PATHS constant is never polled.
 * @param {string | undefined} heatingCircuitId
 * @returns {string}
 */
function pollFilter(heatingCircuitId) {
  return Object.values(PATHS).map((path) => resolveCircuitPath(path, heatingCircuitId)).join(',');
}

/**
 * The key of a device's poller in the driver.
 * @param {{ installationId: unknown, gatewaySerial: unknown, deviceId: unknown }} ids
 * @returns {string}
 */
function pollingKey({ installationId, gatewaySerial, deviceId }) {
  return `${installationId}-${gatewaySerial}-${deviceId}`;
}

module.exports = {
  pollInterval,
  plannedCallsPerDay,
  withinPlan,
  isExtendedPoll,
  pollFilter,
  pollingKey,
  AUTO_INTERVAL_PER_DEVICE,
  PLANNED_LIMIT,
  EXTENDED_POLL_SHARE,
};
