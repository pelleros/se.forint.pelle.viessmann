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

// Feature paths (as defined in the Viessmann api https://documentation.viessmann-climatesolutions.com/static/iot/data-points)
// as constants to avoid string errors and enable IDE autocompletion
const PATHS = {
  HOT_WATER_TEMP: 'heating.dhw.sensors.temperature.dhwCylinder',
  HOT_WATER_TARGET: 'heating.dhw.temperature.main',
  HOT_WATER_TARGET_2: 'heating.dhw.temperature.temp2',
  HEATING_CIRCUIT_0_TARGET: 'heating.circuits.0.operating.programs.normal',
  HOT_WATER_CHARGE: 'heating.dhw.oneTimeCharge',
  HEATING_CIRCUIT_0_MODE: 'heating.circuits.0.operating.modes.active',
  OUTSIDE_TEMP: 'heating.sensors.temperature.outside',
  HEATING_CIRCUIT_0_ROOM_TEMPERATURE: 'heating.circuits.0.sensors.temperature.room',
  HEATING_CIRCUIT_0_TEMPERATURE: 'heating.circuits.0.temperature',
  HEATING_CIRCUIT_0_SUPPLY_TEMPERATURE: 'heating.circuits.0.sensors.temperature.supply',
  BUFFER_TEMP: 'heating.bufferCylinder.sensors.temperature.main',
  RETURN_TEMP: 'heating.sensors.temperature.return',
  PRIMARY_CIRCUIT_SUPPLY_TEMP: 'heating.primaryCircuit.sensors.temperature.supply',
  PRIMARY_CIRCUIT_RETURN_TEMP: 'heating.primaryCircuit.sensors.temperature.return',
  SECONDARY_CIRCUIT_SUPPLY_TEMP: 'heating.secondaryCircuit.sensors.temperature.supply',
  BOILER_TEMPERATURE_MAIN: 'heating.boiler.sensors.temperature.main',
  BOILER_COMMON_SUPPLY_TEMP: 'heating.boiler.sensors.temperature.commonSupply',
  COMPRESSOR: 'heating.compressors.0',
  COMPRESSOR_STATS: 'heating.compressors.0.statistics',
  BURNER: 'heating.burners.0',
  BURNER_MODULATION: 'heating.burners.0.modulation',
  BURNER_STATS: 'heating.burners.0.statistics',
  FUEL_CELL_RETURN_TEMP: 'fuelCell.sensors.temperature.return',
  FUEL_CELL_SUPPLY_TEMP: 'fuelCell.sensors.temperature.supply',
  FUEL_CELL_STATS: 'fuelCell.statistics',
  FUEL_CELL_PHASE: 'fuelCell.operating.phase',
  FUEL_CELL_MODE: 'fuelCell.operating.modes.active',
};

// Gemensamma capability-mallar
const CAPABILITY_TEMPLATES = {
  temperature: {
    units: '°C',
    decimals: 1,
    preventInsights: false,
    preventTag: false,
  },
  counter: {
    preventInsights: true,
    preventTag: true,
  },
  thermostat: {
    units: '°C',
    preventInsights: true,
  },
  activeState: {
    preventInsights: false,
    preventTag: false,
  },
  modulation: {
    preventInsights: false,
    preventTag: true,
  },
};

// Förbättrad temperature capability med mer flexibilitet
const createTemperatureCapability = (name, title, options = {}) => ({
  capabilityName: `measure_temperature.${name}`,
  propertyPath: options.propertyPath || 'value.value',
  capabilityOptions: {
    title: { en: title },
    ...CAPABILITY_TEMPLATES.temperature,
    ...options,
  },
});

// Förbättrad modulation capability
const createModulationCapability = (name, title, options = {}) => ({
  capabilityName: `measure_${name}_number.${name}Modulation`,
  propertyPath: 'value.value',
  capabilityOptions: {
    title: { en: title },
    units: '%',
    ...CAPABILITY_TEMPLATES.modulation,
    ...options,
  },
});

// Förbättrad active capability med mer flexibilitet
const createActiveCapability = (name, title, options = {}) => ({
  capabilityName: `measure_${name}_active`,
  propertyPath: 'active.value',
  capabilityOptions: {
    title: { en: title },
    ...CAPABILITY_TEMPLATES.activeState,
    ...options,
  },
});

// Hjälpfunktion för att skapa statistik capabilities
const createStatisticsCapabilities = (prefix, unitName) => ([
  {
    capabilityName: `measure_${prefix}_number.${prefix}Hours`,
    propertyPath: 'hours.value',
    capabilityOptions: {
      title: { en: `${unitName} runtime` },
      units: 'hours',
      ...CAPABILITY_TEMPLATES.counter,
    },
  },
  {
    capabilityName: `measure_${prefix}_number.${prefix}Starts`,
    propertyPath: 'starts.value',
    capabilityOptions: {
      title: { en: `${unitName} starts` },
      units: 'times',
      ...CAPABILITY_TEMPLATES.counter,
    },
  },
]);

