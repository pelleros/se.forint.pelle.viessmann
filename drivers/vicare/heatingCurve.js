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

// Writing the heating curve of the device's heating circuit. Viessmann's `setCurve` takes the
// shift and the slope together, so a card that changes one of them sends the current value of
// the other (from the read-back capabilities in config/circuits.js). The command's limits come
// from the device's command metadata; a value outside them is refused before anything is sent.
// Writes are limited per device (writeLimits.js), and a write that changes nothing is skipped.

const { PATHS } = require('./config');
const { checkFeatureCommand, sendFeatureCommand } = require('./commands');
const { userError } = require('./userErrors');
const { takeWrite } = require('./writeLimits');

const CURVE_PATH = PATHS.HEATING_CIRCUIT_0_CURVE;
const SHIFT = 'measure_curve_number.circuit0Shift';
const SLOPE = 'measure_curve_number.circuit0Slope';

/**
 * @typedef {import('./commands').CommandDevice & import('./userErrors').MessageDevice & {
 *   getCapabilityValue: (name: string) => any,
 *   setCapabilityValueIfPossible: (name: string, value: any, options?: { trigger?: boolean }) => Promise<void>,
 * }} CurveDevice
 */

/**
 * Rounds a value to the command parameter's stepping (counted from its minimum), so that
 * adding steps of 0.1 never sends 1.2000000000000002.
 * @param {number} value
 * @param {{ min?: number, stepping?: number } | undefined} constraints
 * @returns {number}
 */
function roundToStep(value, constraints) {
  const stepping = constraints?.stepping;
  if (!stepping) return value;
  const min = constraints?.min || 0;
  const rounded = min + Math.round((value - min) / stepping) * stepping;
  const decimals = (String(stepping).split('.')[1] || '').length;
  return Number(rounded.toFixed(decimals));
}

/**
 * The constraints of a setCurve parameter from the device's command metadata, if known.
 * @param {CurveDevice} device
 * @param {'shift' | 'slope'} name
 */
function curveConstraints(device, name) {
  return device._commands?.[CURVE_PATH]?.setCurve?.params?.[name]?.constraints;
}

/**
 * The curve as the device last reported it; throws when either value is unknown.
 * @param {CurveDevice} device
 * @returns {{ shift: number, slope: number }}
 */
function currentCurve(device) {
  const shift = device.getCapabilityValue(SHIFT);
  const slope = device.getCapabilityValue(SLOPE);
  if (typeof shift !== 'number' || typeof slope !== 'number') throw userError(device, 'value_unknown');
  return { shift, slope };
}

/**
 * Sets the shift and/or the slope. Returns false when the curve already has these values (then
 * nothing is sent or counted). `limited: false` is for restoring a temporary change.
 * @param {CurveDevice} device
 * @param {{ shift?: number, slope?: number }} values
 * @param {{ limited?: boolean }} [options]
 * @returns {Promise<boolean>}
 */
async function writeCurve(device, { shift, slope }, { limited = true } = {}) {
  const current = currentCurve(device);
  const next = {
    slope: roundToStep(slope ?? current.slope, curveConstraints(device, 'slope')),
    shift: roundToStep(shift ?? current.shift, curveConstraints(device, 'shift')),
  };
  if (next.shift === current.shift && next.slope === current.slope) return false;
  // Refused values do not use up a write
  checkFeatureCommand(device, CURVE_PATH, 'setCurve', next);
  if (limited) takeWrite(device, 'heatingCurve');
  // Restoring a temporary change is never refused for the account's allowance (writeQuota.js)
  await sendFeatureCommand(device, CURVE_PATH, 'setCurve', next, { restoring: !limited, confirm: { [SHIFT]: next.shift, [SLOPE]: next.slope } });
  // Shown right away; the next poll shows what the controller really has
  await device.setCapabilityValueIfPossible(SHIFT, next.shift);
  await device.setCapabilityValueIfPossible(SLOPE, next.slope);
  return true;
}

/**
 * Changes the shift by `change` (positive or negative).
 * @param {CurveDevice} device
 * @param {number} change
 * @returns {Promise<boolean>}
 */
async function adjustShift(device, change) {
  return writeCurve(device, { shift: currentCurve(device).shift + change });
}

module.exports = {
  CURVE_PATH, SHIFT, SLOPE, roundToStep, currentCurve, writeCurve, adjustShift,
};
