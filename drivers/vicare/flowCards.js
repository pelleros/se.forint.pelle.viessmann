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
 * @property {string} capability the capability the card reads, writes or fires for
 * @property {string} [argument] conditions: the argument the value is compared with (without
 *   one, the value is a boolean)
 * @property {string} [autocomplete] actions: an autocomplete argument that offers the values the
 *   capability has on the device
 * @property {string} [method] actions: the device method the card runs with its arguments,
 *   instead of writing the capability
 * @property {any} [when] triggers: fire only when the capability changes to this value
 * @property {string} [token] triggers: the token that carries the new value
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
  HEATING_ACTIVE: {
    id: 'heating-is-active',
    capability: 'measure_heating_active',
  },
  OPERATING_STATE_IS: {
    id: 'operating-state-is',
    capability: 'measure_operating_state',
    argument: 'state',
  },
  HEATING_PROGRAM_IS: {
    id: 'heating-program-is',
    capability: 'thermostat_mode.heatingProgram',
    argument: 'program',
  },
  HOLIDAY_ACTIVE: {
    id: 'holiday-is-active',
    capability: capabilityOf(PATHS.HOLIDAY),
  },
};

// Actions write through the capability's command (see FeatureMapper.commandTarget)
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
  SET_DEVICE_OPERATING_MODE: {
    id: 'set-device-operating-mode',
    capability: capabilityOf(PATHS.HEATING_CIRCUIT_0_MODE),
    autocomplete: 'mode',
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
    method: 'startHoliday',
  },
  END_HOLIDAY: {
    id: 'end-holiday',
    capability: capabilityOf(PATHS.HOLIDAY),
    method: 'endHoliday',
  },
  SET_HOT_WATER_MODE: {
    id: 'set-hot-water-mode',
    capability: capabilityOf(PATHS.HOT_WATER_MODE),
    autocomplete: 'mode',
  },
  SET_HOT_WATER_HYSTERESIS: {
    id: 'set-hot-water-hysteresis',
    capability: capabilityOf(PATHS.HOT_WATER_HYSTERESIS),
  },
};

// Triggers fire when their capability changes (device.setCapabilityValueIfPossible)
/** @type {Record<string, FlowCardMapping>} */
const FLOW_TRIGGERS = {
  HEATING_MODE_CHANGED: {
    id: 'heating-mode-changed',
    capability: capabilityOf(PATHS.HEATING_CIRCUIT_0_MODE),
    token: 'mode',
  },
  HEATING_STARTED: {
    id: 'heating-started',
    capability: 'measure_heating_active',
    when: true,
  },
  HEATING_STOPPED: {
    id: 'heating-stopped',
    capability: 'measure_heating_active',
    when: false,
  },
  OPERATING_STATE_CHANGED: {
    id: 'operating-state-changed',
    capability: 'measure_operating_state',
    token: 'state',
  },
  HEATING_PROGRAM_CHANGED: {
    id: 'heating-program-changed',
    capability: 'thermostat_mode.heatingProgram',
    token: 'program',
  },
};

module.exports = { FLOW_CONDITIONS, FLOW_ACTIONS, FLOW_TRIGGERS };
