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

// Feature paths (as defined in the Viessmann api https://documentation.viessmann.com/static/iot/data-points)
// as constants to avoid string errors and enable IDE autocompletion
const PATHS = {
  HOT_WATER_TEMP: 'heating.dhw.sensors.temperature.hotWaterStorage',
  HOT_WATER_TARGET: 'heating.dhw.temperature.main',
  HOT_WATER_TARGET_2: 'heating.dhw.temperature.temp2',
  HEATING_TARGET: 'heating.circuits.0.operating.programs.normal',
  HOT_WATER_CHARGE: 'heating.dhw.oneTimeCharge',
  HEATING_MODE: 'heating.circuits.0.operating.modes.active',
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
};

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
      capabilities: [{
        capabilityName: 'measure_temperature.hotWater',
        propertyPath: 'value.value',
        capabilityOptions: {
          title: { en: 'Hot water temperature' },
          units: '°C',
          decimals: 1,
          preventInsights: false,
          preventTag: false,
        },
      }],
    },
    [PATHS.HOT_WATER_TARGET]: {
      capabilities: [{
        capabilityName: 'target_temperature.hotWater',
        propertyPath: 'value.value',
        command: {
          name: 'setTargetTemperature',
          parameterMapping: {
            value: 'temperature',
          },
        },
        capabilityOptions: {
          title: { en: 'Hot water thermostat' },
          units: '°C',
          min: 10,
          max: 60,
          step: 1,
          preventInsights: true,
        },
      }],
    },
    [PATHS.HOT_WATER_TARGET_2]: {
      capabilities: [{
        capabilityName: 'target_temperature.hotWater2',
        propertyPath: 'value.value',
        command: {
          name: 'setTargetTemperature',
          parameterMapping: {
            value: 'temperature',
          },
        },
        capabilityOptions: {
          title: { en: 'Hot water thermostat 2' },
          units: '°C',
          min: 10,
          max: 60,
          step: 1,
          preventInsights: true,
        },
      }],
    },
    [PATHS.HEATING_TARGET]: {
      capabilities: [{
        capabilityName: 'target_temperature.heating',
        propertyPath: 'temperature.value',
        command: {
          name: 'setTemperature',
          parameterMapping: {
            value: 'targetTemperature',
          },
        },
        capabilityOptions: {
          title: { en: 'Heating thermostat' },
          units: '°C',
          min: 10,
          max: 30,
          step: 1,
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
    [PATHS.HEATING_MODE]: {
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
          title: { en: 'Heating mode' },
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
    [PATHS.RETURN_TEMP]: {
      capabilities: [{
        capabilityName: 'measure_temperature.return',
        propertyPath: 'value.value',
        capabilityOptions: {
          title: { en: 'Heating return temperature' },
          units: '°C',
          decimals: 1,
          preventInsights: false,
          preventTag: false,
        },
      }],
    },
    [PATHS.OUTSIDE_TEMP]: {
      capabilities: [{
        capabilityName: 'measure_temperature.outside',
        propertyPath: 'value.value',
        capabilityOptions: {
          title: { en: 'Outside temperature' },
          units: '°C',
          decimals: 1,
          preventInsights: false,
          preventTag: false,
        },
      }],
    },
    [PATHS.COMPRESSOR]: {
      requireRole: 'type:heatpump',
      capabilities: [{
        capabilityName: 'measure_something_active.compressor',
        propertyPath: 'active.value',
        capabilityOptions: {
          title: { en: 'Compressor running' },
          preventInsights: false,
          preventTag: false,
        },
      }],
    },
    [PATHS.COMPRESSOR_STATS]: {
      requireRole: 'type:heatpump',
      capabilities: [
        {
          capabilityName: 'measure_something_number.compressorHours',
          propertyPath: 'hours.value',
          capabilityOptions: {
            title: { en: 'Compressor runtime' },
            units: 'hours',
            preventInsights: true,
            preventTag: true,
          },
        },
        {
          capabilityName: 'measure_something_number.compressorStarts',
          propertyPath: 'starts.value',
          capabilityOptions: {
            title: { en: 'Compressor starts' },
            units: 'times',
            preventInsights: true,
            preventTag: true,
          },
        },
      ],
    },
    [PATHS.BURNER]: {
      capabilities: [{
        capabilityName: 'measure_burner_active',
        propertyPath: 'active.value',
        capabilityOptions: {
          title: { en: 'Burner running' },
          titleTrue: { en: 'Yes' },
          titleFalse: { en: 'No' },
          insightsTitleTrue: { en: 'Yes' },
          insightsTitleFalse: { en: 'No' },
          preventInsights: false,
          preventTag: false,
        },
      }],
    },
    [PATHS.BURNER_STATS]: {
      capabilities: [
        {
          capabilityName: 'measure_burner_number.burnerHours',
          propertyPath: 'hours.value',
          capabilityOptions: {
            title: { en: 'Burner runtime' },
            units: 'hours',
            preventInsights: true,
            preventTag: true,
          },
        },
        {
          capabilityName: 'measure_burner_number.burnerStarts',
          propertyPath: 'starts.value',
          capabilityOptions: {
            title: { en: 'Burner starts' },
            units: 'times',
            preventInsights: true,
            preventTag: true,
          },
        },
      ],
    },
    [PATHS.BURNER_MODULATION]: {
      capabilities: [{
        capabilityName: 'measure_burner_number.burnerModulation',
        propertyPath: 'value.value',
        capabilityOptions: {
          title: { en: 'Burner modulation' },
          units: '%',
          preventInsights: false,
          preventTag: true,
        },
      }],
    },
    [PATHS.BUFFER_TEMP]: {
      capabilities: [{
        capabilityName: 'measure_temperature.buffer',
        propertyPath: 'value.value',
        capabilityOptions: {
          title: { en: 'Buffer cylinder temperature' },
          units: '°C',
          decimals: 1,
          preventInsights: false,
          preventTag: false,
        },
      }],
    },
    [PATHS.PRIMARY_CIRCUIT_SUPPLY_TEMP]: {
      capabilities: [{
        capabilityName: 'measure_temperature.supply',
        propertyPath: 'value.value',
        capabilityOptions: {
          title: { en: 'Primary supply temperature' },
          units: '°C',
          decimals: 1,
          preventInsights: false,
          preventTag: true,
        },
      }],
    },
    [PATHS.PRIMARY_CIRCUIT_RETURN_TEMP]: {
      capabilities: [{
        capabilityName: 'measure_temperature.primaryReturn',
        propertyPath: 'value.value',
        capabilityOptions: {
          title: { en: 'Primary return temperature' },
          units: '°C',
          decimals: 1,
          preventInsights: false,
          preventTag: true,
        },
      }],
    },
    [PATHS.SECONDARY_CIRCUIT_SUPPLY_TEMP]: {
      capabilities: [{
        capabilityName: 'measure_temperature.secondarySupply',
        propertyPath: 'value.value',
        capabilityOptions: {
          title: { en: 'Secondary supply temperature' },
          units: '°C',
          decimals: 1,
          preventInsights: false,
          preventTag: true,
        },
      }],
    },
    [PATHS.HEATING_CIRCUIT_0_TEMPERATURE]: {
      capabilities: [{
        capabilityName: 'measure_temperature.circuit0',
        propertyPath: 'value.value',
        capabilityOptions: {
          title: { en: 'Heating circuit target temperature' },
          units: '°C',
          decimals: 1,
          preventInsights: false,
          preventTag: true,
        },
      }],
    },
    [PATHS.BOILER_COMMON_SUPPLY_TEMP]: {
      requireRole: 'type:boiler',
      capabilities: [{
        capabilityName: 'measure_temperature.boilerCommonSupply',
        propertyPath: 'value.value',
        capabilityOptions: {
          title: { en: 'Boiler Exit Temperature' },
          units: '°C',
          decimals: 1,
          preventInsights: false,
          preventTag: true,
        },
      }],
    },
    [PATHS.BOILER_TEMPERATURE_MAIN]: {
      requireRole: 'type:boiler',
      capabilities: [{
        capabilityName: 'measure_temperature.boiler_main',
        propertyPath: 'value.value',
        capabilityOptions: {
          title: { en: 'Boiler Main Temperature' },
          units: '°C',
          decimals: 1,
          preventInsights: false,
        },
      }],
    },
    [PATHS.HEATING_CIRCUIT_0_SUPPLY_TEMPERATURE]: {
      capabilities: [{
        capabilityName: 'measure_temperature.circuit0_supply',
        propertyPath: 'value.value',
        capabilityOptions: {
          title: { en: 'Heating Circuit Supply Temperature' },
          units: '°C',
          decimals: 1,
          preventInsights: false,
          preventTag: true,
        },
      }],
    },
    [PATHS.HEATING_CIRCUIT_0_ROOM_TEMPERATURE]: {
      capabilities: [{
        capabilityName: 'measure_temperature.circuit0_room',
        propertyPath: 'value.value',
        capabilityOptions: {
          title: { en: 'Room Temperature' },
          units: '°C',
          decimals: 1,
          preventInsights: false,
          preventTag: false,
        },
      }],
    },
  },
};
