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
// buffer cylinder, return, primary/secondary circuit, boiler and fuel cell, and in the
// diagnostic group the cylinder's top sensor and the compressor's sensors.

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
  HOT_WATER_BOTTOM_TEMP: 'heating.dhw.sensors.temperature.dhwCylinder.bottom',
  HOT_WATER_TOP_TEMP: 'heating.dhw.sensors.temperature.dhwCylinder.top',
  COMPRESSOR_INLET_TEMP: 'heating.compressors.0.sensors.temperature.inlet',
  COMPRESSOR_OUTLET_TEMP: 'heating.compressors.0.sensors.temperature.outlet',
  COMPRESSOR_AMBIENT_TEMP: 'heating.compressors.0.sensors.temperature.ambient',
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
  [PATHS.HOT_WATER_BOTTOM_TEMP]: {
    capabilities: [createTemperatureCapability('hotWaterBottom', 'Hot water bottom temperature', {
      title: {
        en: 'Hot water bottom temperature',
        de: 'Warmwassertemperatur unten',
        nl: 'Warmwatertemperatuur onder',
        fr: 'Température eau chaude en bas',
        sv: 'Varmvattentemperatur nedre',
      },
      preventTag: true,
    })],
  },
  // Usually the same value as the main cylinder sensor, so only with the diagnostic values
  [PATHS.HOT_WATER_TOP_TEMP]: {
    group: 'diagnostic',
    capabilities: [createTemperatureCapability('hotWaterTop', 'Hot water top temperature', {
      title: {
        en: 'Hot water top temperature',
        de: 'Warmwassertemperatur oben',
        nl: 'Warmwatertemperatuur boven',
        fr: 'Température eau chaude en haut',
        sv: 'Varmvattentemperatur övre',
      },
      preventTag: true,
    })],
  },
  [PATHS.COMPRESSOR_INLET_TEMP]: {
    requireRole: 'type:heatpump',
    group: 'diagnostic',
    capabilities: [createTemperatureCapability('compressorInlet', 'Compressor inlet temperature', {
      title: {
        en: 'Compressor inlet temperature',
        de: 'Verdichter Eintrittstemperatur',
        nl: 'Compressor inlaattemperatuur',
        fr: 'Température entrée compresseur',
        sv: 'Kompressor inloppstemperatur',
      },
      preventTag: true,
    })],
  },
  [PATHS.COMPRESSOR_OUTLET_TEMP]: {
    requireRole: 'type:heatpump',
    group: 'diagnostic',
    capabilities: [createTemperatureCapability('compressorOutlet', 'Compressor outlet temperature', {
      title: {
        en: 'Compressor outlet temperature',
        de: 'Verdichter Austrittstemperatur',
        nl: 'Compressor uitlaattemperatuur',
        fr: 'Température sortie compresseur',
        sv: 'Kompressor utloppstemperatur',
      },
      preventTag: true,
    })],
  },
  [PATHS.COMPRESSOR_AMBIENT_TEMP]: {
    requireRole: 'type:heatpump',
    group: 'diagnostic',
    capabilities: [createTemperatureCapability('compressorAmbient', 'Compressor ambient temperature', {
      title: {
        en: 'Compressor ambient temperature',
        de: 'Verdichter Umgebungstemperatur',
        nl: 'Compressor omgevingstemperatuur',
        fr: 'Température ambiante compresseur',
        sv: 'Kompressor omgivningstemperatur',
      },
      preventTag: true,
    })],
  },
};

module.exports = { PATHS, FEATURES };
