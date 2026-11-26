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
};

// Triggers fire when their capability changes (device.setCapabilityValueIfPossible)
/** @type {Record<string, FlowCardMapping>} */
const FLOW_TRIGGERS = {
  HEATING_MODE_CHANGED: {
    id: 'heating-mode-changed',
    capability: capabilityOf(PATHS.HEATING_CIRCUIT_0_MODE),
  },
};

module.exports = { FLOW_CONDITIONS, FLOW_ACTIONS, FLOW_TRIGGERS };
