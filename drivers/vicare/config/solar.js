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

// Solar thermal collectors, where the installation reports them: the collector temperature,
// the hot water temperature the solar controller measures and whether the solar pump runs.

const { createTemperatureCapability } = require('./templates');
const { createOnOffCapability } = require('./pumps');

/** @type {import('./types').ConfigModule['PATHS']} */
const PATHS = {
  SOLAR_COLLECTOR_TEMP: 'heating.solar.sensors.temperature.collector',
  SOLAR_HOT_WATER_TEMP: 'heating.solar.sensors.temperature.dhw',
  SOLAR_PUMP: 'heating.solar.pumps.circuit',
};

/** @type {import('./types').ConfigModule['FEATURES']} */
const FEATURES = {
  [PATHS.SOLAR_COLLECTOR_TEMP]: {
    capabilities: [createTemperatureCapability('solarCollector', 'Solar collector temperature', {
      title: {
        en: 'Solar collector temperature',
        de: 'Kollektortemperatur',
        nl: 'Collectortemperatuur',
        fr: 'Température capteur solaire',
        sv: 'Solfångartemperatur',
      },
    })],
  },
  [PATHS.SOLAR_HOT_WATER_TEMP]: {
    capabilities: [createTemperatureCapability('solarHotWater', 'Hot water temperature (solar)', {
      title: {
        en: 'Hot water temperature (solar)',
        de: 'Warmwassertemperatur (Solar)',
        nl: 'Warmwatertemperatuur (zon)',
        fr: 'Température eau chaude (solaire)',
        sv: 'Varmvattentemperatur (sol)',
      },
      preventTag: true,
    })],
  },
  [PATHS.SOLAR_PUMP]: {
    capabilities: [createOnOffCapability('measure_pump_active.solarCircuit', {
      title: {
        en: 'Solar pump',
        de: 'Solarkreispumpe',
        nl: 'Zonnepomp',
        fr: 'Pompe solaire',
        sv: 'Solpump',
      },
      insightsTitleTrue: {
        en: 'Solar pump started',
        de: 'Solarkreispumpe gestartet',
        nl: 'Zonnepomp gestart',
        fr: 'Pompe solaire démarrée',
        sv: 'Solpumpen startade',
      },
      insightsTitleFalse: {
        en: 'Solar pump stopped',
        de: 'Solarkreispumpe gestoppt',
        nl: 'Zonnepomp gestopt',
        fr: 'Pompe solaire arrêtée',
        sv: 'Solpumpen stannade',
      },
    })],
  },
};

module.exports = { PATHS, FEATURES };
