/* eslint-env jest */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  Anonymizer, anonymizeDumps, FAKE_PATTERNS, FAKE_TIMESTAMP, REDACTED,
} = require('../scripts/anonymizeDump');

// Synthetic "raw" identifiers. They only need to look like the real formats.
const INSTALLATION_ID = 123456;
const GATEWAY_SERIAL = '1234567890123456';
const BOILER_SERIAL = '2345678901234567';
const CONTROLLER_SERIAL = '3456789012345678';
const ZIGBEE_ID = 'zigbee-0123456789abcdef';
const OLD_BASE = `https://api.viessmann.com/iot/v2/features/installations/${INSTALLATION_ID}/gateways/${GATEWAY_SERIAL}/devices/0/features`;

function rawFeatures() {
  return {
    data: [
      {
        feature: 'heating.dhw.temperature.main',
        gatewayId: GATEWAY_SERIAL,
        deviceId: '0',
        timestamp: '2024-11-20T13:47:36.569Z',
        isEnabled: true,
        isReady: true,
        apiVersion: 1,
        uri: `${OLD_BASE}/heating.dhw.temperature.main`,
        properties: { value: { type: 'number', value: 50, unit: 'celsius' } },
        commands: {
          setTargetTemperature: {
            uri: `${OLD_BASE}/heating.dhw.temperature.main/commands/setTargetTemperature`,
            name: 'setTargetTemperature',
            isExecutable: true,
            params: {
              temperature: {
                type: 'number',
                required: true,
                constraints: {
                  min: 10, efficientLowerBorder: 10, efficientUpperBorder: 60, max: 60, stepping: 1,
                },
              },
            },
          },
        },
      },
      {
        feature: 'heating.boiler.serial',
        gatewayId: GATEWAY_SERIAL,
        deviceId: '0',
        timestamp: '2024-11-20T13:47:36.569Z',
        isEnabled: true,
        uri: `${OLD_BASE}/heating.boiler.serial`,
        properties: { value: { type: 'string', value: BOILER_SERIAL } },
        commands: {},
      },
      {
        feature: 'heating.controller.serial',
        gatewayId: GATEWAY_SERIAL,
        deviceId: '0',
        timestamp: '2024-11-20T13:47:36.569Z',
        isEnabled: true,
        uri: `${OLD_BASE}/heating.controller.serial`,
        properties: { value: { type: 'string', value: CONTROLLER_SERIAL } },
        commands: {},
      },
      {
        feature: 'heating.circuits.1.name',
        gatewayId: GATEWAY_SERIAL,
        deviceId: '0',
        timestamp: '2024-11-20T13:47:36.569Z',
        isEnabled: true,
        uri: `${OLD_BASE}/heating.circuits.1.name`,
        properties: { name: { type: 'string', value: 'Heating Example Street 12' } },
        commands: {},
      },
      {
        feature: 'device.messages.logbook',
        gatewayId: GATEWAY_SERIAL,
        deviceId: '0',
        timestamp: '2024-11-20T13:47:36.569Z',
        isEnabled: true,
        uri: `${OLD_BASE}/device.messages.logbook`,
        properties: {
          entries: {
            type: 'array',
            value: [{ timestamp: '2024-11-19T10:40:20.000Z', actor: 'SEK_PUMPE1', event: `Boiler ${BOILER_SERIAL} restarted` }],
          },
        },
        commands: {},
      },
    ],
  };
}

