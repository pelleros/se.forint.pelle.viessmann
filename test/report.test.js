'use strict';

// The one-step report for the developer (lib/report.js, api.js /report and the pairing view):
// installations and every device's features of a login, anonymized, with a compact summary for
// the app's log. Nothing identifying may reach the report or the log.

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('./helpers/fakeHomeyOAuth2App'));

const api = require('../api');
const {
  collectReport, summarizeReport, describeError, MAX_DEVICES, MAX_SUMMARY_LINES, BEGIN, END,
} = require('../lib/report');
const { apiError } = require('../lib/apiError');

const INSTALLATION_ID = 2345678;
const GATEWAY_SERIAL = '7637415022052208';
const BOILER_SERIAL = '7723181102328103';
const PERSONAL = ['Example Street', 'Example City', 'Holiday home', 'someone@example.com'];
const ORIGINALS = [String(INSTALLATION_ID), GATEWAY_SERIAL, BOILER_SERIAL, ...PERSONAL];
const clone = (value) => JSON.parse(JSON.stringify(value));

function installations(devices) {
  return {
    data: [{
      id: INSTALLATION_ID,
      description: 'Holiday home',
      installationType: 'Residential',
      aggregatedStatus: 'WorksProperly',
      address: { street: 'Example Street', city: 'Example City' },
      buildingEmail: 'someone@example.com',
      gateways: [{
        serial: GATEWAY_SERIAL,
        installationId: INSTALLATION_ID,
        gatewayType: 'VitoconnectOptolink',
        version: '2.8.0.0',
        devices,
      }],
    }],
  };
}

const HEATING = {
  gatewaySerial: GATEWAY_SERIAL, id: '0', boilerSerial: BOILER_SERIAL, deviceType: 'heating', modelId: 'E3_Vitocal_25x', roles: ['type:heatpump'],
};
const FEATURES = {
  data: [{
    feature: 'heating.power.consumption.current',
    isEnabled: true,
    uri: `https://api.viessmann-climatesolutions.com/iot/v2/features/installations/${INSTALLATION_ID}/gateways/${GATEWAY_SERIAL}/devices/0/features/x`,
    properties: { status: { type: 'string', value: 'connected' }, value: { type: 'number', unit: 'kilowatt', value: 0.916 } },
    commands: {},
  }, {
    feature: 'heating.dhw.temperature.main',
    isEnabled: true,
    properties: { value: { type: 'number', unit: 'celsius', value: 50 } },
    commands: { setTargetTemperature: { params: { temperature: { type: 'number' } }, isExecutable: true } },
  }, {
    feature: 'heating.boiler.serial',
    isEnabled: true,
    properties: { value: { type: 'string', value: BOILER_SERIAL } },
  }, {
    feature: 'heating.power.consumption.total',
    isEnabled: true,
    properties: { day: { type: 'array', unit: 'kilowattHour', value: [0, 5.5, 4.2, 6.2, 3.4, 3.2, 4.7, 2.9, 1, 2] } },
  }],
};

function client({ devices = [HEATING], features = FEATURES, failFeatures } = {}) {
  return {
    getInstallations: jest.fn(async () => clone(installations(devices))),
    getFeatures: jest.fn(async () => {
      if (failFeatures) throw failFeatures;
      return clone(features);
    }),
  };
}

const expectNothingIdentifying = (text) => ORIGINALS.forEach((original) => expect(text).not.toContain(original));

test('collects installations and features of every device, anonymized', async () => {
  const oAuth2Client = client({
    devices: [HEATING, {
      gatewaySerial: GATEWAY_SERIAL, id: 'zigbee-04cd15fffe0a1b2c', deviceType: 'zigbee', modelId: 'E3_RadiatorActuator', roles: [],
    }],
  });
  const report = await collectReport(oAuth2Client, { appVersion: '2.0.0', now: Date.parse('2026-11-26T12:00:00Z') });

  expect(oAuth2Client.getFeatures).toHaveBeenCalledTimes(1);
  expect(report).toMatchObject({ app: '2.0.0', generatedAt: '2026-11-26T12:00:00.000Z', skippedDevices: ['zigbee E3_RadiatorActuator'] });
  expect(report.devices).toEqual([expect.objectContaining({
    id: '0', deviceType: 'heating', modelId: 'E3_Vitocal_25x', roles: ['type:heatpump'],
  })]);
  expect(report.devices[0].features.data.map((item) => item.feature)).toEqual(FEATURES.data.map((item) => item.feature));
  expectNothingIdentifying(JSON.stringify(report));
});

