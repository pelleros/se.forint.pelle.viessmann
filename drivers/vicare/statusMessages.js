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

// The texts of the device's status, in the user's language: the warning that says what is wrong
// (faults, values that stopped updating, writes that did not take) and the notifications.

const { translate, formatDateTime } = require('../../lib/errorMessages');
const { featureMapper } = require('./featureMapper');

/**
 * A write the heating system did not take.
 * @typedef {object} WriteProblem
 * @property {string} capabilityName
 * @property {Record<string, any>} options the capability's options on the device (units, values)
 * @property {unknown} wanted
 * @property {unknown} actual
 */

/**
 * Homey's language, English when it is not known.
 * @param {any} homey
 * @returns {string}
 */
function language(homey) {
  try {
    return homey?.i18n?.getLanguage?.() || 'en';
  } catch (error) {
    return 'en';
  }
}

/**
 * A capability value as the user sees it: a mode with its title, a number with its unit.
 * @param {Record<string, any>} options
 * @param {unknown} value
 * @param {string} lang
 * @returns {string}
 */
function describeValue(options, value, lang) {
  const mode = Array.isArray(options.values) ? options.values.find((item) => item.id === value) : undefined;
  if (mode) return mode.title?.[lang] || mode.title?.en || String(value);
  const units = typeof options.units === 'string' ? options.units : options.units?.[lang] || options.units?.en;
  return units ? `${value} ${units}` : String(value);
}

/**
 * A capability's configured title in a language.
 * @param {string} capabilityName
 * @param {string} lang
 * @returns {string}
 */
function capabilityTitle(capabilityName, lang) {
  const title = featureMapper.capabilityByName(capabilityName)?.capabilityOptions?.title || {};
  return title[lang] || title.en || capabilityName;
}

/**
 * The message for a write that did not take.
 * @param {any} homey
 * @param {WriteProblem} problem
 * @returns {string}
 */
function writeMessage(homey, {
  capabilityName, options, wanted, actual,
}) {
  const lang = language(homey);
  return translate(homey, 'status.write_not_applied', {
    capability: capabilityTitle(capabilityName, lang),
    wanted: describeValue(options, wanted, lang),
    actual: describeValue(options, actual, lang),
  });
}

/**
 * The device's warning for its current problems, or '' when there are none.
 * @param {any} homey
 * @param {{ faults: string[], frozenSince: number | null, writes: WriteProblem[] }} problems
 * @returns {string}
 */
function warningText(homey, { faults, frozenSince, writes }) {
  const messages = [];
  if (faults.length > 0) messages.push(translate(homey, 'status.fault', { codes: faults.join(', ') }));
  if (frozenSince !== null) messages.push(translate(homey, 'status.frozen', { time: formatDateTime(homey, frozenSince) }));
  for (const problem of writes) messages.push(writeMessage(homey, problem));
  return messages.join(' ');
}

module.exports = {
  warningText, writeMessage, describeValue, capabilityTitle, language,
};
