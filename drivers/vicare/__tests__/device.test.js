/* eslint-env jest */

'use strict';

const fs = require('fs');
const path = require('path');
const ViessmannDevice = require('../device');
const { PATHS, FEATURES } = require('../config');

jest.mock('homey-oauth2app', () => ({
  OAuth2Device: class {

    constructor() {
      this.setCapabilityValue = jest.fn();
      this.setAvailable = jest.fn();
      this.setUnavailable = jest.fn();
      this.hasCapability = jest.fn().mockReturnValue(true);
      this.getCapabilityValue = jest.fn();
      this.log = jest.fn();
      this.error = jest.fn();
    }

  },
}));

// Anonymized feature dumps committed to the repo (see test/fixtures/README.md).
const FIXTURES_DIR = path.join(__dirname, '../../../test/fixtures');
// Raw feature dumps from real installations. Local only and never committed, so they are
// used in addition to the fixtures when the folder exists and skipped otherwise.
const DOCUMENTATION_DIR = path.join(__dirname, '../../../documentation/json-example-files');

function loadFeatureDumps(dir, label) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith('_features.json'))
    .sort()
    .map((file) => [`${label}/${file}`, JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))]);
}

const fixtureDumps = loadFeatureDumps(FIXTURES_DIR, 'fixtures');
const exampleDumps = [...fixtureDumps, ...loadFeatureDumps(DOCUMENTATION_DIR, 'documentation')];

// Helper to read a value from a nested path
function getValueFromPath(obj, path) {
  try {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
  } catch {
    return undefined;
  }
}

describe('ViessmannDevice', () => {
  let device;
  beforeEach(() => {
    device = new ViessmannDevice();
    device._features = Object.values(device.constructor.PATHS);
    device._roles = ['type:heating', 'type:heatpump', 'type:boiler'];

    // Mock hasCapability so it matches every capability defined in config
    device.hasCapability = jest.fn().mockImplementation((capabilityName) => {
      // Collect every capability defined in FEATURES
      const availableCapabilities = Object.values(FEATURES)
        .flatMap((feature) => feature.capabilities)
        .map((cap) => cap.capabilityName);
      return availableCapabilities.includes(capabilityName);
    });
  });

  describe('onFeaturesUpdated', () => {
    test('updates temperature capabilities correctly', async () => {
      const features = [
        {
          feature: PATHS.HOT_WATER_TEMP,
          properties: {
            value: { value: 45.0 },
            status: { value: 'connected' },
          },
          isEnabled: true,
        },
        {
          feature: PATHS.OUTSIDE_TEMP,
          properties: {
            value: { value: 10.5 },
            status: { value: 'connected' },
          },
          isEnabled: true,
        },
        {
          feature: PATHS.BUFFER_TEMP,
          properties: {
            value: { value: 38.7 },
            status: { value: 'connected' },
          },
          isEnabled: true,
        },
      ];

      const response = { data: features };
      await device.onFeaturesUpdated(response, false);

      expect(device.setCapabilityValue).toHaveBeenCalledWith(
        'measure_temperature.hotWater',
        45.0,
      );
      expect(device.setCapabilityValue).toHaveBeenCalledWith(
        'measure_temperature.outside',
        10.5,
      );
      expect(device.setCapabilityValue).toHaveBeenCalledWith(
        'measure_temperature.buffer',
        38.7,
      );
    });

    test('updates active state capabilities correctly', async () => {
      const features = [
        {
          feature: PATHS.COMPRESSOR,
          properties: {
            active: { value: true },
          },
          isEnabled: true,
        },
        {
          feature: PATHS.BURNER,
          properties: {
            active: { value: false },
          },
          isEnabled: true,
        },
      ];

      const response = { data: features };
      await device.onFeaturesUpdated(response, false);

      expect(device.setCapabilityValue).toHaveBeenCalledWith(
        'measure_compressor_active',
        true,
      );
      expect(device.setCapabilityValue).toHaveBeenCalledWith(
        'measure_burner_active',
        false,
      );
    });

    test('updates modulation capabilities correctly', async () => {
      const features = [
        {
          feature: PATHS.BURNER_MODULATION,
          properties: {
            value: { value: 75 },
          },
          isEnabled: true,
        },
      ];

      const response = { data: features };
      await device.onFeaturesUpdated(response, false);

      expect(device.setCapabilityValue).toHaveBeenCalledWith(
        'measure_burner_number.burnerModulation',
        75,
      );
    });

    test('updates statistics capabilities correctly', async () => {
      const features = [
        {
          feature: PATHS.BURNER_STATS,
          properties: {
            hours: { value: 1234 },
            starts: { value: 567 },
          },
          isEnabled: true,
        },
      ];

      const response = { data: features };
      await device.onFeaturesUpdated(response, false);

      expect(device.setCapabilityValue).toHaveBeenCalledWith(
        'measure_burner_number.burnerHours',
        1234,
      );
      expect(device.setCapabilityValue).toHaveBeenCalledWith(
        'measure_burner_number.burnerStarts',
        567,
      );
    });
  });
});