function rawInstallations() {
  return {
    cursor: { next: 'opaque-cursor' },
    data: [
      {
        id: -1, // already redacted by the app's troubleshooting view
        description: 'Holiday home',
        address: {
          street: 'Example Street',
          houseNumber: '12',
          zip: '12345',
          city: 'Example City',
          geolocation: { latitude: 57.1, longitude: 11.9, timeZone: 'Europe/Stockholm' },
        },
        buildingEmail: 'someone@example.com',
        servicedBy: 'Some Installer Ltd',
        createdAt: '2024-10-31T08:00:00.000Z',
        gateways: [
          {
            serial: '***',
            installationId: INSTALLATION_ID,
            gatewayType: 'VitoconnectOptolink',
            version: '1.2.3.4',
            devices: [
              {
                gatewaySerial: GATEWAY_SERIAL, id: '0', boilerSerial: BOILER_SERIAL, materialNumber: '7654321', modelId: 'E3_Vitodens_200_0821', roles: ['type:boiler'],
              },
              {
                gatewaySerial: GATEWAY_SERIAL, id: 'gateway', boilerSerial: null, roles: ['type:gateway;TCU200'],
              },
              { gatewaySerial: GATEWAY_SERIAL, id: 'RoomControl-1', roles: ['type:virtual;smartRoomControl'] },
              { gatewaySerial: GATEWAY_SERIAL, id: ZIGBEE_ID, roles: ['type:radiator'] },
            ],
          },
        ],
      },
    ],
  };
}

