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

// How the Flow cards with a `kind` in flowCards.js run (cards without one read or write their
// capability directly, in driver.js). One table per card group, keyed by kind, so a new card
// type is one entry here and its mapping in flowCards.js:
//
//   CONDITIONS  answer from the card's arguments; capability conditions use knownValue, which
//               fails while the value is unknown (null) instead of answering "no". The generic
//               condition reads any numeric feature like the read cards (featureCards.js).
//   TRIGGERS    for a capability change from a known value to a known value: the card's tokens,
//               or null to not fire. Fired from device.setCapabilityValueIfPossible; the first
//               value after pairing, after a start or after a gap (value cleared) is no change.
//   ACTIONS     run with the card's arguments (the device in args.device); what they return
//               becomes the card's tokens.
//   AUTOCOMPLETE  the choices of an autocomplete argument, for conditions and actions.

const heatingCurve = require('./heatingCurve');
const { boostsOf } = require('./boost');
const featureCards = require('./featureCards');
const { userError } = require('./userErrors');

/** @typedef {import('./flowCards').FlowCardMapping} FlowCardMapping */
/** @typedef {Record<string, any> & { device: any }} CardArgs */

/**
 * The card's capability value; throws a translated error while it is unknown.
 * @param {any} device
 * @param {FlowCardMapping} mapping
 * @returns {any}
 */
function knownValue(device, mapping) {
  const value = device.getCapabilityValue(/** @type {string} */ (mapping.capability));
  if (value === null || value === undefined) throw userError(device, 'value_unknown');
  return value;
}

/**
 * The answer of an above/below card.
 * @param {number} value
 * @param {string} comparison 'above' or 'below'
 * @param {number} limit
 * @returns {boolean}
 */
function compareNumber(value, comparison, limit) {
  return comparison === 'below' ? value < limit : value > limit;
}

/** @type {Record<string, (args: CardArgs, mapping: FlowCardMapping) => boolean | Promise<boolean>>} */
const CONDITIONS = {
  isOn: (args, mapping) => knownValue(args.device, mapping) === true,
  compare: (args, mapping) => compareNumber(knownValue(args.device, mapping), args.comparison, Number(args.temperature)),
  // Any numeric feature of the device (featureCards.js), for standard Flows
  async compareFeature(args) {
    const { number } = await featureCards.readNumber(args.device, args.feature);
    return compareNumber(number, args.comparison, Number(args.value));
  },
};

/** @type {Record<string, (value: any, previous: any) => Record<string, any> | null>} */
const TRIGGERS = {
  turnedOn: (value) => (value === true ? {} : null),
  turnedOff: (value) => (value === false ? {} : null),
  changed: (value) => ({ temperature: value }),
};

/** @type {Record<string, (args: CardArgs) => Promise<any>>} */
const ACTIONS = {
  setCurveShift: async (args) => {
    await heatingCurve.writeCurve(args.device, { shift: Number(args.shift) });
  },
  adjustCurveShift: async (args) => {
    await heatingCurve.adjustShift(args.device, Number(args.change));
  },
  setCurveSlope: async (args) => {
    await heatingCurve.writeCurve(args.device, { slope: Number(args.slope) });
  },
  boostHotWater: (args) => boostsOf(args.device).boostHotWater(Number(args.temperature), Number(args.minutes)),
  boostCurveShift: (args) => boostsOf(args.device).boostCurveShift(Number(args.change), Number(args.minutes)),
  boostHotWaterCharge: (args) => boostsOf(args.device).boostHotWaterCharge(Number(args.minutes)),
  endBoosts: (args) => boostsOf(args.device).endAll(),
  readNumber: (args) => featureCards.readNumber(args.device, args.feature),
  readText: (args) => featureCards.readText(args.device, args.feature),
  runCommand: (args) => featureCards.runCommand(args.device, args.command, args.parameters),
};

