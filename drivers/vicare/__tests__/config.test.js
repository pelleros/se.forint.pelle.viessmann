/* eslint-env jest */

'use strict';

const config = require('../config');

describe('Config funktioner', () => {
  // Testa varje feature och dess capabilities
  describe('Features och Capabilities', () => {
    const expectedFeatures = {
      'heating.dhw.sensors.temperature.hotWaterStorage': {
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
      'heating.dhw.temperature.main': {
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
      'heating.dhw.temperature.temp2': {
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
      'heating.circuits.0.operating.programs.normal': {
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
      'heating.dhw.oneTimeCharge': {
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
      'heating.circuits.0.operating.modes.active': {
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
      'heating.sensors.temperature.return': {
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
      'heating.sensors.temperature.outside': {
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
      'heating.compressors.0': {
        requireRole: 'type:heatpump',
        capabilities: [{
          capabilityName: 'measure_compressor_active',
          propertyPath: 'active.value',
          capabilityOptions: {
            title: { en: 'Compressor running' },
            preventInsights: false,
            preventTag: false,
          },
        }],
      },
      'heating.compressors.0.statistics': {
        requireRole: 'type:heatpump',
        capabilities: [
          {
            capabilityName: 'measure_compressor_number.compressorHours',
            propertyPath: 'hours.value',
            capabilityOptions: {
              title: { en: 'Compressor runtime' },
              units: 'hours',
              preventInsights: true,
              preventTag: true,
            },
          },
          {
            capabilityName: 'measure_compressor_number.compressorStarts',
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
      'heating.burners.0': {
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
      'heating.burners.0.statistics': {
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
      'heating.burners.0.modulation': {
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
      'heating.bufferCylinder.sensors.temperature.main': {
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
      'heating.primaryCircuit.sensors.temperature.supply': {
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
      'heating.primaryCircuit.sensors.temperature.return': {
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
      'heating.secondaryCircuit.sensors.temperature.supply': {
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
      'heating.circuits.0.temperature': {
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
      'heating.boiler.sensors.temperature.commonSupply': {
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
      'heating.boiler.sensors.temperature.main': {
        requireRole: 'type:boiler',
        capabilities: [{
          capabilityName: 'measure_temperature.boiler_main',
          propertyPath: 'value.value',
          capabilityOptions: {
            title: { en: 'Boiler Main Temperature' },
            units: '°C',
            decimals: 1,
            preventTag: false,
            preventInsights: false,
          },
        }],
      },
      'heating.circuits.0.sensors.temperature.supply': {
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
      'heating.circuits.0.sensors.temperature.room': {
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
    };

    Object.entries(expectedFeatures).forEach(([featurePath, expectedFeature]) => {
      describe(`Feature: ${featurePath}`, () => {
        test('har korrekt struktur och värden', () => {
          const actualFeature = config.FEATURES[featurePath];
          expect(actualFeature).toBeDefined();
          
          // Testa requireRole om det finns
          if (expectedFeature.requireRole) {
            expect(actualFeature.requireRole).toBe(expectedFeature.requireRole);
          }

          // Testa capabilities
          expect(actualFeature.capabilities).toHaveLength(expectedFeature.capabilities.length);
          
          expectedFeature.capabilities.forEach((expectedCapability, index) => {
            const actualCapability = actualFeature.capabilities[index];
            
            // Testa capabilityName
            expect(actualCapability.capabilityName).toBe(expectedCapability.capabilityName);
            
            // Testa propertyPath
            expect(actualCapability.propertyPath).toBe(expectedCapability.propertyPath);
            
            // Testa command om det finns
            if (expectedCapability.command) {
              expect(actualCapability.command).toEqual(expectedCapability.command);
            }
            
            // Testa valueMapping om det finns
            if (expectedCapability.valueMapping) {
              expect(actualCapability.valueMapping).toEqual(expectedCapability.valueMapping);
            }
            
            // Testa capabilityOptions
            expect(actualCapability.capabilityOptions).toEqual(expectedCapability.capabilityOptions);
          });
        });
      });
    });
  });

  // Behåll de ursprungliga hjälpfunktionstesterna
  describe('getCapability', () => {
    test('kastar ett fel för en ogiltig feature path', () => {
      expect(() => {
        config.getCapability('invalid.path');
      }).toThrow('No capability found for feature: invalid.path');
    });
  });

  describe('getAllCapabilities', () => {
    test('kastar ett fel för en ogiltig feature path', () => {
      expect(() => {
        config.getAllCapabilities('invalid.path');
      }).toThrow('No capabilities found for feature: invalid.path');
    });
  });

  describe('getCapabilityOptions', () => {
    test('kastar ett fel för en ogiltig capability', () => {
      expect(() => {
        config.getCapabilityOptions('invalid.capability');
      }).toThrow('No capability options found for: invalid.capability');
    });
  });
}); 