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

// Hjälpfunktion för att hämta värde från nested path
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

    // Lägg till mock för hasCapability som matchar alla capabilities från config
    device.hasCapability = jest.fn().mockImplementation((capabilityName) => {
      // Samla alla definierade capabilities från FEATURES
      const availableCapabilities = Object.values(FEATURES)
        .flatMap((feature) => feature.capabilities)
        .map((cap) => cap.capabilityName);
      return availableCapabilities.includes(capabilityName);
    });
  });

  describe('onFeaturesUpdated', () => {
    test('uppdaterar temperatur-capabilities korrekt', async () => {
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

    test('uppdaterar active state capabilities korrekt', async () => {
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

    test('uppdaterar modulation capabilities korrekt', async () => {
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

    test('uppdaterar statistik capabilities korrekt', async () => {
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

describe('ViessmannDevice capability handling', () => {
  const exampleFiles = fs
    .readdirSync(path.join(__dirname, '../../../documentation/json-example-files'))
    .filter((file) => file.endsWith('_features.json'))
    .map((file) => jest.requireActual(
      path.join(__dirname, '../../../documentation/json-example-files', file),
    ));

  let device;

  beforeEach(() => {
    device = new ViessmannDevice();
    // Mock nödvändiga metoder
    device.setCapabilityValue = jest.fn();
    device.hasCapability = jest.fn().mockReturnValue(true);
    device.log = jest.fn();
    device.error = jest.fn();
    device._features = Object.values(PATHS);
    device._roles = ['type:heating', 'type:heatpump', 'type:boiler'];
  });

  test('should correctly set capability values from example responses', async () => {
    for (const exampleFile of exampleFiles) {
      for (const [featurePath, featureConfig] of Object.entries(FEATURES)) {
        // Återställ mocken före varje feature-test
        device.setCapabilityValue.mockClear();

        const exampleFeature = exampleFile.data.find((f) => f.feature === featurePath);
        if (!exampleFeature) continue;

        await device.onFeaturesUpdated({ data: [exampleFeature] });

        // Testa varje capability individuellt
        for (const capability of featureConfig.capabilities) {
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
    }
  });

  describe('config property paths', () => {
    const testCases = [];

    for (const exampleFile of exampleFiles) {
      for (const [featurePath, featureConfig] of Object.entries(FEATURES)) {
        const exampleFeature = exampleFile.data.find((f) => f.feature === featurePath);
        if (!exampleFeature) continue;

        // Skippa features som inte är enabled
        if (!exampleFeature.isEnabled) continue;

        // Skippa features som har status !== "connected" (om status finns)
        const status = getValueFromPath(exampleFeature.properties, 'status.value');
        if (status && status !== 'connected') continue;

        for (const capability of featureConfig.capabilities) {
          testCases.push([
            featurePath,
            capability.capabilityName,
            capability.propertyPath,
            exampleFeature.properties,
          ]);
        }
      }
    }

    test.each(testCases)(
      'Feature %s with capability %s should have property path %s',
      (featurePath, capabilityName, propertyPath, properties) => {
        const value = getValueFromPath(properties, propertyPath);
        expect(value).toBeDefined();
      },
    );
  });
});
