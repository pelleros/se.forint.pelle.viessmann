/* eslint-env jest */

'use strict';

// Covers the one-time metadata refresh in checkUpgradeSpecifics for devices paired before
// 1.0.15 (no heatingCircuitId/commandMetadata in the store): the stored feature list only
// grows, and a failing refresh never keeps the device from starting and polling.

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const ViessmannDriver = require('../driver');
const ViessmannDevice = require('../device');
const { PATHS } = require('../config');

const POLLING_KEY = '123456-0000000000000000-0';

const STORE_1_0_14 = Object.freeze({
  installationId: 123456,
  gatewaySerial: '0000000000000000',
  deviceId: '0',
  roles: ['type:heating', 'type:dhw', 'type:heatpump'],
  features: [
    'heating.circuits',
    PATHS.HOT_WATER_TEMP,
    PATHS.BUFFER_TEMP,
    PATHS.HEATING_CIRCUIT_0_MODE,
    PATHS.HEATING_CIRCUIT_0_TARGET,
  ],
  constraints: {
    [PATHS.HEATING_CIRCUIT_0_TARGET]: { targetTemperature: { min: 10, max: 30, stepping: 1 } },
  },
  operatingModes: [
    { id: 'dhw', title: { en: 'DHW' } },
    { id: 'dhwAndHeating', title: { en: 'DHW And Heating' } },
    { id: 'standby', title: { en: 'Standby' } },
  ],
  version: '1.0.14',
});

// Capabilities that 1.0.14 created for STORE_1_0_14
const CAPABILITIES_1_0_14 = Object.freeze([
  'measure_temperature.hotWater',
  'measure_temperature.buffer',
  'thermostat_mode.heating',
  'target_temperature.heating',
]);

const feature = (path, properties = {}, extra = {}) => ({
  feature: path, isEnabled: true, properties, ...extra,
});
const temperature = (value) => ({ value: { type: 'number', value } });
const NOT_CONNECTED = { status: { type: 'string', value: 'notConnected' } };

// An unfiltered features response of the installation today
function currentFeatures({ bufferConnected = false, modesEnabled = true } = {}) {
  return {
    data: [
      feature('heating.circuits', { enabled: { type: 'array', value: ['0'] } }),
      feature(PATHS.HOT_WATER_TEMP, temperature(48)),
      feature(PATHS.OUTSIDE_TEMP, temperature(3.5)),
      feature(PATHS.BUFFER_TEMP, bufferConnected ? temperature(35) : NOT_CONNECTED),
      feature(PATHS.HEATING_CIRCUIT_0_MODE, { value: { type: 'string', value: 'dhwAndHeating' } }, {
        isEnabled: modesEnabled,
        commands: {
          setMode: {
            isExecutable: true,
            params: {
              mode: { type: 'string', required: true, constraints: { enum: ['dhw', 'dhwAndHeating', 'standby', 'forcedReduced'] } },
            },
          },
        },
      }),
      feature(PATHS.HEATING_CIRCUIT_0_TARGET, { temperature: temperature(21).value }, {
        commands: {
          setTemperature: {
            isExecutable: true,
            params: {
              targetTemperature: { type: 'number', required: true, constraints: { min: 3, max: 37, stepping: 1 } },
            },
          },
        },
      }),
    ],
  };
}

// The refresh requests all features; a regular poll requests a filter
const isRefresh = (request) => request.filter === undefined;

function createDevice({
  store = STORE_1_0_14, capabilities = CAPABILITIES_1_0_14, getFeatures,
} = {}) {
  const driver = new ViessmannDriver();
  const device = new ViessmannDevice();
  device.driver = driver;
  device.__store = JSON.parse(JSON.stringify(store));
  for (const id of capabilities) device.__values.set(id, null);
  device.oAuth2Client = {
    getFeatures: jest.fn(getFeatures || (async () => currentFeatures())),
    executeCommand: jest.fn(async () => ({ data: { success: true } })),
  };
  return { driver, device };
}

