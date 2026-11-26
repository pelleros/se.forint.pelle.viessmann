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

// How the Flow cards mapped in flowCards.js answer, run and fire, as plain functions: driver.js
// registers the cards with these, and fires the triggers of a capability that changed.

/** @typedef {import('./flowCards').FlowCardMapping} FlowCardMapping */

/**
 * The value of a Flow card argument: the id of a dropdown or autocomplete choice, else the
 * argument itself.
 * @param {any} value
 * @returns {any}
 */
function argumentValue(value) {
  return value && typeof value === 'object' && 'id' in value ? value.id : value;
}

/**
 * The answer of a condition card: the capability value compared with the card's `argument`,
 * or, without one, the (boolean) value itself.
 * @param {FlowCardMapping} condition
 * @param {any} value the capability's current value
 * @param {Record<string, any>} args the card's arguments
 * @returns {any}
 */
function conditionAnswer(condition, value, args) {
  return condition.argument ? value === argumentValue(args[condition.argument]) : value;
}

/**
 * The value an action card writes: its first argument other than the device.
 * @param {Record<string, any>} args the card's arguments without the device
 * @returns {any}
 */
function actionValue(args) {
  return argumentValue(args[Object.keys(args)[0]]);
}

/**
 * The tokens a trigger card fires with when its capability changed to `value`, or null when it
 * does not fire: a trigger with `when` fires only for that value, and one with a `token` does
 * not fire for a value that became unknown.
 * @param {{ when?: any, token?: string }} trigger
 * @param {any} value
 * @returns {Record<string, any> | null}
 */
function triggerTokens({ when, token }, value) {
  if (when !== undefined && when !== value) return null;
  if (!token) return {};
  return value === null || value === undefined ? null : { [token]: value };
}

/**
 * The values of an enum capability as autocomplete choices, titled in `language` (else
 * English) and filtered by what the user typed.
 * @param {{ id: string, title?: Record<string, string> }[] | undefined} values
 * @param {string} language
 * @param {string} [query]
 * @returns {{ id: string, name: string }[]}
 */
function autocompleteChoices(values, language, query = '') {
  const search = String(query || '').toLowerCase();
  return (values || [])
    .map((value) => ({ id: value.id, name: value.title?.[language] || value.title?.en || value.id }))
    .filter((choice) => choice.name.toLowerCase().includes(search) || choice.id.toLowerCase().includes(search));
}

module.exports = {
  argumentValue, conditionAnswer, actionValue, triggerTokens, autocompleteChoices,
};
