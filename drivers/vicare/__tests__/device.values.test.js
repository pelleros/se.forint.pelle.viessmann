/* eslint-env jest */

'use strict';

// How polled values reach the capabilities: fallback feature paths, and values of features that
// are no longer reported (notConnected, disabled or missing from the response).

const fs = require('fs');
const path = require('path');

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const ViessmannDriver = require('../driver');
const ViessmannDevice = require('../device');
const { PATHS } = require('../config');

const FIXTURES_DIR = path.join(__dirname, '../../../test/fixtures');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));

// Vitocal 222: in 2024 both buffer sensors are connected, in 2026 only the top one is
const HEAT_PUMP = fixture('vitocal_222_features.json');
const HEAT_PUMP_2024 = fixture('vitocal_222_2024_features.json');
const HEAT_PUMP_ROLES = ['type:heating;integrated', 'type:dhw;integrated', 'type:heatpump'];
const BUFFER = 'measure_temperature.buffer';

const feature = (dump, name) => clone(dump.data.find((item) => item.feature === name));
const withValue = (item, value) => ({ ...item, properties: { ...item.properties, value: { ...item.properties.value, value } } });
const notConnected = (name) => ({ feature: name, isEnabled: true, properties: { status: { type: 'string', value: 'notConnected' } } });

// Returns only the requested features, like the API does for ?filter=
function respond(dump, filter) {
  if (filter === undefined) return clone(dump);
  const requested = filter.split(',');
  return { ...clone(dump), data: dump.data.filter((item) => requested.includes(item.feature)).map(clone) };
}

/*
  A device with the capabilities of `features`, the given current values and a
  heating-mode-changed trigger card that records its calls.
*/
async function deviceWith(features, values = {}, roles = HEAT_PUMP_ROLES) {
  const modeChanged = { trigger: jest.fn(async () => {}) };
  const device = new ViessmannDevice();
  device.driver = {
    triggerCapabilityChange: jest.fn(async (target, id, value) => {
      if (id === 'thermostat_mode.heating') await modeChanged.trigger(target, { mode: value }, {});
    }),
  };
  device._roles = roles;
  device._features = features;
  await device.initializeCapabilities();
  for (const [id, value] of Object.entries(values)) device.__values.set(id, value);
  device.setCapabilityValue.mockClear();
  return { device, modeChanged };
}

describe('buffer temperature', () => {
  test('reads the top sensor when the main sensor is notConnected', async () => {
    const { device } = await deviceWith([PATHS.BUFFER_TEMP], { [BUFFER]: 55.1 });

    await device.onFeaturesUpdated(HEAT_PUMP, false);

    expect(device.getCapabilityValue(BUFFER)).toBe(34.5);
    // Replaced directly, without a gap in Insights
    expect(device.setCapabilityValue).not.toHaveBeenCalledWith(BUFFER, null);
  });

  test('the order of the features in the response does not matter', async () => {
    const { device } = await deviceWith([PATHS.BUFFER_TEMP], { [BUFFER]: 55.1 });

    await device.onFeaturesUpdated({ ...HEAT_PUMP, data: [...HEAT_PUMP.data].reverse() }, false);

    expect(device.getCapabilityValue(BUFFER)).toBe(34.5);
  });

  test.each([
    ['main first', false],
    ['top first', true],
  ])('prefers the main sensor when both report a value (%s)', async (_, reversed) => {
    const { device } = await deviceWith([PATHS.BUFFER_TEMP, PATHS.BUFFER_TEMP_TOP]);
    const data = [
      withValue(feature(HEAT_PUMP_2024, PATHS.BUFFER_TEMP), 40),
      withValue(feature(HEAT_PUMP_2024, PATHS.BUFFER_TEMP_TOP), 27.3),
    ];

    await device.onFeaturesUpdated({ data: reversed ? data.reverse() : data }, false);

    expect(device.getCapabilityValue(BUFFER)).toBe(40);
    expect(device.setCapabilityValue).not.toHaveBeenCalledWith(BUFFER, 27.3);
  });

  test('reads the top sensor when the main sensor is not reported at all', async () => {
    const { device } = await deviceWith([PATHS.BUFFER_TEMP]);
    const data = HEAT_PUMP.data.filter((item) => item.feature !== PATHS.BUFFER_TEMP);

    await device.onFeaturesUpdated({ data }, false);

    expect(device.getCapabilityValue(BUFFER)).toBe(34.5);
  });

  test('a device paired when only the top sensor is connected gets the capability and polls both sensors', async () => {
    const driver = new ViessmannDriver();
    const metadata = driver._readDeviceMetadata(clone(HEAT_PUMP));
    expect(metadata.features).toContain(PATHS.BUFFER_TEMP_TOP);
    expect(metadata.features).not.toContain(PATHS.BUFFER_TEMP);

    const device = new ViessmannDevice();
    device.driver = driver;
    device.__store = {
      installationId: 1, gatewaySerial: 'gateway', deviceId: '0', roles: HEAT_PUMP_ROLES, version: '1.0.15', ...metadata,
    };
    device.oAuth2Client = { getFeatures: jest.fn(async ({ filter }) => respond(HEAT_PUMP, filter)) };
    jest.spyOn(Math, 'random').mockReturnValue(0.5); // a regular (filtered) poll

    try {
      await device.onOAuth2Init();
    } finally {
      jest.restoreAllMocks();
    }

    expect(device.hasCapability(BUFFER)).toBe(true);
    expect(device.getCapabilityValue(BUFFER)).toBe(34.5);
    // One request per poll, with both sensors in its filter
    expect(device.oAuth2Client.getFeatures).toHaveBeenCalledTimes(1);
    const requested = device.oAuth2Client.getFeatures.mock.calls[0][0].filter.split(',');
    expect(requested).toEqual(expect.arrayContaining([PATHS.BUFFER_TEMP, PATHS.BUFFER_TEMP_TOP]));
  });
});

