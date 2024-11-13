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

'use strict';

const { PATHS, getCapability } = require('./config');

module.exports = {
  FLOW_CONDITIONS: {
    COMPRESSOR_RUNNING: {
      id: 'compressor-is-running',
      capability: getCapability(PATHS.COMPRESSOR).capabilityName,
      title: 'flow.conditions.compressor.title',
      hint: 'flow.conditions.compressor.hint',
    },
    BURNER_RUNNING: {
      id: 'burner-is-running',
      capability: getCapability(PATHS.BURNER).capabilityName,
      title: 'flow.conditions.burner.title',
      hint: 'flow.conditions.burner.hint',
    },
  },
  FLOW_ACTIONS: {
    SET_HEATING_MODE: {
      id: 'set-operating-mode',
      method: 'setMainOperatingMode',
      title: 'flow.actions.heating_mode.title',
      hint: 'flow.actions.heating_mode.hint',
      args: [{
        name: 'mode',
        type: 'dropdown',
        values: [
          { id: 'dhw', title: 'flow.actions.heating_mode.values.dhw' },
          { id: 'heating', title: 'flow.actions.heating_mode.values.heating' },
          { id: 'dhwAndHeating', title: 'flow.actions.heating_mode.values.dhwAndHeating' },
          { id: 'standby', title: 'flow.actions.heating_mode.values.standby' },
        ],
      }],
    },
    SET_HEATING_TEMPERATURE: {
      id: 'set-heating-thermostat',
      method: 'setHeatingTemp',
      title: 'flow.actions.heating_temp.title',
      args: [{
        name: 'temperature',
        type: 'number',
        min: 3,
        max: 37,
        step: 1,
        title: 'flow.actions.heating_temp.temperature',
      }],
    },
    SET_DHW_TEMPERATURE: {
      id: 'set-hot-water-thermostat',
      method: 'setDhwTemp',
      title: 'flow.actions.dhw_temp.title',
      args: [{
        name: 'temperature',
        type: 'number',
        min: 10,
        max: 60,
        step: 1,
        title: 'flow.actions.dhw_temp.temperature',
      }],
    },
    SET_DHW_CHARGE: {
      id: 'do-one-time-hot-water-charge',
      method: 'setDhwOneTimeCharge',
      title: 'flow.actions.dhw_charge.title',
      titleFormatted: 'flow.actions.dhw_charge.titleFormatted',
      args: [{
        name: 'active',
        type: 'dropdown',
        values: [
          { id: 'activate', title: 'flow.actions.dhw_charge.values.activate' },
          { id: 'deactivate', title: 'flow.actions.dhw_charge.values.deactivate' },
        ],
      }],
    },
    SET_HOT_WATER_TEMP2: {
      id: 'set-hot-water-thermostat2',
      method: 'setDhwTemp2',
      title: 'flow.actions.hot_water_temp2.title',
      titleFormatted: 'flow.actions.hot_water_temp2.title',
      args: [
        {
          name: 'temperature',
          type: 'number',
          min: 10,
          max: 60,
          step: 1,
          title: 'flow.actions.temperature.title',
        },
      ],
    },
  },
  FLOW_TRIGGERS: {
    HEATING_MODE_CHANGED: {
      id: 'heating-mode-changed',
      capability: getCapability(PATHS.HEATING_MODE).capabilityName,
      title: 'flow.triggers.heating_mode.title',
      tokens: [{
        name: 'mode',
        type: 'string',
        title: 'flow.triggers.heating_mode.mode',
        example: { en: 'dhw' },
      }],
    },
  },
};
