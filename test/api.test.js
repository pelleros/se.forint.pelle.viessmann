'use strict';

// The report for the developer (api.js → /report, lib/report.js) must never hand out real
// identifiers or personal data: users send it in diagnostic reports and paste it into forum posts
// and e-mails. Both the full report and the summary lines it writes to the app's log are checked.

const fs = require('fs');
const path = require('path');
const api = require('../api');
const { FAKE_PATTERNS, PLACEHOLDER_PATTERNS, REDACTED } = require('../lib/anonymize');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const readFixture = (file) => JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));

// Synthetic "raw" identifiers. They only need to look like the real formats.
const INSTALLATION_ID = 2345678;
const GATEWAY_SERIAL = '7637415022052208';
const BOILER_SERIAL = '7723181102328103';
const BMU_SERIAL = '7710468800114203';
const CONTROLLER_SERIAL = '7730217201551100';
const MATERIAL_NUMBER = '7620123';
const ZIGBEE_ID = 'zigbee-04cd15fffe0a1b2c';
const TIMESTAMP = '2026-11-20T13:47:36.569Z';
const BASE = `https://api.viessmann-climatesolutions.com/iot/v2/features/installations/${INSTALLATION_ID}/gateways/${GATEWAY_SERIAL}/devices/0/features`;
const PERSONAL = ['Example Street', 'Example City', '12345', 'Holiday home', 'Villa Example', 'someone@example.com', '+46 70', 'Some Installer Ltd', 'Upstairs'];
const ORIGINALS = [String(INSTALLATION_ID), GATEWAY_SERIAL, BOILER_SERIAL, BMU_SERIAL, CONTROLLER_SERIAL, MATERIAL_NUMBER, ZIGBEE_ID, ...PERSONAL];

function rawInstallations() {
  return {
    data: [{
      id: INSTALLATION_ID,
      description: 'Holiday home',
      address: {
        street: 'Example Street', houseNumber: '12', zip: '12345', city: 'Example City', geolocation: { latitude: 57.1, longitude: 11.9, timeZone: 'Europe/Stockholm' },
      },
      buildingName: 'Villa Example',
      buildingEmail: 'someone@example.com',
      buildingPhone: '+46 70 000 00 00',
      servicedBy: 'Some Installer Ltd',
      registeredAt: TIMESTAMP,
      gateways: [{
        serial: GATEWAY_SERIAL,
        installationId: INSTALLATION_ID,
        gatewayType: 'VitoconnectOptolink',
        version: '2.8.0.0',
        description: 'Basement',
        devices: [
          {
            gatewaySerial: GATEWAY_SERIAL,
            id: '0',
            boilerSerial: BOILER_SERIAL,
            bmuSerial: BMU_SERIAL,
            materialNumber: MATERIAL_NUMBER,
            deviceType: 'heating',
            modelId: 'E3_Vitodens_200_0821',
            roles: ['type:boiler'],
          },
          {
            gatewaySerial: GATEWAY_SERIAL, id: 'RoomControl-1', deviceType: 'roomControl', modelId: 'E3_RoomControl_One_19_03', roles: ['type:virtual;smartRoomControl'],
          },
          {
            gatewaySerial: GATEWAY_SERIAL, id: ZIGBEE_ID, deviceType: 'zigbee', modelId: 'E3_RadiatorActuator', roles: ['type:radiator'],
          },
        ],
      }],
    }],
  };
}

function feature(name, properties, commands = {}) {
  return {
    feature: name, gatewayId: GATEWAY_SERIAL, deviceId: '0', timestamp: TIMESTAMP, isEnabled: true, isReady: true, apiVersion: 1, uri: `${BASE}/${name}`, properties, commands,
  };
}