// Hjälpfunktion för att skapa thermostat capability
const createThermostatCapability = (name, title, options = {}) => ({
  capabilityName: `target_temperature.${name}`,
  propertyPath: options.propertyPath || 'value.value',
  command: options.command || {
    name: 'setTargetTemperature',
    parameterMapping: {
      value: 'temperature',
    },
  },
  capabilityOptions: {
    title: { en: title },
    ...CAPABILITY_TEMPLATES.thermostat,
    min: options.min || 10,
    max: options.max || 60,
    step: options.step || 1,
    ...options.capabilityOptions,
  },
});

// Hjälpfunktion för att skapa fuel cell statistik capabilities
const createFuelCellStatisticsCapabilities = () => ([
  {
    capabilityName: 'measure_fuelcell_number.operationHours',
    propertyPath: 'operationHours.value',
    capabilityOptions: {
      title: { en: 'Fuel cell operation hours' },
      units: 'hours',
      ...CAPABILITY_TEMPLATES.counter,
    },
  },
  {
    capabilityName: 'measure_fuelcell_number.productionHours',
    propertyPath: 'productionHours.value',
    capabilityOptions: {
      title: { en: 'Fuel cell production hours' },
      units: 'hours',
      ...CAPABILITY_TEMPLATES.counter,
    },
  },
  {
    capabilityName: 'measure_fuelcell_number.productionStarts',
    propertyPath: 'productionStarts.value',
    capabilityOptions: {
      title: { en: 'Fuel cell starts' },
      units: 'times',
      ...CAPABILITY_TEMPLATES.counter,
    },
  },
]);

// Helper function to get capability from feature path
const getCapability = (featurePath) => {
  const feature = module.exports.FEATURES[featurePath];
  if (!feature?.capabilities?.[0]) {
    throw new Error(`No capability found for feature: ${featurePath}`);
  }
  return feature.capabilities[0];
};

// Helper function to get all capabilities from feature path
const getAllCapabilities = (featurePath) => {
  const feature = module.exports.FEATURES[featurePath];
  if (!feature?.capabilities) {
    throw new Error(`No capabilities found for feature: ${featurePath}`);
  }
  return feature.capabilities;
};

const getCapabilityOptions = (capabilityName) => {
  for (const feature of Object.values(module.exports.FEATURES)) {
    const capability = feature.capabilities?.find((cap) => cap.capabilityName === capabilityName);
    if (capability?.capabilityOptions) {
      return capability.capabilityOptions;
    }
  }
  throw new Error(`No capability options found for: ${capabilityName}`);
};

module.exports = {
  PATHS,
  getCapability,
  getAllCapabilities,
  getCapabilityOptions,
  FEATURES: {
    [PATHS.HOT_WATER_TEMP]: {
      capabilities: [createTemperatureCapability('hotWater', 'Hot water temperature')],
    },
    [PATHS.OUTSIDE_TEMP]: {
      capabilities: [createTemperatureCapability('outside', 'Outside temperature')],
    },
    [PATHS.BUFFER_TEMP]: {
      capabilities: [createTemperatureCapability('buffer', 'Buffer cylinder temperature')],
    },
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
    [PATHS.COMPRESSOR]: {
      requireRole: 'type:heatpump',
      capabilities: [createActiveCapability('compressor', 'Compressor running')],
    },
    [PATHS.BURNER]: {
      capabilities: [createActiveCapability('burner', 'Burner running', {
        titleTrue: { en: 'Yes' },
        titleFalse: { en: 'No' },
        insightsTitleTrue: { en: 'Yes' },
        insightsTitleFalse: { en: 'No' },
      })],
    },
    [PATHS.COMPRESSOR_STATS]: {
      requireRole: 'type:heatpump',
      capabilities: createStatisticsCapabilities('compressor', 'Compressor'),
    },
    [PATHS.BURNER_STATS]: {
      capabilities: createStatisticsCapabilities('burner', 'Burner'),
    },
    [PATHS.BURNER_MODULATION]: {
      capabilities: [createModulationCapability('burner', 'Burner modulation')],
    },
    [PATHS.RETURN_TEMP]: {
      capabilities: [createTemperatureCapability('return', 'Heating return temperature')],
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
    [PATHS.HEATING_CIRCUIT_0_TEMPERATURE]: {
      capabilities: [createTemperatureCapability('circuit0', 'Heating circuit target temperature', {
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
    [PATHS.HEATING_CIRCUIT_0_SUPPLY_TEMPERATURE]: {
      capabilities: [createTemperatureCapability('circuit0_supply', 'Heating Circuit Supply Temperature', {
        preventTag: true,
      })],
    },
    [PATHS.HEATING_CIRCUIT_0_ROOM_TEMPERATURE]: {
      capabilities: [createTemperatureCapability('circuit0_room', 'Room Temperature')],
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
    [PATHS.FUEL_CELL_STATS]: {
      capabilities: createFuelCellStatisticsCapabilities(),
    },
    [PATHS.FUEL_CELL_PHASE]: {
      capabilities: [{
        capabilityName: 'measure_fuelcell_phase',
        propertyPath: 'value.value',
        capabilityOptions: {
          title: {
            en: 'Fuel cell phase',
          },
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
  },
};
