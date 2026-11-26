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

// Runtime mapping of the Flow cards: which capability each card reads, writes or fires for.
// The cards themselves (titles in every language, arguments, $filter) are defined in
// driver.flow.compose.json, which is edited by hand. registry.test.js checks that both list
// the same cards and flowCompose.test.js that each card's $filter is its capability.

const { PATHS, getCapability } = require('./config');

/**
 * @typedef {object} FlowCardMapping
 * @property {string} id the card id in driver.flow.compose.json
 * @property {string} [capability] the capability the card reads, writes or fires for. Cards
 *   without one (and without `anyCapability`) work on every device and have no $filter
 * @property {string[]} [anyCapability] the card works on devices with any of these capabilities
 * @property {string} [kind] how a card that does more than read or write its capability runs
 *   (see flowHandlers.js); cards without a kind read or write the capability directly
 * @property {string} [argument] the card's argument that a kind compares the value with
 *   (`equals`) or takes the value from (`chooseValue`)
 * @property {string} [token] the token that carries the new value (trigger kind `valueChanged`)
 * @property {boolean} [event] a trigger the app fires for an event (with its own tokens),
 *   not for a change of the capability's value; the capability is the card's $filter
 */

/** @type {(path: string) => string} */
const capabilityOf = (path) => getCapability(path).capabilityName;

/** @type {Record<string, FlowCardMapping>} */
const FLOW_CONDITIONS = {
  COMPRESSOR_RUNNING: {
    id: 'compressor-is-running',
    capability: capabilityOf(PATHS.COMPRESSOR),
  },
  BURNER_RUNNING: {
    id: 'burner-is-running',
    capability: capabilityOf(PATHS.BURNER),
  },
  // The cards below fail while the value is unknown instead of answering false
  CIRCULATION_PUMP_RUNNING: {
    id: 'circulation-pump-is-running',
    capability: capabilityOf(PATHS.HEATING_CIRCUIT_0_PUMP),
    kind: 'isOn',
  },
  HOT_WATER_CIRCULATION_PUMP_RUNNING: {
    id: 'hot-water-circulation-pump-is-running',
    capability: capabilityOf(PATHS.HOT_WATER_CIRCULATION_PUMP),
    kind: 'isOn',
  },
  OUTSIDE_TEMPERATURE_IS: {
    id: 'outside-temperature-is',
    capability: capabilityOf(PATHS.OUTSIDE_TEMP),
    kind: 'compare',
  },
  SUPPLY_TEMPERATURE_IS: {
    id: 'supply-temperature-is',
    capability: capabilityOf(PATHS.HEATING_CIRCUIT_0_SUPPLY_TEMPERATURE),
    kind: 'compare',
  },
  HOT_WATER_TEMPERATURE_IS: {
    id: 'hot-water-temperature-is',
    capability: capabilityOf(PATHS.HOT_WATER_TEMP),
    kind: 'compare',
  },
  // Any numeric Viessmann feature by name (featureCards.js); every device, also in standard Flows
  FEATURE_VALUE_IS: {
    id: 'feature-value-is',
    kind: 'compareFeature',
  },
  HEATING_ACTIVE: {
    id: 'heating-is-active',
    capability: 'measure_heating_active',
    kind: 'isOn',
  },
  OPERATING_STATE_IS: {
    id: 'operating-state-is',
    capability: 'measure_operating_state',
    kind: 'equals',
    argument: 'state',
  },
  HEATING_PROGRAM_IS: {
    id: 'heating-program-is',
    capability: 'thermostat_mode.heatingProgram',
    kind: 'equals',
    argument: 'program',
  },
  HOLIDAY_ACTIVE: {
    id: 'holiday-is-active',
    capability: capabilityOf(PATHS.HOLIDAY),
    kind: 'isOn',
  },
};

