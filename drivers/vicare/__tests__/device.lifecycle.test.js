/* eslint-env jest */

'use strict';

// Covers capability listener registration in device.js.

jest.mock('homey-oauth2app', () => {
  // Minimal in-memory stand-in for the Homey SDK device surface that device.js uses.
  // It deliberately has no `setStore` method, like the real SDK.
  class FakeOAuth2Device {

    constructor() {
      this.__values = new Map();
      this.__options = new Map();
      this.__listeners = new Map();
      this.__store = {};
      this.__available = true;

      this.log = jest.fn();
      this.error = jest.fn();
      this.setAvailable = jest.fn(async () => {
        this.__available = true;
      });
      this.setUnavailable = jest.fn(async () => {
        this.__available = false;
      });
      this.addCapability = jest.fn(async (id) => {
        if (!this.__values.has(id)) this.__values.set(id, null);
      });
      this.removeCapability = jest.fn(async (id) => {
        this.__values.delete(id);
        this.__options.delete(id);
      });
      this.setCapabilityOptions = jest.fn(async (id, options) => {
        this.__options.set(id, options);
      });
      this.setCapabilityValue = jest.fn(async (id, value) => {
        if (!this.__values.has(id)) throw new Error(`Invalid Capability: ${id}`);
        this.__values.set(id, value);
      });
      this.registerCapabilityListener = jest.fn((id, listener) => {
        if (!this.__values.has(id)) throw new Error(`Invalid Capability: ${id}`);
        this.__listeners.set(id, listener);
      });
      this.setStoreValue = jest.fn(async (key, value) => {
        this.__store[key] = value;
      });
    }

    getAvailable() {
      return this.__available;
    }

    getCapabilities() {
      return [...this.__values.keys()];
    }

    hasCapability(id) {
      return this.__values.has(id);
    }

    getCapabilityValue(id) {
      return this.__values.has(id) ? this.__values.get(id) : null;
    }

    getCapabilityOptions(id) {
      if (!this.__values.has(id)) throw new Error(`Invalid Capability: ${id}`);
      return this.__options.get(id) || {};
    }

    getStoreValue(key) {
      return this.__store[key];
    }

    getStore() {
      return { ...this.__store };
    }

  }

  return { OAuth2Device: FakeOAuth2Device };
});

const ViessmannDevice = require('../device');
const { PATHS } = require('../config');

const BASE_STORE = Object.freeze({
  installationId: 123456,
  gatewaySerial: '0000000000000000',
  deviceId: '0',
  roles: ['type:heating', 'type:dhw'],
  features: [],
  constraints: {},
  operatingModes: [
    { id: 'dhw', title: { en: 'DHW' } },
    { id: 'dhwAndHeating', title: { en: 'DHW And Heating' } },
    { id: 'standby', title: { en: 'Standby' } },
  ],
  version: '1.0.14',
});

function createDevice(store = {}) {
  const device = new ViessmannDevice();
  device.__store = JSON.parse(JSON.stringify({ ...BASE_STORE, ...store }));
  device.driver = {
    _startPolling: jest.fn(async () => {}),
    getTriggerCard: jest.fn(() => {
      throw new Error('No trigger card');
    }),
  };
  device.oAuth2Client = {
    executeCommand: jest.fn(async () => undefined),
    getFeatures: jest.fn(async () => ({ data: [] })),
  };
  return device;
}

async function createInitializedDevice(store = {}) {
  const device = createDevice(store);
  await device.onOAuth2Init();
  return device;
}

function listenerRegistrations(device, capabilityName) {
  return device.registerCapabilityListener.mock.calls.filter(([id]) => id === capabilityName).length;
}

describe('ViessmannDevice.registerCapabilityListeners', () => {
  test('registers a listener for a capability that was added after the first pass', async () => {
    const device = await createInitializedDevice({ features: [PATHS.HOT_WATER_TEMP] });
    expect(listenerRegistrations(device, 'target_temperature.hotWater')).toBe(0);

    device._features = [...device._features, PATHS.HOT_WATER_TARGET];
    await device.initializeCapabilities();
    await device.registerCapabilityListeners();

    expect(listenerRegistrations(device, 'target_temperature.hotWater')).toBe(1);
  });

  test('registers each listener only once, however often it runs', async () => {
    const device = await createInitializedDevice({
      features: [PATHS.HOT_WATER_TARGET, PATHS.HOT_WATER_TARGET_2, PATHS.HEATING_CIRCUIT_0_MODE, PATHS.HOT_WATER_CHARGE],
    });

    await device.registerCapabilityListeners();
    await device.registerCapabilityListeners();

    for (const capabilityName of [
      'target_temperature.hotWater',
      'target_temperature.hotWater2',
      'thermostat_mode.heating',
      'thermostat_mode.hotWaterOneTimeCharge',
    ]) {
      expect(listenerRegistrations(device, capabilityName)).toBe(1);
    }
    // Read-only capabilities never get a listener
    expect(device.registerCapabilityListener.mock.calls.map(([id]) => id))
      .not.toContain('measure_temperature.hotWater');
  });
});