describe('anonymizeDumps', () => {
  const [features, installations] = anonymizeDumps([rawFeatures(), rawInstallations()]);
  const [dhw, boilerSerial, controllerSerial, circuitName, logbook] = features.data;
  const installation = installations.data[0];
  const gateway = installation.gateways[0];
  const [boiler, gatewayDevice, roomControl, zigbee] = gateway.devices;
  const fakeInstallationId = /\/installations\/([^/]+)\//.exec(dhw.uri)[1];

  test('replaces ids and serials in features with fake values', () => {
    expect(dhw.gatewayId).toMatch(FAKE_PATTERNS.serial);
    expect(fakeInstallationId).toMatch(FAKE_PATTERNS.installationId);
    expect(boilerSerial.properties.value.value).toMatch(FAKE_PATTERNS.serial);
    expect(controllerSerial.properties.value.value).toMatch(FAKE_PATTERNS.serial);
    expect(new Set([dhw.gatewayId, boilerSerial.properties.value.value, controllerSerial.properties.value.value]).size).toBe(3);
  });

  test('rewrites the old host and the ids in every uri', () => {
    const expectedBase = `https://api.viessmann-climatesolutions.com/iot/v2/features/installations/${fakeInstallationId}/gateways/${dhw.gatewayId}/devices/0/features`;
    expect(dhw.uri).toBe(`${expectedBase}/heating.dhw.temperature.main`);
    expect(dhw.commands.setTargetTemperature.uri).toBe(`${expectedBase}/heating.dhw.temperature.main/commands/setTargetTemperature`);
  });

  test('normalizes timestamps, including nested ones', () => {
    expect(dhw.timestamp).toBe(FAKE_TIMESTAMP);
    expect(logbook.properties.entries.value[0].timestamp).toBe(FAKE_TIMESTAMP);
    expect(installation.createdAt).toBe(FAKE_TIMESTAMP);
  });

  test('replaces user-defined circuit names', () => {
    expect(circuitName.properties.name.value).toBe('Heating circuit 1');
  });

  test('replaces known identifiers wherever else they appear in a string', () => {
    expect(logbook.properties.entries.value[0].event).toBe(`Boiler ${boilerSerial.properties.value.value} restarted`);
  });

  test('keeps everything the app depends on', () => {
    const original = rawFeatures().data[0];
    expect(dhw.feature).toBe(original.feature);
    expect(dhw.deviceId).toBe('0');
    expect(dhw.isEnabled).toBe(true);
    expect(dhw.properties).toEqual(original.properties);
    expect(dhw.commands.setTargetTemperature.params).toEqual(original.commands.setTargetTemperature.params);
    expect(boiler.modelId).toBe('E3_Vitodens_200_0821');
    expect(boiler.roles).toEqual(['type:boiler']);
    expect(gateway.version).toBe('1.2.3.4');
  });

  test('uses the same fake values in features and installations', () => {
    expect(gateway.installationId).toBe(Number(fakeInstallationId));
    expect(boiler.gatewaySerial).toBe(dhw.gatewayId);
    expect(boiler.boilerSerial).toBe(boilerSerial.properties.value.value);
  });

  test('restores placeholder ids from the anonymized child objects', () => {
    expect(installation.id).toBe(gateway.installationId);
    expect(gateway.serial).toBe(dhw.gatewayId);
  });

  test('redacts personal data in installations', () => {
    expect(installation.description).toBe(REDACTED);
    expect(installation.buildingEmail).toBe(REDACTED);
    expect(installation.servicedBy).toBe(REDACTED);
    expect(installation.address).toEqual({
      street: REDACTED,
      houseNumber: REDACTED,
      zip: REDACTED,
      city: REDACTED,
      geolocation: { latitude: 0, longitude: 0, timeZone: REDACTED },
    });
    expect(installations.cursor.next).toBe('');
    expect(boiler.materialNumber).toMatch(FAKE_PATTERNS.materialNumber);
  });

  test('replaces hardware device ids but keeps generic ones', () => {
    expect(boiler.id).toBe('0');
    expect(gatewayDevice.id).toBe('gateway');
    expect(roomControl.id).toBe('RoomControl-1');
    expect(zigbee.id).toMatch(FAKE_PATTERNS.deviceId);
    expect(zigbee.id).toMatch(/^zigbee-/);
  });

  test('leaves no original identifier in the output', () => {
    const text = JSON.stringify([features, installations]);
    for (const original of [String(INSTALLATION_ID), GATEWAY_SERIAL, BOILER_SERIAL, CONTROLLER_SERIAL, ZIGBEE_ID, '7654321', 'Example Street', 'someone@example.com', 'api.viessmann.com/']) {
      expect(text).not.toContain(original);
    }
  });

  test('is deterministic, idempotent and does not modify its input', () => {
    const input = [rawFeatures(), rawInstallations()];
    const again = anonymizeDumps(input);
    expect(again).toEqual([features, installations]);
    expect(input).toEqual([rawFeatures(), rawInstallations()]);
    expect(anonymizeDumps([features, installations])).toEqual([features, installations]);
  });

  test('a single Anonymizer can be reused across calls', () => {
    const anonymizer = new Anonymizer();
    expect(anonymizer.serial(GATEWAY_SERIAL)).toBe(anonymizer.serial(GATEWAY_SERIAL));
    expect(anonymizer.serial(BOILER_SERIAL)).not.toBe(anonymizer.serial(GATEWAY_SERIAL));
    expect(anonymizer.installationId(INSTALLATION_ID)).toBe(Number(anonymizer.installationId(String(INSTALLATION_ID))));
  });
});

describe('anonymizeDump CLI', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anonymize-dump-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('writes anonymized copies with a shared mapping', () => {
    const files = ['features', 'installations'].map((name) => ({
      input: path.join(dir, `raw_${name}.json`),
      output: path.join(dir, 'out', `${name}.json`),
    }));
    fs.writeFileSync(files[0].input, JSON.stringify(rawFeatures()));
    fs.writeFileSync(files[1].input, JSON.stringify(rawInstallations()));

    const script = path.join(__dirname, '../scripts/anonymizeDump.js');
    const result = spawnSync(process.execPath, [script, ...files.flatMap(({ input, output }) => [input, output])], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    const written = files.map(({ output }) => JSON.parse(fs.readFileSync(output, 'utf8')));
    expect(written).toEqual(anonymizeDumps([rawFeatures(), rawInstallations()]));
  });

  test('fails with usage on a missing output path', () => {
    const script = path.join(__dirname, '../scripts/anonymizeDump.js');
    const result = spawnSync(process.execPath, [script, path.join(dir, 'only-input.json')], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Usage');
  });
});
