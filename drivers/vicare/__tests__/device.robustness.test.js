/* eslint-env jest */

'use strict';

// A response in which some entries or values are null or garbage: every other value is still
// applied, the device stays available and polling goes on.

const fs = require('fs');
const path = require('path');

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const ViessmannDriver = require('../driver');
const ViessmannDevice = require('../device');
const { PATHS } = require('../config');
const { detectHeatingCircuit } = require('../heatingCircuit');

const FIXTURES_DIR = path.join(__dirname, '../../../test/fixtures');
const HEAT_PUMP = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'vitocal_222_features.json'), 'utf8'));
const HEAT_PUMP_ROLES = ['type:heating;integrated', 'type:dhw;integrated', 'type:heatpump'];
const clone = (value) => JSON.parse(JSON.stringify(value));

const OUTSIDE = 'measure_temperature.outside';
const HOT_WATER = 'measure_temperature.hotWater';
const RETURN = 'measure_temperature.return';
const COMPRESSOR = 'measure_compressor_active';
const COP = 'measure_cop_number.total';
const MODE = 'thermostat_mode.heating';
const CORRUPTED = [OUTSIDE, HOT_WATER, RETURN, COMPRESSOR, COP, MODE];

// The value of every capability before the update, so that "kept" and "set" can be told apart
const PREVIOUS = {
  [OUTSIDE]: 1.5, [HOT_WATER]: 40, [RETURN]: 20, [COMPRESSOR]: false, [COP]: 2, [MODE]: 'standby',
};

/*
  The heat pump fixture with odd entries and values, the way an API response could look after a
  change on Viessmann's side. Values that JSON cannot carry (NaN, Infinity) are set in code.
*/
function corruptedResponse() {
  const response = clone(HEAT_PUMP);
  const item = (name) => response.data.find((entry) => entry.feature === name);
  item(PATHS.OUTSIDE_TEMP).properties.value.value = null;
  item(PATHS.HOT_WATER_TEMP).properties.value.value = { nested: 49.4 };
  item(PATHS.RETURN_TEMP).properties.value.value = 'garbage';
  item(PATHS.COMPRESSOR).properties.active.value = NaN;
  item(PATHS.COP_TOTAL).properties.value.value = Infinity;
  item(PATHS.HEATING_CIRCUIT_0_MODE).properties.value.value = 42;
  item(PATHS.HEATING_CIRCUIT_0_MODE).commands = null;
  item(PATHS.HOT_WATER_TARGET).commands = 'garbage';
  item(PATHS.COMPRESSOR_STATS).properties.hours = null;
  response.data.push(null, 42, 'garbage', {}, { feature: 7, isEnabled: true }, { feature: null, isEnabled: true, properties: {} });
  return response;
}

/*
  Homey refuses a value of the wrong type for a capability. The fake does not, so this
  device does it for the types used here.
*/
function rejectWrongTypes(device) {
  const set = device.setCapabilityValue.getMockImplementation();
  device.setCapabilityValue.mockImplementation(async (id, value) => {
    const valid = value === null
      || (id === MODE ? typeof value === 'string' : ['number', 'boolean'].includes(typeof value));
    if (!valid) throw new Error(`invalid_type: ${id}`);
    return set(id, value);
  });
}

async function heatPump(values = PREVIOUS) {
  const device = new ViessmannDevice();
  device.driver = { getTriggerCard: jest.fn(() => null) };
  device._roles = HEAT_PUMP_ROLES;
  device._features = Object.values(PATHS);
  device._heatingCircuitId = '0';
  await device.initializeCapabilities();
  for (const [id, value] of Object.entries(values)) device.__values.set(id, value);
  rejectWrongTypes(device);
  return device;
}

describe('a response with null and garbage values', () => {
  test('is applied except for the odd values, and the device stays available', async () => {
    const reference = await heatPump({});
    await reference.onFeaturesUpdated(clone(HEAT_PUMP), false);
    const device = await heatPump();

    await expect(device.onFeaturesUpdated(corruptedResponse(), false)).resolves.toBeUndefined();

    expect(device.setUnavailable).not.toHaveBeenCalled();
    expect(device.getAvailable()).toBe(true);
    // Every capability the corruption did not touch got its value from the response
    const untouched = reference.getCapabilities()
      .filter((id) => !CORRUPTED.includes(id) && id !== 'measure_compressor_number.compressorHours');
    expect(untouched.length).toBeGreaterThan(10);
    for (const id of untouched) {
      expect([id, device.getCapabilityValue(id)]).toEqual([id, reference.getCapabilityValue(id)]);
    }
  });

  test('null means unknown; values of the wrong kind leave the last value in place', async () => {
    const device = await heatPump();

    await device.onFeaturesUpdated(corruptedResponse(), false);

    expect(device.getCapabilityValue(OUTSIDE)).toBeNull();
    // An object, NaN or Infinity is no value at all
    expect(device.getCapabilityValue(HOT_WATER)).toBe(PREVIOUS[HOT_WATER]);
    expect(device.getCapabilityValue(COMPRESSOR)).toBe(PREVIOUS[COMPRESSOR]);
    expect(device.getCapabilityValue(COP)).toBe(PREVIOUS[COP]);
    // Homey refuses a string for a temperature and a number for the mode; the error is logged
    expect(device.getCapabilityValue(RETURN)).toBe(PREVIOUS[RETURN]);
    expect(device.getCapabilityValue(MODE)).toBe(PREVIOUS[MODE]);
    expect(device.error).toHaveBeenCalledWith(`Failed to set capability ${RETURN}:`, expect.any(Error));
    expect(device.error).toHaveBeenCalledWith(`Failed to set capability ${MODE}:`, expect.any(Error));
    // The statistics feature still gives its other value
    expect(device.getCapabilityValue('measure_compressor_number.compressorStarts')).toBe(18067);
  });

  test('command metadata that is no object is not taken over', async () => {
    const device = await heatPump();
    device._commands = { [PATHS.HOT_WATER_TARGET]: { setTargetTemperature: { isExecutable: true } } };

    await device.onFeaturesUpdated(corruptedResponse(), false);

    expect(device._commands[PATHS.HOT_WATER_TARGET]).toEqual({ setTargetTemperature: { isExecutable: true } });
    expect(device._commands[PATHS.HEATING_CIRCUIT_0_MODE]).toBeUndefined();
  });

  test('an extended poll stores only real feature names', async () => {
    const device = await heatPump();
    device._features = [PATHS.OUTSIDE_TEMP];

    await device.onFeaturesUpdated(corruptedResponse(), true);

    const stored = device.getStoreValue('features');
    expect(stored.length).toBeGreaterThan(10);
    expect(stored.every((name) => typeof name === 'string' && name !== '')).toBe(true);
    expect(device.setUnavailable).not.toHaveBeenCalled();
  });

  test('a response without a feature list still counts as a failed update', async () => {
    const device = await heatPump();

    await device.onFeaturesUpdated({ data: 'garbage' }, false);

    expect(device.setUnavailable).toHaveBeenCalledTimes(1);
    expect(device.getCapabilityValue(OUTSIDE)).toBe(PREVIOUS[OUTSIDE]);
  });
});

