/* eslint-env jest */

'use strict';

// Pairing reads the real ids from getInstallations (the troubleshooting Web API anonymizes its
// own copy). The data.id it produces is frozen: it identifies the device for existing users. The
// expected ids below are what pairing produced for each fixture installation before the
// troubleshooting data was anonymized. New devices are named after their model (or what they
// are, for model ids that are no product name); existing devices keep their names.

const fs = require('fs');
const path = require('path');

jest.mock('homey-oauth2app', () => {
  // eslint-disable-next-line global-require
  const fake = require('../../../test/helpers/fakeHomeyOAuth2App');
  return {
    ...fake,
    OAuth2Client: class {

      log() {}

      error() {}

    },
  };
});

const Driver = require('../driver');
const Client = require('../../../lib/ViessmannOAuth2Client');

const FIXTURES_DIR = path.join(__dirname, '../../../test/fixtures');
const readFixture = (file) => JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));

const EXPECTED = {
  vitocal_222: [{ name: 'Viessmann heat pump', data: { id: '900001-9999000000000001-0' } }],
  vitodens_200_2016: [{ name: 'Viessmann boiler', data: { id: '900003-9999000000000006-0' } }],
  vitodens_200_dh: [{ name: 'Viessmann Vitodens 200', data: { id: '900004-9999000000000009-0' } }],
  vitodens_200_e3: [{ name: 'Viessmann Vitodens 200', data: { id: '900002-9999000000000004-0' } }],
  vitovalor_pt2: [{ name: 'Viessmann Vitovalor PT2', data: { id: '900005-9999000000000011-0' } }],
};

function newDriver() {
  const driver = new Driver();
  driver.log = jest.fn();
  driver.error = jest.fn();
  driver.homey = { manifest: { version: '1.2.3' } };
  return driver;
}

function installationsResponse(name) {
  const fixture = readFixture(`${name}_installations.json`);
  return Array.isArray(fixture) ? { data: fixture } : fixture;
}

test('every installations fixture has an expected pairing result', () => {
  const names = fs.readdirSync(FIXTURES_DIR).filter((file) => file.endsWith('_installations.json')).map((file) => file.replace('_installations.json', ''));
  expect(names.sort()).toEqual(Object.keys(EXPECTED).sort());
});

test.each(Object.keys(EXPECTED))('pairing %s yields the same device names and data ids', async (name) => {
  const installations = installationsResponse(name);
  const client = {
    getInstallations: jest.fn(async () => clone(installations)),
    getFeatures: jest.fn(async () => readFixture(`${name}_features.json`)),
  };
  const paired = await newDriver().onPairListDevices({ oAuth2Client: client });

  expect(paired.map(({ name: deviceName, data }) => ({ name: deviceName, data }))).toEqual(EXPECTED[name]);
  const gateway = installations.data.flatMap((installation) => installation.gateways)
    .find((candidate) => candidate.devices.some((device) => device.deviceType === 'heating'));
  expect(paired[0].store).toMatchObject({ installationId: gateway.installationId, gatewaySerial: gateway.serial, deviceId: '0' });
  expect(client.getFeatures).toHaveBeenCalledWith({ installationId: gateway.installationId, gatewaySerial: gateway.serial, deviceId: '0' });
});

describe('with a realistic installations response', () => {
  const INSTALLATION_ID = 2345678;
  const GATEWAY_SERIAL = '7637415022052208';
  const BOILER_SERIAL = '7723181102328103';
  const PERSONAL = ['Example Street', 'Example City', 'Holiday home', 'someone@example.com'];

  function apiResponse() {
    return {
      data: [{
        id: INSTALLATION_ID,
        description: 'Holiday home',
        address: { street: 'Example Street', houseNumber: '12', city: 'Example City' },
        buildingEmail: 'someone@example.com',
        gateways: [{
          serial: GATEWAY_SERIAL,
          installationId: INSTALLATION_ID,
          gatewayType: 'VitoconnectOptolink',
          devices: [
            {
              gatewaySerial: GATEWAY_SERIAL, id: '0', boilerSerial: BOILER_SERIAL, deviceType: 'heating', modelId: 'E3_Vitodens_200_0821', roles: ['type:boiler'],
            },
            {
              gatewaySerial: GATEWAY_SERIAL, id: 'RoomControl-1', deviceType: 'roomControl', modelId: 'E3_RoomControl_One_19_03', roles: [],
            },
          ],
        }],
      }],
    };
  }

  test('the OAuth client returns the installations as the API sends them', async () => {
    const client = new Client();
    client.get = jest.fn(async () => apiResponse());
    await expect(client.getInstallations()).resolves.toEqual(apiResponse());
    expect(client.get).toHaveBeenCalledWith({ path: '/equipment/installations?includeGateways=true' });
  });

  test('pairing uses the real ids and logs only a summary', async () => {
    const driver = newDriver();
    const client = {
      getInstallations: jest.fn(async () => apiResponse()),
      getFeatures: jest.fn(async () => ({ data: [] })),
    };
    const paired = await driver.onPairListDevices({ oAuth2Client: client });

    expect(paired).toHaveLength(1);
    expect(paired[0].name).toBe('Viessmann Vitodens 200');
    expect(paired[0].data).toEqual({ id: `${INSTALLATION_ID}-${GATEWAY_SERIAL}-0` });

    const logged = JSON.stringify(driver.log.mock.calls);
    for (const value of [String(INSTALLATION_ID), GATEWAY_SERIAL, BOILER_SERIAL, ...PERSONAL]) {
      expect(logged).not.toContain(value);
    }
    expect(driver.log).toHaveBeenCalledWith(
      '[ViessmannDriver::onPairListDevices] Found',
      '1 installation(s), 1 gateway(s): VitoconnectOptolink, 2 device(s): heating E3_Vitodens_200_0821, roomControl E3_RoomControl_One_19_03',
    );
  });
});
