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

/* eslint-disable */
// Feature paths as constants to avoid string errors and enable IDE autocompletion
const PATHS = {
  COMPRESSOR: 'heating.compressors.0',
  COMPRESSOR_STATS: 'heating.compressors.0.statistics',
  BURNER: 'heating.burners.0',
  BURNER_STATS: 'heating.burners.0.statistics',
  HOT_WATER_TEMP: 'heating.dhw.temperature.main',
  HOT_WATER_TARGET: 'heating.dhw.temperature.temp2',
  HOT_WATER_CHARGE: 'heating.dhw.oneTimeCharge',
  HEATING_MODE: 'heating.circuits.0.operating.modes.active',
  HEATING_TARGET: 'heating.circuits.0.operating.programs.normal',
  OUTSIDE_TEMP: 'heating.sensors.temperature.outside'
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

module.exports = {
  PATHS,
  getCapability,
  getAllCapabilities,
  FEATURES: {
    [PATHS.COMPRESSOR]: {
      requireRole: 'type:heatpump',
      capabilities: [{
        capabilityName: 'measure_something_active.compressor',
        propertyPath: 'active.value',
        capabilityOptions: {
          title: { en: 'Compressor running' },
          titleTrue: { en: 'Yes' },
          titleFalse: { en: 'No' }
        }
      }]
    },
    [PATHS.HOT_WATER_CHARGE]: {
      capabilities: [{
        capabilityName: 'thermostat_mode.hotWaterOneTimeCharge',
        propertyPath: 'active.value',
        valueMapping: {
          true: 'activate',
          false: 'deactivate'
        },
        capabilityOptions: {
          title: { en: 'Hot water one time charge' }
        }
      }]
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
            preventTag: true
          }
        },
        {
          capabilityName: 'measure_something_number.compressorStarts',
          propertyPath: 'starts.value',
          capabilityOptions: {
            title: { en: 'Compressor starts' },
            units: 'times',
            preventInsights: true,
            preventTag: true
          }
        }
      ]
    },
    [PATHS.BURNER]: {
      requireRole: 'type:boiler',
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
          preventTag: false
        }
      }]
    },
    [PATHS.BURNER_STATS]: {
      requireRole: 'type:boiler',
      capabilities: [
        {
          capabilityName: 'measure_burner_number.burnerHours',
          propertyPath: 'hours.value',
          capabilityOptions: {
            title: { en: 'Burner runtime' },
            units: 'hours',
            preventInsights: true,
            preventTag: true
          }
        },
        {
          capabilityName: 'measure_burner_number.burnerStarts',
          propertyPath: 'starts.value',
          capabilityOptions: {
            title: { en: 'Burner starts' },
            units: 'times',
            preventInsights: true,
            preventTag: true
          }
        }
      ]
    },
    [PATHS.BURNER_MODULATION]: {
      requireRole: 'type:boiler',
      capabilities: [{
        capabilityName: 'measure_burner_number.burnerModulation',
        propertyPath: 'value.value',
        capabilityOptions: {
          title: { en: 'Burner modulation' },
          units: '%',
          icon: '/assets/burner.svg',
          preventInsights: false
        }
      }]
    },
    [PATHS.HOT_WATER_TEMP]: {
      capabilities: [{
        capabilityName: 'measure_temperature.hotWater',
        propertyPath: 'value.value',
        capabilityOptions: {
          title: { en: 'Hot water temperature' },
          units: '°C'
        }
      }]
    },
    [PATHS.HOT_WATER_TARGET]: {
      capabilities: [{
        capabilityName: 'target_temperature.hotWater',
        propertyPath: 'value.value',
        capabilityOptions: {
          title: { en: 'Hot water target temperature' },
          units: '°C',
          min: 10,
          max: 60,
          step: 1
        }
      }]
    },
    [PATHS.HEATING_MODE]: {
      capabilities: [{
        capabilityName: 'thermostat_mode.heating',
        propertyPath: 'value.value',
        valueMapping: {
          'dhw': 'dhw',
          'dhwAndHeating': 'dhwAndHeating',
          'heating': 'heating',
          'standby': 'standby'
        },
        capabilityOptions: {
          title: { en: 'Heating mode' }
        }
      }]
    },
    [PATHS.HEATING_TARGET]: {
      capabilities: [{
        capabilityName: 'target_temperature.heating',
        propertyPath: 'temperature.value',
        capabilityOptions: {
          title: { en: 'Heating target temperature' },
          units: '°C',
          min: 3,
          max: 37,
          step: 1
        }
      }]
    },
    [PATHS.OUTSIDE_TEMP]: {
      capabilities: [{
        capabilityName: 'measure_temperature.outside',
        propertyPath: 'value.value',
        capabilityOptions: {
          title: { en: 'Outside temperature' },
          units: '°C'
        }
      }]
    }
  }
};