describe('polling goes on', () => {
  test('through responses with odd values, and the next normal response is applied', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    const driver = new ViessmannDriver();
    const device = await heatPump();
    device.driver = driver;
    device.getAvailable = jest.fn(() => true);
    device.oAuth2Client = {
      getFeatures: jest.fn()
        .mockResolvedValueOnce(corruptedResponse())
        .mockResolvedValueOnce(corruptedResponse())
        .mockResolvedValue(clone(HEAT_PUMP)),
    };
    const key = device.getPollingKey();

    await driver._startPolling(device, key);
    const poller = driver._devicePollers.get(key);
    for (let poll = 0; poll < 2; poll++) {
      const timers = driver.homey.setTimeout.mock.calls.filter(([, ms]) => ms >= 120000);
      timers[timers.length - 1][0]();
      while (poller.running) await poller.running;
    }

    expect(device.oAuth2Client.getFeatures).toHaveBeenCalledTimes(3);
    expect(poller.failures).toBe(0);
    expect(device.setUnavailable).not.toHaveBeenCalled();
    expect(device.getCapabilityValue(OUTSIDE)).toBe(-3.2);
    expect(device.getCapabilityValue(HOT_WATER)).toBe(49.4);
    jest.restoreAllMocks();
  });
});

describe('adding a device whose response has odd entries', () => {
  test('reads the metadata of the real features', () => {
    const response = corruptedResponse();
    response.data.find((entry) => entry.feature === PATHS.HOT_WATER_TARGET).commands = {
      broken: null, setTargetTemperature: { params: { temperature: null, other: { constraints: { min: 10 } } } },
    };

    const metadata = new ViessmannDriver()._readDeviceMetadata(response);

    expect(metadata.heatingCircuitId).toBe('0');
    expect(metadata.features).toContain(PATHS.OUTSIDE_TEMP);
    expect(metadata.features.every((name) => typeof name === 'string')).toBe(true);
    expect(metadata.constraints[PATHS.HOT_WATER_TARGET]).toEqual({ other: { min: 10 } });
    expect(metadata.commandMetadata[PATHS.HEATING_CIRCUIT_0_MODE]).toBeUndefined();
  });

  test.each([
    ['null entries', [null, { feature: 'heating.circuits', isEnabled: true, properties: { enabled: { value: ['1'] } } }], '1'],
    ['no list', undefined, '0'],
    ['a list of garbage', [42, 'x', { feature: 3 }], '0'],
  ])('detects the heating circuit with %s', (_, data, expected) => {
    expect(detectHeatingCircuit(data)).toBe(expected);
  });
});

describe('last seen', () => {
  const pairedDevice = () => {
    const device = new ViessmannDevice();
    device._features = new ViessmannDriver()._readDeviceMetadata(clone(HEAT_PUMP)).features;
    device._roles = HEAT_PUMP_ROLES;
    device._heatingCircuitId = '0';
    device.driver = { getTriggerCard: jest.fn(() => ({ trigger: jest.fn(async () => {}) })) };
    return device;
  };

  test('every successful update tells Homey the device was seen', async () => {
    const device = pairedDevice();

    await device.onFeaturesUpdated(clone(HEAT_PUMP), false);
    await device.onFeaturesUpdated(clone(HEAT_PUMP), false);

    expect(device.setLastSeenAt).toHaveBeenCalledTimes(2);
  });

  test('a response that is no feature list does not', async () => {
    const device = pairedDevice();

    await device.onFeaturesUpdated({ error: 'garbage' }, false);

    expect(device.setUnavailable).toHaveBeenCalled();
    expect(device.setLastSeenAt).not.toHaveBeenCalled();
  });

  test('a rejected setLastSeenAt is logged, and the device stays available', async () => {
    const device = pairedDevice();
    device.setLastSeenAt.mockRejectedValue(new Error('device_not_found'));

    await device.onFeaturesUpdated(clone(HEAT_PUMP), false);

    expect(device.error).toHaveBeenCalledWith('Could not set the last seen time:', expect.any(Error));
    expect(device.setUnavailable).not.toHaveBeenCalled();
  });
});
