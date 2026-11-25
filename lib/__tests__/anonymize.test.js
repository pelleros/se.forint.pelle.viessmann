/* eslint-env jest */

'use strict';

const {
  Anonymizer, anonymizeDumps, FAKE_PATTERNS, FAKE_TIMESTAMP, PLACEHOLDER_PATTERNS, REDACTED, TROUBLESHOOTING_STYLE,
} = require('../anonymize');

// Synthetic "raw" identifiers. They only need to look like the real formats.
const INSTALLATION_ID = 2345678;
const GATEWAY_SERIAL = '7637415022052208';
const BOILER_SERIAL = '7723181102328103';
const BMU_SERIAL = '7710468800114203';
const DEVICE_SERIAL = '7730217201551100';
const MATERIAL_NUMBER = '7620123';
const ZIGBEE_ID = 'zigbee-04cd15fffe0a1b2c';
const TIMESTAMP = '2026-11-20T13:47:36.569Z';
const BASE = `https://api.viessmann-climatesolutions.com/iot/v2/features/installations/${INSTALLATION_ID}/gateways/${GATEWAY_SERIAL}/devices/0/features`;

function feature(name, properties, commands = {}) {
  return {
    feature: name,
    gatewayId: GATEWAY_SERIAL,
    deviceId: '0',
    timestamp: TIMESTAMP,
    isEnabled: true,
    isReady: true,
    apiVersion: 1,
    uri: `${BASE}/${name}`,
    properties,
    commands,
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
          params: {
            temperature: {
              type: 'number', required: true, constraints: { min: 10, max: 60, stepping: 1 },
            },
          },
        },
      }),
      feature('device.serial', { value: { type: 'string', value: DEVICE_SERIAL } }),
      feature('heating.circuits.0.name', { name: { type: 'string', value: 'Upstairs, Example Street 12' } }),
      feature('heating.circuits.0.remoteController', {}, {
        setZigbeeController: {
          uri: `${BASE}/heating.circuits.0.remoteController/commands/setZigbeeController`,
          name: 'setZigbeeController',
          isExecutable: true,
          params: { deviceId: { type: 'string', required: true, constraints: { enum: [ZIGBEE_ID] } } },
        },
      }),
      feature('device.messages.logbook', {
        entries: { type: 'array', value: [{ timestamp: TIMESTAMP, actor: 'Boiler', event: `Boiler ${BOILER_SERIAL} restarted` }] },
      }),
    ],
  };
}

function rawInstallations() {
  return {
    data: [{
      id: INSTALLATION_ID,
      description: 'Holiday home',
      address: {
        street: 'Example Street', houseNumber: '12', zip: '12345', city: 'Example City', geolocation: { latitude: 57.1, longitude: 11.9 },
      },
      buildingName: 'Villa Example',
      buildingPhone: '+46 70 000 00 00',
      registeredAt: TIMESTAMP,
      gateways: [{
        serial: GATEWAY_SERIAL,
        installationId: INSTALLATION_ID,
        gatewayType: 'VitoconnectOptolink',
        version: '2.8.0.0',
        devices: [
          {
            gatewaySerial: GATEWAY_SERIAL, id: '0', boilerSerial: BOILER_SERIAL, bmuSerial: BMU_SERIAL, materialNumber: MATERIAL_NUMBER, modelId: 'E3_Vitodens_200_0821', roles: ['type:boiler'],
          },
          { gatewaySerial: GATEWAY_SERIAL, id: 'RoomControl-1', roles: ['type:virtual;smartRoomControl'] },
          {
            gatewaySerial: GATEWAY_SERIAL, id: ZIGBEE_ID, deviceType: 'zigbee', roles: ['type:radiator'],
          },
        ],
      }],
    }],
  };
}

const ORIGINALS = [String(INSTALLATION_ID), GATEWAY_SERIAL, BOILER_SERIAL, BMU_SERIAL, DEVICE_SERIAL, MATERIAL_NUMBER, ZIGBEE_ID,
  'Example Street', 'Holiday home', 'Villa Example', '+46 70', 'Upstairs'];

