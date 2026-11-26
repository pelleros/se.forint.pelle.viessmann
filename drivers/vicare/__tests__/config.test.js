/* eslint-env jest */

'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const registry = require('./registry.json');

describe('Config funktioner', () => {
  // Testa varje feature och dess capabilities
  describe('Features och Capabilities', () => {
    const expectedFeatures = {
      'heating.dhw.sensors.temperature.dhwCylinder': {
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
            title: { en: 'Hot water Normal' },
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
            title: { en: 'Hot water Temp 2' },
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
            titleTrue: {
              en: 'Yes', de: 'Ja', nl: 'Ja', fr: 'Oui', sv: 'Ja',
            },
            titleFalse: {
              en: 'No', de: 'Nein', nl: 'Nee', fr: 'Non', sv: 'Nej',
            },
            insightsTitleTrue: {
              en: 'Compressor started', de: 'Verdichter gestartet', nl: 'Compressor gestart', fr: 'Compresseur démarré', sv: 'Kompressorn startade',
            },
            insightsTitleFalse: {
              en: 'Compressor stopped', de: 'Verdichter gestoppt', nl: 'Compressor gestopt', fr: 'Compresseur arrêté', sv: 'Kompressorn stannade',
            },
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
              units: 'h',
              preventInsights: false,
              preventTag: true,
            },
          },
          {
            capabilityName: 'measure_compressor_number.compressorStarts',
            propertyPath: 'starts.value',
            capabilityOptions: {
              title: { en: 'Compressor starts' },
              units: {
                en: 'starts', de: 'Starts', nl: 'starts', fr: 'démarrages', sv: 'starter',
              },
              decimals: 0,
              preventInsights: false,
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
            titleTrue: {
              en: 'Yes', de: 'Ja', nl: 'Ja', fr: 'Oui', sv: 'Ja',
            },
            titleFalse: {
              en: 'No', de: 'Nein', nl: 'Nee', fr: 'Non', sv: 'Nej',
            },
            insightsTitleTrue: {
              en: 'Burner started', de: 'Brenner gestartet', nl: 'Brander gestart', fr: 'Brûleur démarré', sv: 'Brännaren startade',
            },
            insightsTitleFalse: {
              en: 'Burner stopped', de: 'Brenner gestoppt', nl: 'Brander gestopt', fr: 'Brûleur arrêté', sv: 'Brännaren stannade',
            },
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
              units: 'h',
              preventInsights: false,
              preventTag: true,
            },
          },
          {
            capabilityName: 'measure_burner_number.burnerStarts',
            propertyPath: 'starts.value',
            capabilityOptions: {
              title: { en: 'Burner starts' },
              units: {
                en: 'starts', de: 'Starts', nl: 'starts', fr: 'démarrages', sv: 'starter',
              },
              decimals: 0,
              preventInsights: false,
              preventTag: true,
            },
          },
        ],
      },
      'fuelCell.statistics': {
        capabilities: [
          {
            capabilityName: 'measure_fuelcell_number.operationHours',
            propertyPath: 'operationHours.value',
            capabilityOptions: {
              title: { en: 'Fuel cell operation hours' },
              units: 'h',
              preventInsights: false,
              preventTag: true,
            },
          },
          {
            capabilityName: 'measure_fuelcell_number.productionHours',
            propertyPath: 'productionHours.value',
            capabilityOptions: {
              title: { en: 'Fuel cell production hours' },
              units: 'h',
              preventInsights: false,
              preventTag: true,
            },
          },
          {
            capabilityName: 'measure_fuelcell_number.productionStarts',
            propertyPath: 'productionStarts.value',
            capabilityOptions: {
              title: { en: 'Fuel cell starts' },
              units: {
                en: 'starts', de: 'Starts', nl: 'starts', fr: 'démarrages', sv: 'starter',
              },
              decimals: 0,
              preventInsights: false,
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
      'heating.compressors.0.sensors.power': {
        requireRole: 'type:heatpump',
        capabilities: [{
          capabilityName: 'measure_compressor_number.compressorModulation',
          propertyPath: 'value.value',
          capabilityOptions: {
            title: { en: 'Compressor load' },
            units: '%',
            preventInsights: false,
            preventTag: true,
          },
        }],
      },
      'heating.cop.total': {
        capabilities: [{
          capabilityName: 'measure_cop_number.total',
          propertyPath: 'value.value',
          capabilityOptions: {
            title: { en: 'COP total' },
            decimals: 1,
            preventInsights: false,
            preventTag: false,
          },
        }],
      },
      'heating.cop.heating': {
        capabilities: [{
          capabilityName: 'measure_cop_number.heating',
          propertyPath: 'value.value',
          capabilityOptions: {
            title: { en: 'COP heating' },
            decimals: 1,
            preventInsights: false,
            preventTag: false,
          },
        }],
      },
      'heating.cop.dhw': {
        capabilities: [{
          capabilityName: 'measure_cop_number.dhw',
          propertyPath: 'value.value',
          capabilityOptions: {
            title: { en: 'COP hot water' },
            decimals: 1,
            preventInsights: false,
            preventTag: false,
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
      'heating.bufferCylinder.sensors.temperature.top': {
        fallbackFor: 'heating.bufferCylinder.sensors.temperature.main',
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
          expect(actualFeature.fallbackFor).toBe(expectedFeature.fallbackFor);

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

describe('Running state texts', () => {
  const CAPABILITIES_DIR = path.join(__dirname, '../../../.homeycompose/capabilities');
  const LANGUAGES = fs.readdirSync(path.join(__dirname, '../../../locales'))
    .filter((file) => file.endsWith('.json'))
    .map((file) => path.basename(file, '.json'));
  const RETIRED_BASES = new Set(Object.keys(registry.retiredCapabilities).map((id) => id.split('.')[0]));
  const TEXT_KEYS = ['titleTrue', 'titleFalse', 'insightsTitleTrue', 'insightsTitleFalse'];

  // The base capabilities of the boolean "running" states, without the retired ones
  const runningBases = fs.readdirSync(CAPABILITIES_DIR)
    .filter((file) => /^measure_\w+_active\.json$/.test(file))
    .map((file) => path.basename(file, '.json'))
    .filter((base) => !RETIRED_BASES.has(base));
  const definition = (base) => JSON.parse(fs.readFileSync(path.join(CAPABILITIES_DIR, `${base}.json`), 'utf8'));

  test('the app languages and the running capabilities are found', () => {
    expect(LANGUAGES.sort()).toEqual(['de', 'en', 'fr', 'nl', 'sv']);
    expect(runningBases.sort()).toEqual([
      'measure_burner_active', 'measure_compressor_active', 'measure_dhw_active', 'measure_frost_active',
      'measure_fuelcell_active', 'measure_pump_active',
    ]);
  });

  test.each(runningBases)('%s is translated into every app language and names the change on the timeline', (base) => {
    const capability = definition(base);
    for (const key of TEXT_KEYS) {
      expect(Object.keys(capability[key]).sort()).toEqual([...LANGUAGES].sort());
      for (const text of Object.values(capability[key])) expect(text).toEqual(expect.any(String));
    }
    for (const key of ['insightsTitleTrue', 'insightsTitleFalse']) {
      expect(capability[key].en).not.toMatch(/^(Yes|No)$/);
    }
    // Frost protection is switched on and off rather than started
    expect(capability.insightsTitleTrue.en).toMatch(base === 'measure_frost_active' ? / on$/ : / started$/);
    expect(capability.insightsTitleFalse.en).toMatch(base === 'measure_frost_active' ? / off$/ : / stopped$/);
  });

  // The sub-capabilities of the new on/off states (pumps, frost protection, hot water charging)
  // name themselves on the timeline, in every app language
  const subStates = Object.values(config.FEATURES)
    .flatMap((feature) => feature.capabilities)
    .filter((capability) => /^measure_(pump|frost|dhw)_active\./.test(capability.capabilityName));

  test.each(subStates.map((capability) => [capability.capabilityName, capability.capabilityOptions]))(
    '%s has its title and timeline texts in every app language',
    (name, options) => {
      for (const key of ['title', ...TEXT_KEYS]) {
        expect([name, key, Object.keys(options[key]).sort()]).toEqual([name, key, [...LANGUAGES].sort()]);
      }
    },
  );

  const mappedRunningCapabilities = Object.values(config.FEATURES)
    .flatMap((feature) => feature.capabilities)
    .filter((capability) => runningBases.includes(capability.capabilityName));

  test('the compressor and the burner are mapped', () => {
    expect(mappedRunningCapabilities.map((capability) => capability.capabilityName).sort())
      .toEqual(['measure_burner_active', 'measure_compressor_active']);
  });

  // Devices that already have the capability get the texts from config.js, new devices also
  // from the definition: both must show the same
  test.each(mappedRunningCapabilities.map((capability) => [capability.capabilityName, capability]))(
    '%s has the same texts in config.js as in its capability definition',
    (name, capability) => {
      const capabilityDefinition = definition(name);
      for (const key of TEXT_KEYS) expect(capability.capabilityOptions[key]).toEqual(capabilityDefinition[key]);
    },
  );
});

describe('Statistics counters', () => {
  const counters = Object.entries(config.FEATURES)
    .filter(([featurePath]) => /(^|\.)statistics$/.test(featurePath))
    .flatMap(([, feature]) => feature.capabilities);

  test('are the starts and hours of the compressor, the burner and the fuel cell', () => {
    expect(counters.map((capability) => capability.capabilityName).sort()).toEqual([
      'measure_burner_number.burnerHours',
      'measure_burner_number.burnerStarts',
      'measure_compressor_number.compressorHours',
      'measure_compressor_number.compressorStarts',
      'measure_fuelcell_number.operationHours',
      'measure_fuelcell_number.productionHours',
      'measure_fuelcell_number.productionStarts',
    ]);
  });

  test.each(counters.map((capability) => [capability.capabilityName, capability.capabilityOptions]))(
    '%s is logged in Insights, without a Flow tag',
    (name, options) => {
      expect(options.preventInsights).toBe(false);
      expect(options.preventTag).toBe(true);
      if (/Hours$/.test(name)) {
        expect(options.units).toBe('h');
      } else {
        expect(options.decimals).toBe(0);
        expect(options.units.en).toBe('starts');
      }
    },
  );
});