// Actions without a kind write their capability (device.writeCapability: the feature path the
// device has, or the commands of a derived capability)
/** @type {Record<string, FlowCardMapping>} */
const FLOW_ACTIONS = {
  SET_HEATING_MODE: {
    id: 'set-operating-mode',
    capability: capabilityOf(PATHS.HEATING_CIRCUIT_0_MODE),
  },
  SET_HEATING_TEMPERATURE: {
    id: 'set-heating-thermostat',
    capability: capabilityOf(PATHS.HEATING_CIRCUIT_0_TARGET),
  },
  SET_DHW_TEMPERATURE: {
    id: 'set-hot-water-thermostat',
    capability: capabilityOf(PATHS.HOT_WATER_TARGET),
  },
  SET_DHW_CHARGE: {
    id: 'do-one-time-hot-water-charge',
    capability: capabilityOf(PATHS.HOT_WATER_CHARGE),
  },
  SET_HOT_WATER_TEMP2: {
    id: 'set-hot-water-thermostat2',
    capability: capabilityOf(PATHS.HOT_WATER_TARGET_2),
  },
  SET_FUELCELL_MODE: {
    id: 'set-fuelcell-mode',
    capability: capabilityOf(PATHS.FUEL_CELL_MODE),
  },
  // Heating curve (heatingCurve.js): both values are written together
  SET_CURVE_SHIFT: {
    id: 'set-heating-curve-shift',
    capability: 'measure_curve_number.circuit0Shift',
    kind: 'setCurveShift',
  },
  ADJUST_CURVE_SHIFT: {
    id: 'adjust-heating-curve-shift',
    capability: 'measure_curve_number.circuit0Shift',
    kind: 'adjustCurveShift',
  },
  SET_CURVE_SLOPE: {
    id: 'set-heating-curve-slope',
    capability: 'measure_curve_number.circuit0Slope',
    kind: 'setCurveSlope',
  },
  // Temporary changes that are restored later (boost.js)
  BOOST_HOT_WATER: {
    id: 'boost-hot-water',
    capability: capabilityOf(PATHS.HOT_WATER_TARGET),
    kind: 'boostHotWater',
  },
  BOOST_CURVE_SHIFT: {
    id: 'boost-heating-curve-shift',
    capability: 'measure_curve_number.circuit0Shift',
    kind: 'boostCurveShift',
  },
  BOOST_HOT_WATER_CHARGE: {
    id: 'boost-hot-water-charge',
    capability: capabilityOf(PATHS.HOT_WATER_CHARGE),
    kind: 'boostHotWaterCharge',
  },
  END_BOOSTS: {
    id: 'end-boosts',
    anyCapability: [
      capabilityOf(PATHS.HOT_WATER_TARGET),
      'measure_curve_number.circuit0Shift',
      capabilityOf(PATHS.HOT_WATER_CHARGE),
    ],
    kind: 'endBoosts',
  },
  // Any Viessmann feature by name, for power users (featureCards.js); every device
  READ_FEATURE_NUMBER: {
    id: 'read-feature-number',
    kind: 'readNumber',
  },
  READ_FEATURE_TEXT: {
    id: 'read-feature-text',
    kind: 'readText',
  },
  RUN_FEATURE_COMMAND: {
    id: 'run-feature-command',
    kind: 'runCommand',
  },
  SET_DEVICE_OPERATING_MODE: {
    id: 'set-device-operating-mode',
    capability: capabilityOf(PATHS.HEATING_CIRCUIT_0_MODE),
    kind: 'chooseValue',
    argument: 'mode',
  },
  SET_HEATING_PROGRAM: {
    id: 'set-heating-program',
    capability: 'thermostat_mode.heatingProgram',
  },
  SET_HEATING_REDUCED_TEMPERATURE: {
    id: 'set-heating-reduced-thermostat',
    capability: capabilityOf(PATHS.HEATING_CIRCUIT_0_REDUCED),
  },
  SET_HEATING_COMFORT_TEMPERATURE: {
    id: 'set-heating-comfort-thermostat',
    capability: capabilityOf(PATHS.HEATING_CIRCUIT_0_COMFORT),
  },
  START_HOLIDAY: {
    id: 'start-holiday',
    capability: capabilityOf(PATHS.HOLIDAY),
    kind: 'startHoliday',
  },
  END_HOLIDAY: {
    id: 'end-holiday',
    capability: capabilityOf(PATHS.HOLIDAY),
    kind: 'endHoliday',
  },
  SET_HOT_WATER_MODE: {
    id: 'set-hot-water-mode',
    capability: capabilityOf(PATHS.HOT_WATER_MODE),
    kind: 'chooseValue',
    argument: 'mode',
  },
  SET_HOT_WATER_HYSTERESIS: {
    id: 'set-hot-water-hysteresis',
    capability: capabilityOf(PATHS.HOT_WATER_HYSTERESIS),
  },
};