describe('TROUBLESHOOTING_STYLE', () => {
  const [features, installations] = anonymizeDumps([rawFeatures(), rawInstallations()], new Anonymizer({ style: TROUBLESHOOTING_STYLE }));
  const [dhw, deviceSerial, circuitName, remoteController, logbook] = features.data;
  const installation = installations.data[0];
  const gateway = installation.gateways[0];
  const [boiler, roomControl, zigbee] = gateway.devices;

  test('leaves no original identifier or personal data', () => {
    const text = JSON.stringify([features, installations]);
    for (const original of ORIGINALS) expect(text).not.toContain(original);
  });

  test('uses placeholders that say what they replace', () => {
    expect(installation.id).toBe('anonymized-installation-1');
    expect(gateway.serial).toBe('anonymized-serial-1');
    expect(boiler.boilerSerial).toMatch(PLACEHOLDER_PATTERNS.serial);
    expect(boiler.bmuSerial).toMatch(PLACEHOLDER_PATTERNS.serial);
    expect(boiler.materialNumber).toBe('anonymized-material-1');
    expect(zigbee.id).toBe('anonymized-zigbee-1');
    expect(deviceSerial.properties.value.value).toMatch(PLACEHOLDER_PATTERNS.serial);
    expect(circuitName.properties.name.value).toBe(REDACTED);
    expect(installation.description).toBe(REDACTED);
    expect(installation.buildingName).toBe(REDACTED);
    expect(installation.address.street).toBe(REDACTED);
    expect(installation.address.geolocation).toEqual({ latitude: 0, longitude: 0 });
  });

  test('uses the same placeholder for the same value everywhere', () => {
    expect(dhw.uri).toBe('https://api.viessmann-climatesolutions.com/iot/v2/features/installations/anonymized-installation-1'
      + '/gateways/anonymized-serial-1/devices/0/features/heating.dhw.temperature.main');
    expect(dhw.gatewayId).toBe(gateway.serial);
    expect(gateway.installationId).toBe(installation.id);
    expect(logbook.properties.entries.value[0].event).toBe(`Boiler ${boiler.boilerSerial} restarted`);
    expect(remoteController.commands.setZigbeeController.params.deviceId.constraints.enum).toEqual([zigbee.id]);
  });

  test('keeps values, units, commands, constraints, timestamps and generic ids', () => {
    const original = rawFeatures().data[0];
    expect(dhw.properties).toEqual(original.properties);
    expect(dhw.commands.setTargetTemperature.params).toEqual(original.commands.setTargetTemperature.params);
    expect(dhw.timestamp).toBe(TIMESTAMP);
    expect(installation.registeredAt).toBe(TIMESTAMP);
    expect(boiler.id).toBe('0');
    expect(roomControl.id).toBe('RoomControl-1');
    expect(boiler.modelId).toBe('E3_Vitodens_200_0821');
    expect(gateway.version).toBe('2.8.0.0');
  });

  test('is idempotent', () => {
    expect(anonymizeDumps([features, installations], new Anonymizer({ style: TROUBLESHOOTING_STYLE }))).toEqual([features, installations]);
  });

  test('replaces fixture fake values too, so they are recognizable as placeholders', () => {
    const anonymizer = new Anonymizer({ style: TROUBLESHOOTING_STYLE });
    expect(anonymizer.installationId(900001)).toBe('anonymized-installation-1');
    expect(anonymizer.serial('9999000000000001')).toBe('anonymized-serial-1');
    expect(anonymizer.deviceId('zigbee-fa4e000000000001')).toBe('anonymized-zigbee-1');
  });
});

describe('FIXTURE_STYLE (default)', () => {
  test('uses realistic fake values and normalizes timestamps', () => {
    const [features, installations] = anonymizeDumps([rawFeatures(), rawInstallations()]);
    const installation = installations.data[0];
    expect(installation.id).toBe(900001);
    expect(installation.gateways[0].serial).toMatch(FAKE_PATTERNS.serial);
    expect(installation.gateways[0].devices[2].id).toMatch(FAKE_PATTERNS.deviceId);
    expect(features.data[2].properties.name.value).toBe('Heating circuit 0');
    expect(features.data[0].timestamp).toBe(FAKE_TIMESTAMP);
  });

  test('turns troubleshooting placeholders into fixture fake values', () => {
    const shared = anonymizeDumps([rawFeatures(), rawInstallations()], new Anonymizer({ style: TROUBLESHOOTING_STYLE }));
    const [features, installations] = anonymizeDumps(shared);
    expect(installations.data[0].id).toMatch(FAKE_PATTERNS.installationId);
    expect(features.data[1].properties.value.value).toMatch(FAKE_PATTERNS.serial);
    expect(features.data[2].properties.name.value).toBe('Heating circuit 0');
    expect(JSON.stringify([features, installations])).not.toContain('anonymized-');
  });
});

describe('Anonymizer', () => {
  test('text() replaces the identifiers it has seen in free text', () => {
    const anonymizer = new Anonymizer({ style: TROUBLESHOOTING_STYLE });
    expect(anonymizer.text(`Viessmann (${INSTALLATION_ID})`)).toBe(`Viessmann (${INSTALLATION_ID})`);
    anonymizer.installationId(INSTALLATION_ID);
    expect(anonymizer.text(`Viessmann (${INSTALLATION_ID})`)).toBe('Viessmann (anonymized-installation-1)');
    expect(anonymizer.text(`Viessmann (${INSTALLATION_ID}9)`)).toBe(`Viessmann (${INSTALLATION_ID}9)`);
    expect(anonymizer.text(null)).toBeNull();
  });

  test('never hands out a reserved value', () => {
    const anonymizer = new Anonymizer({ reserved: ['900001', '900003', '9999000000000001'] });
    expect(anonymizer.installationId('111111')).toBe('900002');
    expect(anonymizer.installationId('222222')).toBe('900004');
    expect(anonymizer.serial(GATEWAY_SERIAL)).toBe('9999000000000002');
  });

  test('keeps numbers numeric where the fake value allows it', () => {
    expect(new Anonymizer().installationId(INSTALLATION_ID)).toBe(900001);
    expect(new Anonymizer({ style: TROUBLESHOOTING_STYLE }).installationId(INSTALLATION_ID)).toBe('anonymized-installation-1');
  });
});
