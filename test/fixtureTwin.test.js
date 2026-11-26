/* eslint-env jest */

'use strict';

// The fixture twin's OAuth client (scripts/fixtureTwin/FixtureOAuth2Client.js) with the real
// driver and device: pairing, polling and commands work from a fixture, without the API.

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('./helpers/fakeHomeyOAuth2App'));

const ViessmannDriver = require('../drivers/vicare/driver');
const ViessmannDevice = require('../drivers/vicare/device');
const { PATHS } = require('../drivers/vicare/config');
const { createFixtureClient, applyCommand } = require('../scripts/fixtureTwin/FixtureOAuth2Client');
const { findFixtureDevice } = require('./helpers/fixtureDevices');
const matrix = require('../drivers/vicare/__tests__/capabilityMatrix.json');

// What the client uses of ViessmannOAuth2Client (and homey-oauth2app) besides its API calls
class BaseClient {

  constructor() {
    this.log = jest.fn();
    this.save = jest.fn();
  }

  async onInit() {
    // nothing to set up
  }

  getToken() {
    return this._token;
  }

}

// Never the extended poll
const regularPolls = () => jest.spyOn(Math, 'random').mockReturnValue(0.5);

function fixtureClient(name) {
  const fixture = findFixtureDevice(name);
  const Client = createFixtureClient(BaseClient, fixture);
  return { fixture, client: new Client() };
}

async function pairAndStart(name) {
  regularPolls();
  const { fixture, client } = fixtureClient(name);
  const driver = new ViessmannDriver();
  driver.homey.manifest = { version: '2.0.0' };
  const [paired] = await driver.onPairListDevices({ oAuth2Client: client });
  const device = new ViessmannDevice();
  device.driver = driver;
  device.__store = paired.store;
  device.__data = paired.data;
  device.__settings = { heatingCircuit: 'auto' };
  device.oAuth2Client = client;
  device.homey = { __: (key) => key };
  await device.onOAuth2Init();
  await driver._stopPolling(device.getPollingKey());
  jest.restoreAllMocks();
  return {
    fixture, client, driver, device, paired,
  };
}

test('any user name and password log in, and the token refreshes locally', async () => {
  const { client } = fixtureClient('vitodens_200_e3');

  await expect(client.onGetTokenByCredentials({ username: 'x', password: 'y' })).resolves.toMatchObject({ access_token: 'fixture-mode' });
  await expect(client.onRefreshToken()).resolves.toMatchObject({ refresh_token: 'fixture-mode' });
  expect(client.save).toHaveBeenCalled();
  await expect(client.onGetTokenByCode({ code: 'any' })).resolves.toMatchObject({ access_token: 'fixture-mode' });
});

test('features are answered like the API: filtered, without disabled features, with fresh timestamps', async () => {
  const { fixture, client } = fixtureClient('vitocal_222');
  const disabled = fixture.features.data.find((feature) => feature.isEnabled === false);

  const all = await client.getFeatures({});
  const filtered = await client.getFeatures({ filter: `${PATHS.OUTSIDE_TEMP},${PATHS.HOT_WATER_TEMP}` });

  expect(all.data.length).toBe(fixture.features.data.filter((feature) => feature.isEnabled !== false).length);
  if (disabled) expect(all.data.map((feature) => feature.feature)).not.toContain(disabled.feature);
  expect(filtered.data.map((feature) => feature.feature).sort()).toEqual([PATHS.HOT_WATER_TEMP, PATHS.OUTSIDE_TEMP].sort());
  expect(Date.now() - Date.parse(filtered.data[0].timestamp)).toBeLessThan(60000);
  await expect(client.getFeature({ featureName: PATHS.OUTSIDE_TEMP })).resolves.toMatchObject({ data: { feature: PATHS.OUTSIDE_TEMP } });
  await expect(client.getFeature({ featureName: 'no.such.feature' })).rejects.toThrow(/no feature/);
});

describe.each(['vitocal_222', 'vitodens_200_e3', 'vitovalor_pt2', 'pyvicare/Vitocal250A_TwoCircuits'])('%s', (name) => {
  test('pairs and starts with the capabilities of the capability matrix', async () => {
    const { device, paired, fixture } = await pairAndStart(name);

    expect(paired.data.id).toBe(`${fixture.identity.installationId}-${fixture.identity.gatewaySerial}-${fixture.identity.deviceId}`);
    expect(device.getCapabilities()).toEqual(matrix.devices[name].capabilities);
    expect(device.getAvailable()).toBe(true);
    expect(device.setLastSeenAt).toHaveBeenCalled();
  });
});

test('commands change the values the next poll reads', async () => {
  const { device, driver, client } = await pairAndStart('vitocal_222');
  const poll = async () => device.onFeaturesUpdated(await device.getFeatures({ useFilter: true }), false);

  await device.__listeners.get('target_temperature.hotWater')(48);
  await device.__listeners.get('thermostat_mode.heating')('standby');
  await device.__listeners.get('thermostat_mode.hotWaterOneTimeCharge')('activate');
  // Values the device shows now come from the next poll, not from the command
  device.__values.set('target_temperature.hotWater', null);
  device.__values.set('thermostat_mode.heating', null);
  device.__values.set('thermostat_mode.hotWaterOneTimeCharge', null);
  await poll();

  expect(device.getCapabilityValue('target_temperature.hotWater')).toBe(48);
  expect(device.getCapabilityValue('thermostat_mode.heating')).toBe('standby');
  expect(device.getCapabilityValue('thermostat_mode.hotWaterOneTimeCharge')).toBe('activate');
  expect(client.log).toHaveBeenCalledWith(`Fixture mode: ${PATHS.HOT_WATER_TARGET} setTargetTemperature`, { temperature: 48 });
  expect(driver.homey.setTimeout).toHaveBeenCalled();
});

test('a command the fixture does not offer is refused', async () => {
  const { client } = fixtureClient('vitocal_222');
  await expect(client.executeCommand({ feature: PATHS.OUTSIDE_TEMP, command: 'setTemperature', body: {} }))
    .rejects.toThrow(/not available/);
});

test('applyCommand writes the parameter\'s property, the set point or the value', () => {
  const feature = { properties: { temperature: { value: 20 }, active: { value: true } } };
  applyCommand(feature, 'setTemperature', { targetTemperature: 21 });
  expect(feature.properties.temperature.value).toBe(21);

  const hysteresis = { properties: { value: { value: 5 }, switchOnValue: { value: 3 } } };
  applyCommand(hysteresis, 'setHysteresisSwitchOnValue', { switchOnValue: 4 });
  expect(hysteresis.properties).toEqual({ value: { value: 5 }, switchOnValue: { value: 4 } });

  const charge = {};
  applyCommand(charge, 'deactivate', {});
  expect(charge.properties.active).toEqual({ type: 'boolean', value: false });
});