// Restarting the app creates a new device instance with the same store and capabilities
function restart({ device }, getFeatures) {
  return createDevice({ store: device.getStore(), capabilities: device.getCapabilities(), getFeatures });
}

const refreshCalls = (device) => device.oAuth2Client.getFeatures.mock.calls.filter(([request]) => isRefresh(request));
const pollCalls = (device) => device.oAuth2Client.getFeatures.mock.calls.filter(([request]) => !isRefresh(request));

beforeEach(() => {
  jest.spyOn(Math, 'random').mockReturnValue(0.5); // regular (filtered) polls only
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('upgrade refresh of a device paired on 1.0.14', () => {
  test('stores circuit and command metadata and merges the feature lists', async () => {
    const { driver, device } = createDevice();

    await device.onOAuth2Init();

    expect(refreshCalls(device)).toHaveLength(1);
    expect(device.getStoreValue('heatingCircuitId')).toBe('0');
    expect(device.getStoreValue('commandMetadata')[PATHS.HEATING_CIRCUIT_0_MODE].setMode).toBeDefined();
    expect(device.getStoreValue('features')).toEqual([...STORE_1_0_14.features, PATHS.OUTSIDE_TEMP]);
    expect(device.hasCapability('measure_temperature.outside')).toBe(true);
    expect(device.getStoreValue('operatingModes').map((mode) => mode.id)).toContain('forcedReduced');
    expect(device.getStoreValue('constraints')[PATHS.HEATING_CIRCUIT_0_TARGET].targetTemperature.min).toBe(3);
    expect(driver._devicePollers.has(POLLING_KEY)).toBe(true);
    expect(device.removeCapability).not.toHaveBeenCalled();
  });

  test('a sensor that is notConnected at upgrade time keeps its stored feature and capability', async () => {
    const { device } = createDevice({ getFeatures: async () => currentFeatures({ bufferConnected: false }) });

    await device.onOAuth2Init();

    expect(device.getStoreValue('features')).toContain(PATHS.BUFFER_TEMP);
    expect(device.hasCapability('measure_temperature.buffer')).toBe(true);
    expect(device.getCapabilities()).toEqual(expect.arrayContaining(CAPABILITIES_1_0_14));
    expect(device.removeCapability).not.toHaveBeenCalled();
  });

  test('runs once: the next start does not refresh again', async () => {
    const first = createDevice();
    await first.device.onOAuth2Init();

    const second = restart(first);
    await second.device.onOAuth2Init();

    expect(refreshCalls(second.device)).toHaveLength(0);
    expect(pollCalls(second.device)).toHaveLength(1);
    expect(second.device.getStoreValue('features')).toEqual(first.device.getStoreValue('features'));
  });

  test('keeps stored operating modes and constraints the API does not report right now', async () => {
    const { device } = createDevice({ getFeatures: async () => currentFeatures({ modesEnabled: false }) });

    await device.onOAuth2Init();

    expect(device.getStoreValue('operatingModes')).toEqual(STORE_1_0_14.operatingModes);
    expect(device.getStoreValue('features')).toContain(PATHS.HEATING_CIRCUIT_0_MODE);
    expect(device.hasCapability('thermostat_mode.heating')).toBe(true);
    expect(device.getStoreValue('constraints')[PATHS.HEATING_CIRCUIT_0_TARGET].targetTemperature.min).toBe(3);
  });
});

describe('a failing upgrade refresh', () => {
  const failingRefresh = async (request) => {
    if (isRefresh(request)) throw Object.assign(new Error('Viessmann HTTP 503: Service Unavailable'), { status: 503 });
    return currentFeatures();
  };

  test('an API failure is logged and the device still starts and polls', async () => {
    const { driver, device } = createDevice({ getFeatures: failingRefresh });

    await expect(device.onOAuth2Init()).resolves.toBeUndefined();

    expect(device.error).toHaveBeenCalledWith(expect.stringContaining('retrying on the next start'), expect.any(Error));
    expect(device.getStore()).toEqual(STORE_1_0_14);
    expect(device.getCapabilities()).toEqual(expect.arrayContaining(CAPABILITIES_1_0_14));
    expect(device.removeCapability).not.toHaveBeenCalled();
    expect(driver._devicePollers.has(POLLING_KEY)).toBe(true);
    expect(pollCalls(device)).toHaveLength(1);
    expect(device.getAvailable()).toBe(true);
    expect(device.getCapabilityValue('measure_temperature.hotWater')).toBe(48);
  });

  test('commands still work while the metadata is missing', async () => {
    const { device } = createDevice({ getFeatures: failingRefresh });
    await device.onOAuth2Init();

    await device.__listeners.get('thermostat_mode.heating')('standby');

    expect(device.oAuth2Client.executeCommand).toHaveBeenCalledWith(expect.objectContaining({
      feature: PATHS.HEATING_CIRCUIT_0_MODE, command: 'setMode', body: { mode: 'standby' },
    }));
  });

  test('the refresh is retried on the next start', async () => {
    const first = createDevice({ getFeatures: failingRefresh });
    await first.device.onOAuth2Init();

    const second = restart(first);
    await second.device.onOAuth2Init();

    expect(refreshCalls(second.device)).toHaveLength(1);
    expect(second.device.getStoreValue('heatingCircuitId')).toBe('0');
    expect(second.device.getStoreValue('features')).toEqual([...STORE_1_0_14.features, PATHS.OUTSIDE_TEMP]);
  });

  test('a failing store write is retried on the next start without duplicating features', async () => {
    const first = createDevice();
    const { setStoreValue } = first.device;
    first.device.setStoreValue = jest.fn(async (key, value) => {
      if (key === 'commandMetadata') throw new Error('store is busy');
      return setStoreValue(key, value);
    });
    await first.device.onOAuth2Init();
    expect(first.device.getStoreValue('heatingCircuitId')).toBeUndefined();
    expect(first.driver._devicePollers.has(POLLING_KEY)).toBe(true);

    const second = restart(first);
    await second.device.onOAuth2Init();

    expect(refreshCalls(second.device)).toHaveLength(1);
    expect(second.device.getStoreValue('heatingCircuitId')).toBe('0');
    const features = second.device.getStoreValue('features');
    expect(features).toEqual([...new Set(features)]);
    expect(features).toEqual([...STORE_1_0_14.features, PATHS.OUTSIDE_TEMP]);
  });

  test('an older pairing without a stored feature list keeps its capabilities', async () => {
    const { features, ...store } = STORE_1_0_14;
    const { driver, device } = createDevice({ store: { ...store, version: '1.0.8' }, getFeatures: failingRefresh });

    await expect(device.onOAuth2Init()).resolves.toBeUndefined();

    expect(device.removeCapability).not.toHaveBeenCalled();
    expect(device.getCapabilities()).toEqual(expect.arrayContaining(CAPABILITIES_1_0_14));
    expect(driver._devicePollers.has(POLLING_KEY)).toBe(true);
  });
});

describe('switching the heating circuit', () => {
  test('never shrinks the stored feature list', async () => {
    const { device } = createDevice();
    await device.onOAuth2Init();
    const featuresBefore = device.getStoreValue('features');

    const circuitOneOnly = currentFeatures();
    circuitOneOnly.data = circuitOneOnly.data
      .filter((item) => item.feature !== PATHS.BUFFER_TEMP && item.feature !== PATHS.HOT_WATER_TEMP)
      .map((item) => ({ ...item, feature: item.feature.replace('heating.circuits.0.', 'heating.circuits.1.') }));
    circuitOneOnly.data[0] = feature('heating.circuits', { enabled: { type: 'array', value: ['0', '1'] } });
    device.oAuth2Client.getFeatures.mockImplementation(async () => circuitOneOnly);

    await device.onSettings({ changedKeys: ['heatingCircuit'], newSettings: { heatingCircuit: '1' } });

    expect(device.getStoreValue('heatingCircuitId')).toBe('1');
    expect(device.getStoreValue('features')).toEqual(expect.arrayContaining(featuresBefore));
    expect(device.removeCapability).not.toHaveBeenCalled();
  });
});
