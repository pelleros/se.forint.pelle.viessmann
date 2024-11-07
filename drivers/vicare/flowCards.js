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
      title: {
        en: 'Compressor is !{{running|not running}}',
        sv: 'Kompressorn !{{är igång|är inte igång}}',
      },
      hint: {
        en: 'Checking last known state, i.e could return incorrect value if not recently synched.',
        sv: 'Kontrollerar senaste kända tillstånd, dvs kan returnera felaktigt värde om inte synkroniserat nyligen.',
      },
    },
    BURNER_RUNNING: {
      id: 'burner-is-running',
      capability: getCapability(PATHS.BURNER).capabilityName,
      title: {
        en: 'Burner is !{{running|not running}}',
        sv: 'Brännaren !{{är igång|är inte igång}}',
      },
      hint: {
        en: 'Checking last known state, i.e could return incorrect value if not reacently synched.',
        sv: 'Kontrollerar senaste kända tillstånd, dvs kan returnera felaktigt värde om inte synkroniserat nyligen.',
      },
    },
  },
  FLOW_ACTIONS: {
    SET_HEATING_MODE: {
      id: 'set-heating-mode',
      method: 'setHeatingMode',
      title: {
        en: 'Set heating mode to [[mode]]',
        sv: 'Ställ in värmeläge till [[mode]]',
      },
      args: [
        {
          name: 'mode',
          type: 'dropdown',
          values: [
            { id: 'dhw', title: { en: 'DHW only', sv: 'Endast varmvatten' } },
            { id: 'dhwAndHeating', title: { en: 'DHW and heating', sv: 'Varmvatten och värme' } },
            { id: 'standby', title: { en: 'Standby', sv: 'Standby' } },
          ],
        },
      ],
    },
    SET_HEATING_TEMPERATURE: {
      id: 'set-heating-target-temperature',
      method: 'setHeatingTargetTemperature',
      title: {
        en: 'Set heating target temperature to [[temperature]] °C',
        sv: 'Ställ in måltemperatur för värme till [[temperature]] °C',
      },
      args: [
        {
          name: 'temperature',
          type: 'number',
          min: 3,
          max: 37,
          step: 1,
          title: { en: 'Temperature', sv: 'Temperatur' },
        },
      ],
    },
    SET_DHW_TEMPERATURE: {
      id: 'set-dhw-target-temperature',
      method: 'setDHWTargetTemperature',
      title: {
        en: 'Set hot water target temperature to [[temperature]] °C',
        sv: 'Ställ in måltemperatur för varmvatten till [[temperature]] °C',
      },
      args: [
        {
          name: 'temperature',
          type: 'number',
          min: 10,
          max: 60,
          step: 1,
          title: { en: 'Temperature', sv: 'Temperatur' },
        },
      ],
    },
    START_DHW_CHARGE: {
      id: 'start-dhw-charge',
      method: 'startDHWCharge',
      title: {
        en: 'Start hot water charge',
        sv: 'Starta varmvattenladdning',
      },
    },
    STOP_DHW_CHARGE: {
      id: 'stop-dhw-charge',
      method: 'stopDHWCharge',
      title: {
        en: 'Stop hot water charge',
        sv: 'Stoppa varmvattenladdning',
      },
    },
  },
};
