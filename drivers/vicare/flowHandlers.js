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
// capability directly, in driver.js):
//
//   conditions  isOn: the boolean capability is true; compare: the number capability is above
//               or below the card's value. Both fail while the value is unknown (null), instead
//               of answering "no".
//   triggers    turnedOn, turnedOff, changed: fired from device.setCapabilityValueIfPossible,
//               only for a change from a known value. The first value after pairing, after a
//               start without a value or after a gap (value cleared) is no change.
//   actions     the heating curve (heatingCurve.js), temporary changes (boost.js) and the
//               generic feature cards (featureCards.js).

const { FLOW_CONDITIONS, FLOW_ACTIONS } = require('./flowCards');
const heatingCurve = require('./heatingCurve');
const { boostsOf } = require('./boost');
const featureCards = require('./featureCards');
const { flowError } = require('./flowMessages');

/** @typedef {import('./flowCards').FlowCardMapping} FlowCardMapping */

/**
 * The answer of a condition card with a kind.
 * @param {any} device
 * @param {FlowCardMapping} mapping
 * @param {Record<string, any>} args
 * @returns {boolean}
 */
function checkCondition(device, mapping, args) {
  const value = device.getCapabilityValue(/** @type {string} */ (mapping.capability));
  if (value === null || value === undefined) throw flowError(device, 'value_unknown');
  if (mapping.kind === 'compare') {
    const limit = Number(args.temperature);
    return args.comparison === 'below' ? value < limit : value > limit;
  }
  return value === true;
}

/**
 * Fires the trigger cards with a kind for a capability whose value changed from `previous` to
 * `value` (both as the capability shows them).
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
    if (mapping.kind === 'turnedOn' && value !== true) continue;
    if (mapping.kind === 'turnedOff' && value !== false) continue;
    const tokens = mapping.kind === 'changed' ? { temperature: value } : {};
    try {
      await card.trigger(device, tokens, {});
    } catch (error) {
      device.error(`Could not run the trigger ${mapping.id}:`, error);
    }
  }
}

/**
 * Runs an action card with a kind. Returns the tokens of the cards that have them.
 * @param {FlowCardMapping} mapping
 * @param {Record<string, any>} args
 * @returns {Promise<any>}
 */
async function runAction(mapping, args) {
  const { device } = args;
  switch (mapping.kind) {
    case 'setCurveShift':
      return heatingCurve.writeCurve(device, { shift: Number(args.shift) }).then(() => undefined);
    case 'adjustCurveShift':
      return heatingCurve.adjustShift(device, Number(args.change)).then(() => undefined);
    case 'setCurveSlope':
      return heatingCurve.writeCurve(device, { slope: Number(args.slope) }).then(() => undefined);
    case 'boostHotWater':
      return boostsOf(device).boostHotWater(Number(args.temperature), Number(args.minutes));
    case 'boostCurveShift':
      return boostsOf(device).boostCurveShift(Number(args.change), Number(args.minutes));
    case 'boostHotWaterCharge':
      return boostsOf(device).boostHotWaterCharge(Number(args.minutes));
    case 'endBoosts':
      return boostsOf(device).endAll();
    case 'readNumber':
      return featureCards.readNumber(device, args.feature);
    case 'readText':
      return featureCards.readText(device, args.feature);
    case 'runCommand':
      return featureCards.runCommand(device, args.command, args.parameters);
    default:
      throw new Error(`Unknown Flow card kind: ${mapping.kind}`);
  }
}

// Autocomplete listeners of the generic cards, per kind: argument name → choices
/** @type {Record<string, { arg: string, choices: (device: any, query: string) => Promise<any[]> | any[] }>} */
const AUTOCOMPLETE = {
  readNumber: { arg: 'feature', choices: (device, query) => featureCards.valueChoices(device, query, { numbers: true }) },
  readText: { arg: 'feature', choices: (device, query) => featureCards.valueChoices(device, query) },
  runCommand: { arg: 'command', choices: (device, query) => featureCards.commandChoices(device, query) },
};

/**
 * Registers the run (and autocomplete) listeners of the condition and action cards with a kind.
 * A card that cannot be registered is logged; the others still work.
 * @param {{ homey: any, log: (...args: any[]) => void, error: (...args: any[]) => void }} driver
 */
function registerFlowCardsWithKind(driver) {
  for (const condition of Object.values(FLOW_CONDITIONS)) {
    if (!condition.kind) continue;
    try {
      driver.homey.flow.getConditionCard(condition.id)
        .registerRunListener(async (/** @type {any} */ args) => checkCondition(args.device, condition, args));
    } catch (error) {
      driver.error(`Failed to register condition ${condition.id}:`, error);
    }
  }
  for (const action of Object.values(FLOW_ACTIONS)) {
    if (!action.kind) continue;
    try {
      const card = driver.homey.flow.getActionCard(action.id);
      card.registerRunListener(async (/** @type {any} */ args) => runAction(action, args));
      const autocomplete = AUTOCOMPLETE[action.kind];
      if (autocomplete) {
        card.registerArgumentAutocompleteListener(autocomplete.arg,
          async (/** @type {string} */ query, /** @type {any} */ args) => autocomplete.choices(args.device, query));
      }
    } catch (error) {
      driver.error(`Failed to register action ${action.id}:`, error);
    }
  }
}

module.exports = {
  checkCondition, fireValueTriggers, runAction, registerFlowCardsWithKind,
};