test('test/fixtures contains feature dumps', () => {
  expect(fixtureDumps.length).toBeGreaterThan(0);
});

describe.each(exampleDumps)('ViessmannDevice capability handling with %s', (name, exampleFile) => {
  let device;

  beforeEach(() => {
    device = new ViessmannDevice();
    // Mock the methods the device needs
    device.setCapabilityValue = jest.fn();
    device.hasCapability = jest.fn().mockReturnValue(true);
    device.log = jest.fn();
    device.error = jest.fn();
    device._features = Object.values(PATHS);
    device._roles = ['type:heating', 'type:heatpump', 'type:boiler'];
  });

  test('should correctly set capability values from the example response', async () => {
    for (const [featurePath, featureConfig] of Object.entries(FEATURES)) {
      // Reset the mock before each feature
      device.setCapabilityValue.mockClear();

      const exampleFeature = exampleFile.data.find((f) => f.feature === featurePath);
      if (!exampleFeature) continue;

      await device.onFeaturesUpdated({ data: [exampleFeature] });

      // Check each capability individually (computed values, see computedValues.test.js)
      for (const capability of featureConfig.capabilities) {
        if (capability.computed) continue;
        const expectedValue = getValueFromPath(exampleFeature.properties, capability.propertyPath);

        if (expectedValue !== undefined) {
          const mappedValue = capability.valueMapping
            ? capability.valueMapping[expectedValue]
            : expectedValue;

          expect(device.setCapabilityValue).toHaveBeenCalledWith(
            capability.capabilityName,
            mappedValue,
          );
        }
      }
    }
  });

  describe('config property paths', () => {
    const testCases = [];

    for (const [featurePath, featureConfig] of Object.entries(FEATURES)) {
      const exampleFeature = exampleFile.data.find((f) => f.feature === featurePath);
      if (!exampleFeature) continue;

      // Skip features that are not enabled
      if (!exampleFeature.isEnabled) continue;

      // Skip features that are not connected (a pump's status is its value, on or off)
      const status = getValueFromPath(exampleFeature.properties, 'status.value');
      if (status === 'notConnected') continue;

      for (const capability of featureConfig.capabilities) {
        testCases.push([
          featurePath,
          capability.capabilityName,
          capability.propertyPath,
          exampleFeature.properties,
        ]);
      }
    }

    test('the example covers at least one feature from config', () => {
      expect(testCases.length).toBeGreaterThan(0);
    });

    if (testCases.length > 0) {
      test.each(testCases)(
        'Feature %s with capability %s should have property path %s',
        (featurePath, capabilityName, propertyPath, properties) => {
          const value = getValueFromPath(properties, propertyPath);
          expect(value).toBeDefined();
        },
      );
    }
  });
});