describe('values of features that are no longer reported', () => {
  test('notConnected without a fallback: the value is cleared and the capability stays', async () => {
    const { device } = await deviceWith([PATHS.BUFFER_TEMP], { [BUFFER]: 55.1 });

    await device.onFeaturesUpdated({ data: [notConnected(PATHS.BUFFER_TEMP), notConnected(PATHS.BUFFER_TEMP_TOP)] }, false);

    expect(device.hasCapability(BUFFER)).toBe(true);
    expect(device.getCapabilityValue(BUFFER)).toBeNull();
    expect(device.removeCapability).not.toHaveBeenCalled();
    expect(device.getAvailable()).toBe(true);
  });

  test('a disabled feature is cleared', async () => {
    const { device } = await deviceWith([PATHS.OUTSIDE_TEMP], { 'measure_temperature.outside': 4.2 });
    const outside = { ...feature(HEAT_PUMP, PATHS.OUTSIDE_TEMP), isEnabled: false };

    await device.onFeaturesUpdated({ data: [outside] }, false);

    expect(device.getCapabilityValue('measure_temperature.outside')).toBeNull();
  });

  test('a feature missing from the response is cleared without firing its trigger card', async () => {
    const { device, modeChanged } = await deviceWith(
      [PATHS.HEATING_CIRCUIT_0_MODE, PATHS.OUTSIDE_TEMP],
      { 'thermostat_mode.heating': 'dhwAndHeating', 'measure_temperature.outside': 4.2 },
    );
    const data = HEAT_PUMP.data.filter((item) => item.feature !== PATHS.HEATING_CIRCUIT_0_MODE);

    await device.onFeaturesUpdated({ data }, false);

    expect(device.getCapabilityValue('thermostat_mode.heating')).toBeNull();
    expect(device.getCapabilityValue('measure_temperature.outside')).toBe(feature(HEAT_PUMP, PATHS.OUTSIDE_TEMP).properties.value.value);
    expect(modeChanged.trigger).not.toHaveBeenCalled();
  });

  test('a value that comes back fires the trigger card again', async () => {
    const { device, modeChanged } = await deviceWith([PATHS.HEATING_CIRCUIT_0_MODE], { 'thermostat_mode.heating': 'dhwAndHeating' });
    const data = HEAT_PUMP.data.filter((item) => item.feature !== PATHS.HEATING_CIRCUIT_0_MODE);

    await device.onFeaturesUpdated({ data }, false);
    await device.onFeaturesUpdated(HEAT_PUMP, false);

    const mode = feature(HEAT_PUMP, PATHS.HEATING_CIRCUIT_0_MODE).properties.value.value;
    expect(device.getCapabilityValue('thermostat_mode.heating')).toBe(mode);
    expect(modeChanged.trigger).toHaveBeenCalledTimes(1);
    expect(modeChanged.trigger).toHaveBeenCalledWith(device, { mode }, {});
  });

  test('a cleared value is written and logged once', async () => {
    const { device } = await deviceWith([PATHS.BUFFER_TEMP], { [BUFFER]: 55.1 });
    const response = { data: [notConnected(PATHS.BUFFER_TEMP), feature(HEAT_PUMP, PATHS.OUTSIDE_TEMP)] };

    await device.onFeaturesUpdated(response, false);
    await device.onFeaturesUpdated(response, false);

    expect(device.setCapabilityValue.mock.calls.filter(([id]) => id === BUFFER)).toEqual([[BUFFER, null]]);
    expect(device.log.mock.calls.filter(([message]) => String(message).includes(BUFFER))).toHaveLength(1);
  });

  test('an empty response clears nothing', async () => {
    const { device } = await deviceWith([PATHS.BUFFER_TEMP, PATHS.OUTSIDE_TEMP], { [BUFFER]: 55.1, 'measure_temperature.outside': 4.2 });

    await device.onFeaturesUpdated({ data: [] }, false);

    expect(device.setCapabilityValue).not.toHaveBeenCalled();
  });

  test('a connected feature without the expected property keeps the value', async () => {
    const { device } = await deviceWith([PATHS.OUTSIDE_TEMP], { 'measure_temperature.outside': 4.2 });
    const outside = { feature: PATHS.OUTSIDE_TEMP, isEnabled: true, properties: { status: { type: 'string', value: 'connected' } } };

    await device.onFeaturesUpdated({ data: [outside] }, false);

    expect(device.getCapabilityValue('measure_temperature.outside')).toBe(4.2);
  });
});

