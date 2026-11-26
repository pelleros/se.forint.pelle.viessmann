'use strict';

// The status and report endpoints of the Web API (api.js /health and /report): calls per login,
// the state of each device, and the report with its summary in the app's log, with nothing
// identifying in it.

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('./helpers/fakeHomeyOAuth2App'));

const api = require('../api');
const { BEGIN } = require('../lib/report');

const GATEWAY_SERIAL = '7637415022052208';
const BOILER_SERIAL = '7723181102328103';
const ORIGINALS = ['2345678', GATEWAY_SERIAL, BOILER_SERIAL, 'Example Street', 'someone@example.com'];
const clone = (value) => JSON.parse(JSON.stringify(value));

function client() {
  return {
    getInstallations: jest.fn(async () => clone({
      data: [{
        id: 2345678,
        description: 'Holiday home',
        address: { street: 'Example Street' },
        buildingEmail: 'someone@example.com',
        gateways: [{
          serial: GATEWAY_SERIAL,
          installationId: 2345678,
          devices: [{
            gatewaySerial: GATEWAY_SERIAL, id: '0', boilerSerial: BOILER_SERIAL, deviceType: 'heating', modelId: 'E3_Vitocal_25x', roles: [],
          }],
        }],
      }],
    })),
    getFeatures: jest.fn(async () => ({
      data: [{ feature: 'heating.boiler.serial', isEnabled: true, properties: { value: { type: 'string', value: BOILER_SERIAL } } }],
    })),
  };
}

const expectNothingIdentifying = (text) => ORIGINALS.forEach((original) => expect(text).not.toContain(original));

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