// Triggers fire when their capability changes (device.setCapabilityValueIfPossible). Cards
// with a kind fire only on a change from a known value (see flowHandlers.js): `turnedOn` and
// `turnedOff` on booleans, `changed` with the new value as the `temperature` token,
// `valueChanged` with the new value as the mapping's `token`
/** @type {Record<string, FlowCardMapping>} */
const FLOW_TRIGGERS = {
  HEATING_MODE_CHANGED: {
    id: 'heating-mode-changed',
    capability: capabilityOf(PATHS.HEATING_CIRCUIT_0_MODE),
  },
  HEATING_STARTED: {
    id: 'heating-started',
    capability: 'measure_heating_active',
    kind: 'turnedOn',
  },
  HEATING_STOPPED: {
    id: 'heating-stopped',
    capability: 'measure_heating_active',
    kind: 'turnedOff',
  },
  OPERATING_STATE_CHANGED: {
    id: 'operating-state-changed',
    capability: 'measure_operating_state',
    kind: 'valueChanged',
    token: 'state',
  },
  HEATING_PROGRAM_CHANGED: {
    id: 'heating-program-changed',
    capability: 'thermostat_mode.heatingProgram',
    kind: 'valueChanged',
    token: 'program',
  },
  CIRCULATION_PUMP_STARTED: {
    id: 'circulation-pump-started',
    capability: capabilityOf(PATHS.HEATING_CIRCUIT_0_PUMP),
    kind: 'turnedOn',
  },
  CIRCULATION_PUMP_STOPPED: {
    id: 'circulation-pump-stopped',
    capability: capabilityOf(PATHS.HEATING_CIRCUIT_0_PUMP),
    kind: 'turnedOff',
  },
  HOT_WATER_CIRCULATION_PUMP_STARTED: {
    id: 'hot-water-circulation-pump-started',
    capability: capabilityOf(PATHS.HOT_WATER_CIRCULATION_PUMP),
    kind: 'turnedOn',
  },
  HOT_WATER_CIRCULATION_PUMP_STOPPED: {
    id: 'hot-water-circulation-pump-stopped',
    capability: capabilityOf(PATHS.HOT_WATER_CIRCULATION_PUMP),
    kind: 'turnedOff',
  },
  OUTSIDE_TEMPERATURE_CHANGED: {
    id: 'outside-temperature-changed',
    capability: capabilityOf(PATHS.OUTSIDE_TEMP),
    kind: 'changed',
  },
  SUPPLY_TEMPERATURE_CHANGED: {
    id: 'supply-temperature-changed',
    capability: capabilityOf(PATHS.HEATING_CIRCUIT_0_SUPPLY_TEMPERATURE),
    kind: 'changed',
  },
  HOT_WATER_TEMPERATURE_CHANGED: {
    id: 'hot-water-temperature-changed',
    capability: capabilityOf(PATHS.HOT_WATER_TEMP),
    kind: 'changed',
  },
  // Events, fired by deviceMonitor.js (offered on every device: alarm_problem is on every device)
  FAULT_REPORTED: {
    id: 'fault-reported',
    capability: capabilityOf(PATHS.DEVICE_ERRORS),
    event: true,
  },
  LOGBOOK_ENTRY_ADDED: {
    id: 'logbook-entry-added',
    capability: capabilityOf(PATHS.DEVICE_ERRORS),
    event: true,
  },
  EVENT_LOGGED: {
    id: 'event-logged',
    capability: capabilityOf(PATHS.DEVICE_ERRORS),
    event: true,
  },
  // Fires for the event code in its `code` argument (see driver.js)
  EVENT_CODE_LOGGED: {
    id: 'event-code-logged',
    capability: capabilityOf(PATHS.DEVICE_ERRORS),
    event: true,
  },
};

module.exports = { FLOW_CONDITIONS, FLOW_ACTIONS, FLOW_TRIGGERS };
