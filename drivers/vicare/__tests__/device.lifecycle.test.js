/* eslint-env jest */

'use strict';

// Covers feature discovery (extended poll), capability listener registration,
// command error reporting and operating mode handling in device.js.

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
const { PATHS, FEATURES, getCapabilityOptions } = require('../config');
const { MODE_TITLES } = require('../config/thermostat');

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

const feature = (path, properties = {}, extra = {}) => ({
  feature: path,
  isEnabled: true,
  properties,
  ...extra,
});

const value = (v) => ({ value: { type: 'number', value: v } });

function createDevice(store = {}) {
  const device = new ViessmannDevice();
  device.__store = JSON.parse(JSON.stringify({ ...BASE_STORE, ...store }));
  device.driver = {
    _startPolling: jest.fn(async () => {}),
    _stopPolling: jest.fn(async () => {}),
    // The upgrade refresh in checkUpgradeSpecifics is covered elsewhere; here it finds nothing
    _getEnabledFeaturesAndOpModes: jest.fn(async () => ({})),
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

describe('ViessmannDevice feature discovery on extended poll', () => {
  test('persists new features, adds their capabilities and listeners, and stays available', async () => {
    const initialFeatures = [PATHS.HOT_WATER_TEMP, PATHS.HEATING_CIRCUIT_0_MODE];
    const device = await createInitializedDevice({ features: initialFeatures });
    const capabilitiesBefore = device.getCapabilities();
    expect(capabilitiesBefore).toEqual(expect.arrayContaining([
      'measure_temperature.hotWater',
      'thermostat_mode.heating',
    ]));
    expect(device.hasCapability('target_temperature.hotWater')).toBe(false);

    await device.onFeaturesUpdated({
      data: [
        feature(PATHS.HOT_WATER_TEMP, value(48)),
        feature(PATHS.HEATING_CIRCUIT_0_MODE, { value: { type: 'string', value: 'dhwAndHeating' } }),
        feature(PATHS.HOT_WATER_TARGET, value(50), {
          commands: {
            setTargetTemperature: {
              isExecutable: true,
              params: {
                temperature: {
                  type: 'number', required: true, constraints: { min: 10, max: 60, stepping: 1 },
                },
              },
            },
          },
        }),
        feature(PATHS.OUTSIDE_TEMP, value(3.5)),
        feature('heating.some.future.feature', value(1)),
        feature('heating.disabled.feature', value(1), { isEnabled: false }),
        feature('heating.offline.sensor', { status: { type: 'string', value: 'notConnected' } }),
      ],
    }, true);

    const expectedFeatures = [
      ...initialFeatures,
      PATHS.HOT_WATER_TARGET,
      PATHS.OUTSIDE_TEMP,
      'heating.some.future.feature',
    ];
    expect(device.setStoreValue).toHaveBeenCalledWith('features', expectedFeatures);
    expect(device.getStoreValue('features')).toEqual(expectedFeatures);
    expect(device._features).toEqual(expectedFeatures);

    expect(device.hasCapability('target_temperature.hotWater')).toBe(true);
    expect(device.hasCapability('measure_temperature.outside')).toBe(true);
    expect(device.removeCapability).not.toHaveBeenCalled();
    expect(device.getCapabilities()).toEqual(expect.arrayContaining(capabilitiesBefore));

    expect(listenerRegistrations(device, 'target_temperature.hotWater')).toBe(1);
    expect(listenerRegistrations(device, 'thermostat_mode.heating')).toBe(1);

    expect(device.setUnavailable).not.toHaveBeenCalled();
    expect(device.setAvailable).toHaveBeenCalled();
    expect(device.getCapabilityValue('target_temperature.hotWater')).toBe(50);
    expect(device.getCapabilityValue('measure_temperature.outside')).toBe(3.5);
    expect(device.getCapabilityValue('measure_temperature.hotWater')).toBe(48);

    // The listener of the newly added capability sends the command for its own feature
    await device.__listeners.get('target_temperature.hotWater')(52);
    expect(device.oAuth2Client.executeCommand).toHaveBeenCalledWith(expect.objectContaining({
      feature: PATHS.HOT_WATER_TARGET,
      command: 'setTargetTemperature',
      body: { temperature: 52 },
    }));
  });

  test('never drops stored features or their capabilities when the API stops reporting them', async () => {
    const initialFeatures = [PATHS.HOT_WATER_TEMP, PATHS.BUFFER_TEMP];
    const device = await createInitializedDevice({ features: initialFeatures });
    expect(device.hasCapability('measure_temperature.buffer')).toBe(true);

    await device.onFeaturesUpdated({
      data: [
        feature(PATHS.HOT_WATER_TEMP, value(48)),
        feature(PATHS.BUFFER_TEMP, { status: { type: 'string', value: 'notConnected' } }),
        feature(PATHS.OUTSIDE_TEMP, value(3.5)),
      ],
    }, true);

    expect(device.getStoreValue('features')).toEqual([...initialFeatures, PATHS.OUTSIDE_TEMP]);
    expect(device.hasCapability('measure_temperature.buffer')).toBe(true);
    expect(device.removeCapability).not.toHaveBeenCalled();
  });

  test('does not write the store when an extended poll finds nothing new', async () => {
    const device = await createInitializedDevice({ features: [PATHS.HOT_WATER_TEMP] });
    device.setStoreValue.mockClear();

    await device.onFeaturesUpdated({ data: [feature(PATHS.HOT_WATER_TEMP, value(48))] }, true);

    expect(device.setStoreValue).not.toHaveBeenCalled();
    expect(device.getCapabilityValue('measure_temperature.hotWater')).toBe(48);
  });

  test('a regular (filtered) poll never changes the stored features', async () => {
    const device = await createInitializedDevice({ features: [PATHS.HOT_WATER_TEMP] });
    device.setStoreValue.mockClear();

    await device.onFeaturesUpdated({
      data: [feature(PATHS.HOT_WATER_TEMP, value(48)), feature(PATHS.OUTSIDE_TEMP, value(3.5))],
    }, false);

    expect(device.setStoreValue).not.toHaveBeenCalled();
    expect(device.hasCapability('measure_temperature.outside')).toBe(false);
  });

  test('stores a role-gated feature but only adds its capability when the role matches', async () => {
    // A boiler: its own role tag is trusted, so a compressor does not make it a heat pump
    const device = await createInitializedDevice({
      features: [PATHS.HOT_WATER_TEMP], roles: ['type:heating', 'type:dhw', 'type:boiler'],
    });

    await device.onFeaturesUpdated({
      data: [feature(PATHS.COMPRESSOR, { active: { type: 'boolean', value: true } })],
    }, true);

    expect(device.getStoreValue('features')).toContain(PATHS.COMPRESSOR);
    expect(device.hasCapability('measure_compressor_active')).toBe(false);
    expect(device.setUnavailable).not.toHaveBeenCalled();
  });

  test('a failing discovery step does not make the device unavailable and is retried', async () => {
    const initialFeatures = [PATHS.HOT_WATER_TEMP];
    const device = await createInitializedDevice({ features: initialFeatures });
    device.setStoreValue.mockRejectedValueOnce(new Error('store is busy'));

    const response = {
      data: [feature(PATHS.HOT_WATER_TEMP, value(47)), feature(PATHS.OUTSIDE_TEMP, value(3.5))],
    };
    await device.onFeaturesUpdated(response, true);

    expect(device.setUnavailable).not.toHaveBeenCalled();
    expect(device.error).toHaveBeenCalled();
    expect(device._features).toEqual(initialFeatures);
    expect(device.getCapabilityValue('measure_temperature.hotWater')).toBe(47);

    // Next extended poll succeeds
    await device.onFeaturesUpdated(response, true);
    expect(device.getStoreValue('features')).toEqual([...initialFeatures, PATHS.OUTSIDE_TEMP]);
    expect(device.hasCapability('measure_temperature.outside')).toBe(true);
    expect(device.setUnavailable).not.toHaveBeenCalled();
  });
});

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

describe('ViessmannDevice.getFeatures', () => {
  test('requests only the configured paths when filtered', async () => {
    const device = await createInitializedDevice();
    await device.getFeatures({ useFilter: true });
    expect(device.oAuth2Client.getFeatures).toHaveBeenLastCalledWith(expect.objectContaining({
      filter: Object.values(PATHS).join(','),
    }));
  });

  test('requests all features when unfiltered (extended poll and settings page API)', async () => {
    const device = await createInitializedDevice();
    await device.getFeatures({ useFilter: false });
    expect(device.oAuth2Client.getFeatures).toHaveBeenLastCalledWith(expect.objectContaining({
      filter: undefined,
    }));
  });
});

describe('ViessmannDevice.executeCommand', () => {
  const capabilityFor = (path) => FEATURES[path].capabilities[0];

  test('includes the underlying API error in the thrown message and keeps it as cause', async () => {
    const device = await createInitializedDevice({ features: [PATHS.HOT_WATER_TARGET] });
    const apiError = new Error('Viessmann API error (HTTP 400): DEVICE_COMMUNICATION_ERROR: Gateway offline');
    device.oAuth2Client.executeCommand.mockRejectedValueOnce(apiError);

    const promise = device.executeCommand(PATHS.HOT_WATER_TARGET, capabilityFor(PATHS.HOT_WATER_TARGET), 55);

    await expect(promise).rejects.toThrow('Error executing command');
    await promise.catch((error) => {
      expect(error.message).toContain('HTTP 400');
      expect(error.message).toContain('DEVICE_COMMUNICATION_ERROR: Gateway offline');
      expect(error.cause).toBe(apiError);
    });
    expect(device.getCapabilityValue('target_temperature.hotWater')).not.toBe(55);
  });

  test('surfaces the API error to the user through the capability listener', async () => {
    const device = await createInitializedDevice({ features: [PATHS.HEATING_CIRCUIT_0_MODE] });
    device.oAuth2Client.executeCommand.mockRejectedValueOnce(new Error('Access forbidden'));

    await expect(device.__listeners.get('thermostat_mode.heating')('standby'))
      .rejects.toThrow('Error executing command: Access forbidden');
  });

  test('handles rejections that are not Error instances', async () => {
    const device = await createInitializedDevice({ features: [PATHS.HOT_WATER_CHARGE] });
    device.oAuth2Client.executeCommand.mockRejectedValueOnce('socket hang up');

    await expect(device.executeCommand(PATHS.HOT_WATER_CHARGE, capabilityFor(PATHS.HOT_WATER_CHARGE), 'activate'))
      .rejects.toThrow('Error executing command: socket hang up');
  });

  test('sets the capability value after a successful command', async () => {
    const device = await createInitializedDevice({ features: [PATHS.HOT_WATER_TARGET] });

    await expect(device.executeCommand(PATHS.HOT_WATER_TARGET, capabilityFor(PATHS.HOT_WATER_TARGET), 55))
      .resolves.toBe(true);
    expect(device.getCapabilityValue('target_temperature.hotWater')).toBe(55);
  });
});

describe('ViessmannDevice.initializeOperatingModes', () => {
  const CAPABILITY = 'thermostat_mode.heating';
  const ids = (values) => values.map((mode) => mode.id);

  function createModeDevice(operatingModes) {
    const device = createDevice();
    device.__values.set(CAPABILITY, null);
    device.__options.set(CAPABILITY, JSON.parse(JSON.stringify(getCapabilityOptions(CAPABILITY))));
    device._operatingModes = operatingModes;
    return device;
  }

  const lastValues = (device) => device.__options.get(CAPABILITY).values;

  test('removes every mode the device does not support, including adjacent ones', async () => {
    // Capability starts with dhw, dhwAndHeating, heating, standby
    const device = createModeDevice([{ id: 'standby', title: { en: 'Standby' } }]);
    await device.initializeOperatingModes();
    expect(ids(lastValues(device))).toEqual(['standby']);

    const device2 = createModeDevice([{ id: 'dhw' }, { id: 'standby' }]);
    await device2.initializeOperatingModes();
    expect(ids(lastValues(device2))).toEqual(['dhw', 'standby']);
  });

  test('keeps existing order and titles, then appends device modes not yet present', async () => {
    const device = createModeDevice([
      { id: 'heating', title: { en: 'Heating (device)' } },
      { id: 'forcedNormal', title: { en: 'Forced Normal' } },
      { id: 'dhw', title: { en: 'DHW (device)' } },
      { id: 'forcedNormal', title: { en: 'Forced Normal' } },
    ]);
    await device.initializeOperatingModes();

    // The configured modes (with their translated titles) in their order, then the rest
    expect(lastValues(device)).toEqual([
      { id: 'dhw', title: MODE_TITLES.dhw },
      { id: 'heating', title: MODE_TITLES.heating },
      { id: 'forcedNormal', title: MODE_TITLES.forcedNormal },
    ]);
  });

  test('keeps the other capability options and does not mutate the previous options', async () => {
    const device = createModeDevice([{ id: 'standby' }]);
    const previousOptions = device.__options.get(CAPABILITY);
    const previousValues = [...previousOptions.values];

    await device.initializeOperatingModes();

    const options = device.__options.get(CAPABILITY);
    expect(options).not.toBe(previousOptions);
    expect(options.title).toEqual(previousOptions.title);
    expect(options.preventInsights).toBe(true);
    expect(previousOptions.values).toEqual(previousValues);
  });

  test.each([
    ['empty', []],
    ['missing', undefined],
    ['not a list', null],
  ])('leaves the values unchanged when stored operating modes are %s', async (_, operatingModes) => {
    const device = createModeDevice(operatingModes);
    const before = JSON.parse(JSON.stringify(device.__options.get(CAPABILITY)));

    await device.initializeOperatingModes();

    expect(device.setCapabilityOptions).not.toHaveBeenCalled();
    expect(device.__options.get(CAPABILITY)).toEqual(before);
  });

  test('does nothing when the device has no operating mode capability', async () => {
    const device = createDevice();
    device._operatingModes = [{ id: 'standby' }];

    await expect(device.initializeOperatingModes()).resolves.toBeUndefined();
    expect(device.setCapabilityOptions).not.toHaveBeenCalled();
  });
});

describe('ViessmannDevice availability and deletion', () => {
  const POLLING_KEY = `${BASE_STORE.installationId}-${BASE_STORE.gatewaySerial}-${BASE_STORE.deviceId}`;

  test('stops polling when the device is deleted or unloaded', async () => {
    const device = await createInitializedDevice();
    expect(device.driver._startPolling).toHaveBeenCalledWith(device, POLLING_KEY);

    await device.onOAuth2Deleted();
    expect(device.driver._stopPolling).toHaveBeenCalledWith(POLLING_KEY);

    device.driver._stopPolling.mockClear();
    await device.onOAuth2Uninit();
    expect(device.driver._stopPolling).toHaveBeenCalledWith(POLLING_KEY);
  });

  test.each([
    ['setAvailable', { data: [] }],
    ['setUnavailable', null], // a response without data makes the update fail
  ])('a rejected %s (device deleted meanwhile) is logged, not thrown', async (method, response) => {
    const device = await createInitializedDevice();
    const deviceNotFound = new Error('device_not_found');
    device[method].mockRejectedValueOnce(deviceNotFound);

    await expect(device.onFeaturesUpdated(response, false)).resolves.toBeUndefined();
    expect(device[method]).toHaveBeenCalled();
    expect(device.error).toHaveBeenCalledWith(expect.any(String), deviceNotFound);
  });
});
