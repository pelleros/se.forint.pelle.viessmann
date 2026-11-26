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

// The one place for errors that Flow cards and commands show to the user. Every such error is a
// text `flow.<key>` in locales/*.json, in every app language (test/locales.test.js checks that);
// lib/errorMessages.js translates it, with the English text as the fallback. Adding an error:
// add the key to all five locale files and throw userError(device, '<key>', { tags }). A module
// without a device throws an error with the key as its `code`; its caller turns it into the
// user's text with userErrorFrom.

const { translate } = require('../../lib/errorMessages');

/**
 * The parts of a device the errors need: Homey's i18n.
 * @typedef {object} MessageDevice
 * @property {{ __?: (key: string, tags?: Record<string, any>) => any }} [homey]
 */

/**
 * An Error with the user's text for `flow.<key>`, its `__tag__` placeholders filled in. The key
 * is kept as `code`, so callers and tests can tell errors apart without comparing texts.
 * @param {MessageDevice} device
 * @param {string} key
 * @param {Record<string, string | number>} [tags]
 * @returns {Error & { code: string }}
 */
function userError(device, key, tags = {}) {
  return Object.assign(new Error(translate(device?.homey, `flow.${key}`, tags)), { code: key });
}

/**
 * The user's text for an error from a module that has no device (config/*.js, holiday.js): an
 * error whose `code` is the key of a `flow.<key>` text becomes that userError, any other error
 * stays as it is.
 * @param {MessageDevice} device
 * @param {unknown} error
 * @returns {unknown}
 */
function userErrorFrom(device, error) {
  const code = /** @type {any} */ (error)?.code;
  if (typeof code !== 'string' || translate(undefined, `flow.${code}`) === `flow.${code}`) return error;
  return userError(device, code);
}

module.exports = { userError, userErrorFrom };
