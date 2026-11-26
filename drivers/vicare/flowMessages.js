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

// Errors that Flow cards show to the user, in the user's language (locales/*.json → flow), and
// the per-device limits on how often the cards write to the heating controller.

const RateLimiter = require('../../lib/rateLimiter');

const HOUR = 60 * 60 * 1000;

// Writes from Flow cards, per device and per hour. Restoring after a temporary change is not
// limited: it must always happen.
/** @type {Readonly<Record<string, { limit: number, windowMs: number }>>} */
const WRITE_LIMITS = Object.freeze({
  heatingCurve: { limit: 6, windowMs: HOUR },
  hotWaterBoost: { limit: 6, windowMs: HOUR },
  hotWaterCharge: { limit: 6, windowMs: HOUR },
  command: { limit: 20, windowMs: HOUR },
});

// English texts for when no translation is available (tests, or a key missing at runtime).
// flowMessages.test.js checks that locales/en.json has the same texts.
/** @type {Readonly<Record<string, string>>} */
const FALLBACK = Object.freeze({
  value_unknown: 'No current value from Viessmann yet. Try again after the next update.',
  rate_limited: 'Too many changes in a short time (at most __limit__ per hour). Try again in __minutes__ minutes.',
  feature_not_reported: 'The device does not report __feature__.',
  property_not_reported: '__feature__ has no value __property__.',
  not_a_number: 'The value of __feature__ is not a number.',
  invalid_parameters: 'The parameters must be a JSON object, for example {"temperature": 50}, or {} for none.',
  unknown_parameter: 'The command has no parameter __parameter__.',
  no_command_metadata: 'The commands of the device are not known yet. Try again after the next update.',
  choose_from_list: 'Choose an entry from the list.',
});

/**
 * @typedef {object} MessageDevice
 * @property {{ __?: (key: string, tags?: Record<string, any>) => any }} [homey]
 */

/**
 * The user's text for `flow.<key>`, with its tags filled in.
 * @param {MessageDevice} device
 * @param {string} key
 * @param {Record<string, string | number>} [tags]
 * @returns {string}
 */
function flowMessage(device, key, tags = {}) {
  const translated = device?.homey?.__?.(`flow.${key}`, tags);
  if (typeof translated === 'string' && translated !== '' && translated !== `flow.${key}`) return translated;
  return Object.entries(tags)
    .reduce((text, [tag, value]) => text.split(`__${tag}__`).join(String(value)), FALLBACK[key] || key);
}

/**
 * An Error with the user's text for `flow.<key>`.
 * @param {MessageDevice} device
 * @param {string} key
 * @param {Record<string, string | number>} [tags]
 * @returns {Error}
 */
function flowError(device, key, tags) {
  return new Error(flowMessage(device, key, tags));
}

/**
 * Counts one write of `kind` for the device, or throws (counting nothing) when the device has
 * reached its limit for that kind.
 * @param {MessageDevice & { _writeLimiters?: Record<string, RateLimiter> }} device
 * @param {string} kind a key of WRITE_LIMITS
 * @param {() => number} [now]
 */
function takeWrite(device, kind, now = Date.now) {
  const { limit, windowMs } = WRITE_LIMITS[kind];
  if (!device._writeLimiters) device._writeLimiters = {};
  if (!device._writeLimiters[kind]) device._writeLimiters[kind] = new RateLimiter(limit, windowMs, now);
  const wait = device._writeLimiters[kind].take();
  if (wait > 0) throw flowError(device, 'rate_limited', { limit, minutes: Math.ceil(wait / 60000) });
}

module.exports = {
  WRITE_LIMITS, FALLBACK, flowMessage, flowError, takeWrite,
};