test('a device whose features fail is in the report with the error; the rest is read', async () => {
  const report = await collectReport(client({ failFeatures: apiError({ status: 402, body: { errorType: 'PACKAGE_NOT_PAID_FOR', message: 'x' } }) }));
  expect(report.devices[0]).toMatchObject({ deviceType: 'heating', error: { status: 402, code: 'PACKAGE_NOT_PAID_FOR' } });
  expect(report.devices[0].features).toBeUndefined();
  expect(describeError(new Error(`connect to /installations/${INSTALLATION_ID}`)).message).toBe('Request failed');
});

test('a login without installations data still gives a report with the error', async () => {
  const failing = {
    getInstallations: jest.fn(async () => {
      throw apiError({ status: 429 });
    }),
  };
  const report = await collectReport(failing);
  expect(report.error).toMatchObject({ status: 429 });
  expect(summarizeReport(report)).toEqual([expect.stringContaining(BEGIN), expect.stringContaining('"status":429'), END]);
});

test('reads at most a few devices (one API call each)', async () => {
  const devices = Array.from({ length: MAX_DEVICES + 2 }, (_, index) => ({ ...HEATING, id: String(index) }));
  const oAuth2Client = client({ devices });
  const report = await collectReport(oAuth2Client);
  expect(oAuth2Client.getFeatures).toHaveBeenCalledTimes(MAX_DEVICES);
  expect(report.skippedDevices).toHaveLength(2);
});

test('the summary has one short line per feature and stays within its size', async () => {
  const report = await collectReport(client());
  const lines = summarizeReport(report);
  expect(lines[0]).toContain(BEGIN);
  expect(lines[lines.length - 1]).toBe(END);
  expect(lines).toContain('  heating.power.consumption.current: status=connected; value=0.916 kilowatt');
  expect(lines).toContain('  heating.dhw.temperature.main: value=50 celsius | commands: setTargetTemperature(temperature)');
  expect(lines).toContain('  heating.power.consumption.total: day=[0,5.5,4.2,6.2,3.4,3.2,4.7,2.9,…10] kilowattHour');
  expectNothingIdentifying(lines.join('\n'));

  const many = { data: Array.from({ length: MAX_SUMMARY_LINES * 2 }, (_, index) => ({ feature: `f.${index}`, isEnabled: true, properties: {} })) };
  const long = summarizeReport(await collectReport(client({ features: many })));
  expect(long).toHaveLength(MAX_SUMMARY_LINES);
  expect(long[long.length - 2]).toMatch(/more lines in the copied report/);
});

describe('Web API', () => {
  function fakeHomey(oAuth2Client) {
    return {
      app: { getFirstSavedOAuth2Client: () => oAuth2Client, log: jest.fn(), getSavedOAuth2Sessions: () => ({ 'session-1': {} }) },
      manifest: { version: '2.0.0' },
      error: jest.fn(),
      settings: { get: () => undefined, set: () => {} },
      drivers: { getDriver: () => ({ getDevices: () => [] }) },
    };
  }

  test('/report logs the summary for a diagnostic report and returns the report', async () => {
    const homey = fakeHomey(client());
    const { report, summaryLines } = await api.getReport({ homey });
    expect(report.devices).toHaveLength(1);
    expect(homey.app.log).toHaveBeenCalledTimes(summaryLines);
    expect(homey.app.log.mock.calls[0][0]).toContain(BEGIN);
    expectNothingIdentifying(JSON.stringify(homey.app.log.mock.calls));
  });

  test('/health lists the calls per login and the state of each device', async () => {
    const device = {
      getName: () => 'Heat pump',
      getStoreValue: (key) => (key === 'OAuth2SessionId' ? 'session-1' : undefined),
      getAvailable: () => true,
      getPollSetting: (key) => (key === 'eventLog' ? '30' : '5'),
      getMonitor: () => ({ health: { lastUpdateAt: 1000, lastError: null } }),
    };
    const driver = { getDevices: () => [device], plannedCallsPerDay: jest.fn(() => 336), _calculatePollInterval: () => 5 * 60 * 1000 };
    const homey = { ...fakeHomey(client()), drivers: { getDriver: () => driver } };
    const health = await api.getHealth({ homey });
    expect(health).toEqual({
      limit: 1450,
      resetsAt: expect.stringMatching(/T00:00:00\.000Z$/),
      accounts: [{
        account: 1, usedToday: 0, plannedPerDay: 336, devices: 1,
      }],
      devices: [{
        name: 'Heat pump', account: 1, available: true, intervalMinutes: 5, eventLogMinutes: 30, lastUpdateAt: 1000, lastError: null,
      }],
    });
  });
});