function rawFeatures() {
  return {
    data: [
      feature('heating.dhw.temperature.main', { value: { type: 'number', value: 50, unit: 'celsius' } }, {
        setTargetTemperature: {
          uri: `${BASE}/heating.dhw.temperature.main/commands/setTargetTemperature`,
          name: 'setTargetTemperature',
          isExecutable: true,
          params: { temperature: { type: 'number', required: true, constraints: { min: 10, max: 60, stepping: 1 } } },
        },
      }),
      feature('heating.boiler.serial', { value: { type: 'string', value: BOILER_SERIAL } }),
      feature('heating.controller.serial', { value: { type: 'string', value: CONTROLLER_SERIAL } }),
      feature('heating.circuits.0.name', { name: { type: 'string', value: 'Upstairs' } }),
      feature('heating.circuits.0.remoteController', {}, {
        setZigbeeController: {
          uri: `${BASE}/heating.circuits.0.remoteController/commands/setZigbeeController`,
          name: 'setZigbeeController',
          isExecutable: true,
          params: { deviceId: { type: 'string', required: true, constraints: { enum: [ZIGBEE_ID] } } },
        },
      }),
    ],
  };
}

// A Homey whose saved login sees these installations; every heating device reports `features`
function fakeHomey({ installations, features }) {
  const heatingIds = installations.data.flatMap((installation) => installation.gateways
    .flatMap((gateway) => gateway.devices.filter((device) => device.deviceType === 'heating').map((device) => device.id)));
  const client = {
    getInstallations: jest.fn(async () => clone(installations)),
    getFeatures: jest.fn(async ({ deviceId }) => (heatingIds.includes(deviceId) ? clone(features) : { data: [] })),
  };
  return {
    app: { getFirstSavedOAuth2Client: () => client, log: jest.fn() },
    manifest: { version: '2.0.0' },
    error: jest.fn(),
  };
}

// The report and the summary lines the app logged for it
async function exportAll(homey) {
  homey.app.log.mockClear();
  const { report, summaryLines } = await api.getReport({ homey });
  const logged = homey.app.log.mock.calls.map(([line]) => line);
  expect(logged).toHaveLength(summaryLines);
  const heating = report.devices.filter((device) => device.deviceType === 'heating');
  return { report, logged, features: heating.map((device) => device.features) };
}

// Everything except the anonymized fields must come through unchanged
function payload(featuresResponse) {
  return featuresResponse.data.map((item) => {
    const { uri, gatewayId, ...rest } = clone(item);
    if (item.feature.endsWith('.serial')) delete rest.properties.value.value;
    if (/^heating\.circuits\.\d+(\.name)?$/.test(item.feature) && rest.properties.name) delete rest.properties.name.value;
    if (item.feature.endsWith('.remoteController')) delete rest.commands.setZigbeeController?.params.deviceId.constraints.enum;
    (function dropUris(node) {
      if (node && typeof node === 'object') {
        delete node.uri;
        Object.values(node).forEach(dropUris);
      }
    }(rest.commands));
    return rest;
  });
}