describe('COP and compressor load', () => {
  const COP = ['measure_cop_number.total', 'measure_cop_number.heating', 'measure_cop_number.dhw'];
  const LOAD = 'measure_compressor_number.compressorModulation';
  const pairedFeatures = (dump) => new ViessmannDriver()._readDeviceMetadata(clone(dump)).features;

  test('a heat pump that reports them gets the capabilities and their values', async () => {
    const { device } = await deviceWith(pairedFeatures(HEAT_PUMP));

    await device.onFeaturesUpdated(HEAT_PUMP, false);

    expect(COP.map((id) => device.getCapabilityValue(id))).toEqual([3.3, 3.4, 3]);
    expect(device.getCapabilityValue(LOAD)).toBe(42);
    expect(COP.map((id) => device.__options.get(id).title.en)).toEqual(['COP total', 'COP heating', 'COP hot water']);
    expect(device.__options.get(LOAD)).toMatchObject({ title: { en: 'Compressor load' }, units: '%' });
  });

  test.each([
    ['vitocal_222_2024_features.json', HEAT_PUMP_ROLES],
    ['vitodens_200_2016_features.json', ['type:boiler']],
    ['vitodens_200_e3_features.json', ['type:boiler']],
    ['vitodens_200_dh_features.json', ['type:boiler']],
    ['vitovalor_pt2_features.json', ['type:boiler']],
  ])('an installation that does not report them does not get them (%s)', async (name, roles) => {
    const dump = fixture(name);
    const { device } = await deviceWith(pairedFeatures(dump), {}, roles);

    await device.onFeaturesUpdated(dump, false);

    expect(device.getCapabilities().filter((id) => COP.includes(id) || id === LOAD)).toEqual([]);
  });

  test('compressor load needs the heat pump role, COP does not', async () => {
    const { device } = await deviceWith(pairedFeatures(HEAT_PUMP), {}, ['type:boiler']);

    expect(device.hasCapability(LOAD)).toBe(false);
    expect(COP.every((id) => device.hasCapability(id))).toBe(true);
  });
});