/** @type {Record<string, { arg: string, choices: (device: any, query: string) => Promise<any[]> | any[] }>} */
const AUTOCOMPLETE = {
  compareFeature: { arg: 'feature', choices: (device, query) => featureCards.valueChoices(device, query, { numbers: true }) },
  readNumber: { arg: 'feature', choices: (device, query) => featureCards.valueChoices(device, query, { numbers: true }) },
  readText: { arg: 'feature', choices: (device, query) => featureCards.valueChoices(device, query) },
  runCommand: { arg: 'command', choices: (device, query) => featureCards.commandChoices(device, query) },
};

/**
 * The handler of a kind from one of the tables; throws for a kind it does not have.
 * @template T
 * @param {Record<string, T>} table
 * @param {FlowCardMapping} mapping
 * @returns {T}
 */
function handlerFor(table, mapping) {
  const handler = table[/** @type {string} */ (mapping.kind)];
  if (!handler) throw new Error(`Unknown Flow card kind: ${mapping.kind} (${mapping.id})`);
  return handler;
}

/**
 * The answer of a condition card with a kind.
 * @param {CardArgs} args
 * @param {FlowCardMapping} mapping
 * @returns {boolean | Promise<boolean>}
 */
function checkCondition(args, mapping) {
  return handlerFor(CONDITIONS, mapping)(args, mapping);
}

/**
 * Runs an action card with a kind; returns the card's tokens, if it has any.
 * @param {CardArgs} args
 * @param {FlowCardMapping} mapping
 * @returns {Promise<any>}
 */
async function runAction(args, mapping) {
  return handlerFor(ACTIONS, mapping)(args);
}

/**
 * Fires the trigger cards with a kind for a capability whose value changed from `previous` to
 * `value` (both as the capability shows them). A failing card is logged; the others still run.
 * @param {any} device
 * @param {string} capabilityName
 * @param {any} value
 * @param {any} previous
 */
async function fireValueTriggers(device, capabilityName, value, previous) {
  if (previous === null || previous === undefined || value === null || value === undefined) return;
  /** @type {{ card: { trigger: Function }, mapping: FlowCardMapping }[]} */
  const triggers = device.driver?.getValueTriggers?.(capabilityName) || [];
  for (const { card, mapping } of triggers) {
    try {
      const tokens = handlerFor(TRIGGERS, mapping)(value, previous);
      if (tokens) await card.trigger(device, tokens, {});
    } catch (error) {
      device.error(`Could not run the trigger ${mapping.id}:`, error);
    }
  }
}

/**
 * Registers the autocomplete of a card whose kind has one.
 * @param {{ registerArgumentAutocompleteListener: Function }} card
 * @param {FlowCardMapping} mapping
 */
function registerAutocomplete(card, mapping) {
  const autocomplete = AUTOCOMPLETE[/** @type {string} */ (mapping.kind)];
  if (!autocomplete) return;
  card.registerArgumentAutocompleteListener(autocomplete.arg,
    async (/** @type {string} */ query, /** @type {CardArgs} */ args) => autocomplete.choices(args.device, query));
}

/**
 * Registers the run (and autocomplete) listeners of the condition and action cards with a kind.
 * A card that cannot be registered is logged; the others still work.
 * @param {{ homey: any, error: (...args: any[]) => void }} driver
 * @param {{ conditions: FlowCardMapping[], actions: FlowCardMapping[] }} cards
 */
function registerFlowCardsWithKind(driver, { conditions, actions }) {
  for (const condition of conditions.filter((mapping) => mapping.kind)) {
    try {
      const card = driver.homey.flow.getConditionCard(condition.id);
      card.registerRunListener(async (/** @type {CardArgs} */ args) => checkCondition(args, condition));
      registerAutocomplete(card, condition);
    } catch (error) {
      driver.error(`Failed to register condition ${condition.id}:`, error);
    }
  }
  for (const action of actions.filter((mapping) => mapping.kind)) {
    try {
      const card = driver.homey.flow.getActionCard(action.id);
      card.registerRunListener(async (/** @type {CardArgs} */ args) => runAction(args, action));
      registerAutocomplete(card, action);
    } catch (error) {
      driver.error(`Failed to register action ${action.id}:`, error);
    }
  }
}

module.exports = {
  CONDITIONS, TRIGGERS, ACTIONS, AUTOCOMPLETE, knownValue, checkCondition, runAction, fireValueTriggers, registerFlowCardsWithKind,
};