describe('report of a realistic installation', () => {
  let homey;
  let exported;

  beforeAll(async () => {
    homey = fakeHomey({ installations: rawInstallations(), features: rawFeatures() });
    exported = await exportAll(homey);
  });

  test('contains no original identifier and no personal data, also in the logged summary', () => {
    const text = JSON.stringify([exported.report, exported.logged]);
    for (const original of ORIGINALS) expect(text).not.toContain(original);
  });

  test('replaces identifiers with placeholders that are recognizable as such', () => {
    const installation = exported.report.installations.data[0];
    const gateway = installation.gateways[0];
    expect(installation.id).toMatch(PLACEHOLDER_PATTERNS.installationId);
    expect(gateway.serial).toMatch(PLACEHOLDER_PATTERNS.serial);
    expect(gateway.devices[0].boilerSerial).toMatch(PLACEHOLDER_PATTERNS.serial);
    expect(gateway.devices[0].bmuSerial).toMatch(PLACEHOLDER_PATTERNS.serial);
    expect(gateway.devices[0].materialNumber).toMatch(PLACEHOLDER_PATTERNS.materialNumber);
    expect(gateway.devices[2].id).toMatch(PLACEHOLDER_PATTERNS.deviceId);
    expect(installation.description).toBe(REDACTED);
    expect(installation.buildingEmail).toBe(REDACTED);
    expect(installation.servicedBy).toBe(REDACTED);
    expect(installation.address.street).toBe(REDACTED);
    expect(gateway.description).toBe(REDACTED);
  });

  test('uses the same placeholders in the installations and the features data', () => {
    const gateway = exported.report.installations.data[0].gateways[0];
    const [features] = exported.features;
    expect(features.data[0].uri).toBe(`https://api.viessmann-climatesolutions.com/iot/v2/features/installations/${gateway.installationId}`
      + `/gateways/${gateway.serial}/devices/0/features/heating.dhw.temperature.main`);
    expect(features.data[0].gatewayId).toBe(gateway.serial);
    expect(features.data[1].properties.value.value).toBe(gateway.devices[0].boilerSerial);
    expect(features.data[4].commands.setZigbeeController.params.deviceId.constraints.enum).toEqual([gateway.devices[2].id]);
  });

  test('keeps feature names, values, units, commands, constraints and timestamps', () => {
    const [features] = exported.features;
    expect(payload(features)).toEqual(payload(rawFeatures()));
    expect(features.data[0].properties.value).toEqual({ type: 'number', value: 50, unit: 'celsius' });
    expect(features.data[0].timestamp).toBe(TIMESTAMP);
    const device = exported.report.installations.data[0].gateways[0].devices[0];
    expect(device).toMatchObject({ id: '0', modelId: 'E3_Vitodens_200_0821', roles: ['type:boiler'] });
    expect(exported.report.devices[0]).toMatchObject({ id: '0', deviceType: 'heating', modelId: 'E3_Vitodens_200_0821' });
  });

  test('stays the same in later reports of the same app instance', async () => {
    const later = await exportAll(homey);
    expect(later.report.installations).toEqual(exported.report.installations);
    expect(later.report.devices).toEqual(exported.report.devices);
  });

  test('without an added device the error says so', async () => {
    const withoutLogin = {
      app: {
        getFirstSavedOAuth2Client: () => {
          throw new Error('No OAuth2 Client Found');
        },
        log: jest.fn(),
      },
      error: jest.fn(),
    };
    await expect(api.getReport({ homey: withoutLogin })).rejects.toThrow('No OAuth2 Client Found');
    expect(withoutLogin.app.log).not.toHaveBeenCalled();
  });
});

describe('report of every fixture', () => {
  const fixtureNames = fs.readdirSync(FIXTURES_DIR)
    .filter((file) => file.endsWith('_installations.json'))
    .map((file) => file.replace('_installations.json', ''))
    .sort();

  // Every fake identifier in the fixtures (also inside URIs). The report treats them as real
  // identifiers, so none of them may come through.
  function fakeIdentifiers(node, found = new Set()) {
    if (Array.isArray(node)) node.forEach((item) => fakeIdentifiers(item, found));
    else if (node && typeof node === 'object') Object.values(node).forEach((value) => fakeIdentifiers(value, found));
    else if (typeof node === 'string' || typeof node === 'number') {
      for (const token of [String(node), ...String(node).split('/')]) {
        if (Object.values(FAKE_PATTERNS).some((pattern) => pattern.test(token))) found.add(token);
      }
    }
    return found;
  }

  test.each(fixtureNames)('%s', async (name) => {
    const installationsFixture = readFixture(`${name}_installations.json`);
    const installations = Array.isArray(installationsFixture) ? { data: installationsFixture } : installationsFixture;
    const features = readFixture(`${name}_features.json`);
    const known = fakeIdentifiers([installations, features]);
    expect(known.size).toBeGreaterThan(0);

    const exported = await exportAll(fakeHomey({ installations, features }));
    expect(exported.features).toHaveLength(1);

    const text = JSON.stringify([exported.report, exported.logged]);
    const survivors = [...known].filter((value) => new RegExp(`(?<![A-Za-z0-9])${value}(?![A-Za-z0-9])`).test(text));
    expect(survivors).toEqual([]);
    expect(payload(exported.features[0])).toEqual(payload(features));
  });
});
