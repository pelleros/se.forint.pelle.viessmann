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

// Readings of the heating circuit. Only circuit 0 is configured: heatingCircuit.js maps the
// device's circuit to `heating.circuits.0.*` (see docs/ARCHITECTURE.md, "Heating circuits").
// The circuit's set point and operating mode are in thermostat.js, its circulation pumps in
// pumps.js. The heating curve is read here; heatingCurve.js writes it (both values at once).

const { createTemperatureCapability } = require('./templates');
const { createOnOffCapability } = require('./pumps');

/** @type {import('./types').ConfigModule['PATHS']} */
const PATHS = {
  HEATING_CIRCUIT_0_ROOM_TEMPERATURE: 'heating.circuits.0.sensors.temperature.room',
  HEATING_CIRCUIT_0_TEMPERATURE: 'heating.circuits.0.temperature',
  HEATING_CIRCUIT_0_SUPPLY_TEMPERATURE: 'heating.circuits.0.sensors.temperature.supply',
  HEATING_CIRCUIT_0_FROST_PROTECTION: 'heating.circuits.0.frostprotection',
  HEATING_CIRCUIT_0_CURVE: 'heating.circuits.0.heating.curve',
};

/** @type {import('./types').ConfigModule['FEATURES']} */
const FEATURES = {
  [PATHS.HEATING_CIRCUIT_0_TEMPERATURE]: {
    capabilities: [createTemperatureCapability('circuit0', 'Heating circuit target temperature', {
      preventTag: true,
    })],
  },
  [PATHS.HEATING_CIRCUIT_0_SUPPLY_TEMPERATURE]: {
    capabilities: [createTemperatureCapability('circuit0_supply', 'Heating Circuit Supply Temperature', {
      preventTag: true,
    })],
  },
  [PATHS.HEATING_CIRCUIT_0_ROOM_TEMPERATURE]: {
    capabilities: [createTemperatureCapability('circuit0_room', 'Room Temperature')],
  },
  [PATHS.HEATING_CIRCUIT_0_FROST_PROTECTION]: {
    capabilities: [createOnOffCapability('measure_frost_active.circuit0', {
      title: {
        en: 'Frost protection',
        de: 'Frostschutz',
        nl: 'Vorstbeveiliging',
        fr: 'Protection antigel',
        sv: 'Frostskydd',
      },
      titleTrue: {
        en: 'On', de: 'An', nl: 'Aan', fr: 'Activée', sv: 'På',
      },
      titleFalse: {
        en: 'Off', de: 'Aus', nl: 'Uit', fr: 'Désactivée', sv: 'Av',
      },
      insightsTitleTrue: {
        en: 'Frost protection on',
        de: 'Frostschutz an',
        nl: 'Vorstbeveiliging aan',
        fr: 'Protection antigel activée',
        sv: 'Frostskydd på',
      },
      insightsTitleFalse: {
        en: 'Frost protection off',
        de: 'Frostschutz aus',
        nl: 'Vorstbeveiliging uit',
        fr: 'Protection antigel désactivée',
        sv: 'Frostskydd av',
      },
    })],
  },
  [PATHS.HEATING_CIRCUIT_0_CURVE]: {
    capabilities: [{
      capabilityName: 'measure_curve_number.circuit0Shift',
      propertyPath: 'shift.value',
      capabilityOptions: {
        title: {
          en: 'Heating curve shift',
          de: 'Heizkennlinie Niveau',
          nl: 'Stooklijn verschuiving',
          fr: 'Courbe de chauffe décalage',
          sv: 'Värmekurva förskjutning',
        },
        decimals: 0,
        preventInsights: false,
        preventTag: false,
      },
    }, {
      capabilityName: 'measure_curve_number.circuit0Slope',
      propertyPath: 'slope.value',
      capabilityOptions: {
        title: {
          en: 'Heating curve slope',
          de: 'Heizkennlinie Neigung',
          nl: 'Stooklijn helling',
          fr: 'Courbe de chauffe pente',
          sv: 'Värmekurva lutning',
        },
        decimals: 1,
        preventInsights: false,
        preventTag: false,
      },
    }],
  },
};

module.exports = { PATHS, FEATURES };
