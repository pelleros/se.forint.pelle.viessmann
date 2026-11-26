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

// Set points and modes the user can change: hot water and heating targets, the heating
// circuit's operating mode, the one-time hot water charge and the fuel cell's mode.

const { createThermostatCapability } = require('./templates');

/** @type {import('./types').ConfigModule['PATHS']} */
const PATHS = {
  HOT_WATER_TARGET: 'heating.dhw.temperature.main',
  HOT_WATER_TARGET_2: 'heating.dhw.temperature.temp2',
  HEATING_CIRCUIT_0_TARGET: 'heating.circuits.0.operating.programs.normal',
  HOT_WATER_CHARGE: 'heating.dhw.oneTimeCharge',
  HEATING_CIRCUIT_0_MODE: 'heating.circuits.0.operating.modes.active',
  FUEL_CELL_MODE: 'fuelCell.operating.modes.active',
};

/** @type {import('./types').ConfigModule['FEATURES']} */
const FEATURES = {
  [PATHS.HOT_WATER_TARGET]: {
    capabilities: [createThermostatCapability('hotWater', 'Hot water Normal')],
  },
  [PATHS.HOT_WATER_TARGET_2]: {
    capabilities: [createThermostatCapability('hotWater2', 'Hot water Temp 2')],
  },
  [PATHS.HEATING_CIRCUIT_0_TARGET]: {
    capabilities: [createThermostatCapability('heating', 'Heating thermostat', {
      propertyPath: 'temperature.value',
      command: {
        name: 'setTemperature',
        parameterMapping: {
          value: 'targetTemperature',
        },
      },
      min: 10,
      max: 30,
    })],
  },
  [PATHS.HEATING_CIRCUIT_0_MODE]: {
    capabilities: [{
      capabilityName: 'thermostat_mode.heating',
      propertyPath: 'value.value',
      command: {
        name: 'setMode',
        parameterMapping: {
          value: 'mode',
        },
      },
      capabilityOptions: {
        title: { en: 'Operating mode' },
        values: [
          {
            id: 'dhw',
            title: { en: 'Hot water' },
          },
          {
            id: 'dhwAndHeating',
            title: { en: 'Hot water and heating' },
          },
          {
            id: 'heating',
            title: { en: 'Heating' },
          },
          {
            id: 'standby',
            title: { en: 'Standby' },
          },
        ],
        preventInsights: true,
      },
    }],
  },
  [PATHS.HOT_WATER_CHARGE]: {
    capabilities: [{
      capabilityName: 'thermostat_mode.hotWaterOneTimeCharge',
      propertyPath: 'active.value',
      command: {
        useValueAsCommand: true,
      },
      valueMapping: {
        true: 'activate',
        false: 'deactivate',
      },
      capabilityOptions: {
        title: { en: 'Hot water one time charge' },
        values: [{
          id: 'activate',
          title: { en: 'Active' },
        }, {
          id: 'deactivate',
          title: { en: 'Inactive' },
        }],
        preventInsights: true,
      },
    }],
  },
  [PATHS.FUEL_CELL_MODE]: {
    capabilities: [{
      capabilityName: 'thermostat_mode.fuelCell',
      propertyPath: 'value.value',
      command: {
        name: 'setMode',
        parameterMapping: {
          value: 'mode',
        },
      },
      capabilityOptions: {
        title: {
          en: 'Fuel cell mode',
        },
        values: [
          {
            id: 'standby',
            title: {
              en: 'Standby',
            },
          },
          {
            id: 'maintenance',
            title: {
              en: 'Maintenance',
            },
          },
          {
            id: 'heatControlled',
            title: {
              en: 'Heat controlled',
            },
          },
          {
            id: 'economical',
            title: {
              en: 'Economical',
            },
          },
          {
            id: 'ecological',
            title: {
              en: 'Ecological',
            },
          },
        ],
        preventInsights: true,
      },
    }],
  },
};

module.exports = { PATHS, FEATURES };
