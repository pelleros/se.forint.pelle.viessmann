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

// Temperature sensors that do not belong to one heating circuit: hot water cylinder, outside,
// buffer cylinder, return, primary/secondary circuit, boiler and fuel cell.

const { createTemperatureCapability } = require('./templates');

/** @type {import('./types').ConfigModule['PATHS']} */
const PATHS = {
  HOT_WATER_TEMP: 'heating.dhw.sensors.temperature.dhwCylinder',
  OUTSIDE_TEMP: 'heating.sensors.temperature.outside',
  BUFFER_TEMP: 'heating.bufferCylinder.sensors.temperature.main',
  BUFFER_TEMP_TOP: 'heating.bufferCylinder.sensors.temperature.top',
  RETURN_TEMP: 'heating.sensors.temperature.return',
  PRIMARY_CIRCUIT_SUPPLY_TEMP: 'heating.primaryCircuit.sensors.temperature.supply',
  PRIMARY_CIRCUIT_RETURN_TEMP: 'heating.primaryCircuit.sensors.temperature.return',
  SECONDARY_CIRCUIT_SUPPLY_TEMP: 'heating.secondaryCircuit.sensors.temperature.supply',
  BOILER_TEMPERATURE_MAIN: 'heating.boiler.sensors.temperature.main',
  BOILER_COMMON_SUPPLY_TEMP: 'heating.boiler.sensors.temperature.commonSupply',
  FUEL_CELL_RETURN_TEMP: 'fuelCell.sensors.temperature.return',
  FUEL_CELL_SUPPLY_TEMP: 'fuelCell.sensors.temperature.supply',
};

/** @type {import('./types').ConfigModule['FEATURES']} */
const FEATURES = {
  [PATHS.HOT_WATER_TEMP]: {
    capabilities: [createTemperatureCapability('hotWater', 'Hot water temperature')],
  },
  [PATHS.OUTSIDE_TEMP]: {
    capabilities: [createTemperatureCapability('outside', 'Outside temperature')],
  },
  [PATHS.BUFFER_TEMP]: {
    capabilities: [createTemperatureCapability('buffer', 'Buffer cylinder temperature')],
  },
  // Read only when the main sensor reports no value
  [PATHS.BUFFER_TEMP_TOP]: {
    fallbackFor: PATHS.BUFFER_TEMP,
    capabilities: [createTemperatureCapability('buffer', 'Buffer cylinder temperature')],
  },
  [PATHS.RETURN_TEMP]: {
    capabilities: [createTemperatureCapability('return', 'Heating return temperature')],
  },
  [PATHS.PRIMARY_CIRCUIT_SUPPLY_TEMP]: {
    capabilities: [createTemperatureCapability('supply', 'Primary supply temperature', {
      preventTag: true,
    })],
  },
  [PATHS.PRIMARY_CIRCUIT_RETURN_TEMP]: {
    capabilities: [createTemperatureCapability('primaryReturn', 'Primary return temperature', {
      preventTag: true,
    })],
  },
  [PATHS.SECONDARY_CIRCUIT_SUPPLY_TEMP]: {
    capabilities: [createTemperatureCapability('secondarySupply', 'Secondary supply temperature', {
      preventTag: true,
    })],
  },
  [PATHS.BOILER_COMMON_SUPPLY_TEMP]: {
    requireRole: 'type:boiler',
    capabilities: [createTemperatureCapability('boilerCommonSupply', 'Boiler Exit Temperature', {
      preventTag: true,
    })],
  },
  [PATHS.BOILER_TEMPERATURE_MAIN]: {
    requireRole: 'type:boiler',
    capabilities: [createTemperatureCapability('boiler_main', 'Boiler Main Temperature')],
  },
  [PATHS.FUEL_CELL_RETURN_TEMP]: {
    capabilities: [createTemperatureCapability('fuelCellReturn', 'Fuel Cell Return Temperature', {
      preventTag: true,
    })],
  },
  [PATHS.FUEL_CELL_SUPPLY_TEMP]: {
    capabilities: [createTemperatureCapability('fuelCellSupply', 'Fuel Cell Supply Temperature', {
      preventTag: true,
    })],
  },
};

module.exports = { PATHS, FEATURES };
