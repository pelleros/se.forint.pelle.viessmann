/* eslint-env jest */

'use strict';

// The device settings "Update interval" and "Event log": the poll interval they give, the API
// calls a day per Viessmann login they plan (a choice over Viessmann's limit is refused), and the
// event log with its Flow triggers.

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const ViessmannDriver = require('../driver');
const ViessmannDevice = require('../device');
const { PATHS } = require('../config');

const MINUTE = 60 * 1000;
const NOW = Date.parse('2026-11-26T11:00:00Z');

function createDriver() {
  const driver = new ViessmannDriver();
  const devices = [];
  driver.getDevices = jest.fn(() => devices);
  const cards = new Map();
  driver.homey.flow = {
    getDeviceTriggerCard: jest.fn((id) => {
      const card = {
        trigger: jest.fn(async () => {}),
        registerRunListener: jest.fn((listener) => {
          card.listener = listener;
        }),
      };
      cards.set(id, card);
      return card;
    }),
    getConditionCard: jest.fn(() => ({ registerRunListener: jest.fn() })),
    getActionCard: jest.fn(() => ({ registerRunListener: jest.fn() })),
  };
  return { driver, devices, cards };
}

function createDevice(driver, { session = 'session-1', settings = {} } = {}) {
  const device = new ViessmannDevice();
  device.driver = driver;
  device.homey = {
    __: (key) => key,
    setTimeout: jest.fn((fn, ms) => ({ fn, ms })),
    clearTimeout: jest.fn(),
    clock: { getTimezone: () => 'UTC' },
  };
  device.__store = {
    installationId: 1, gatewaySerial: 'gw', deviceId: '0', OAuth2SessionId: session, knownMessages: { faults: [], logbook: null, events: null },
  };
  device.__settings = {
    heatingCircuit: 'auto', pollInterval: 'auto', eventLog: 'off', ...settings,
  };
  device._installationId = 1;
  device._gatewaySerial = 'gw';
  device._deviceId = '0';
  device._features = [PATHS.HOT_WATER_TEMP];
  device._roles = [];
  device.oAuth2Client = { getEventsHistory: jest.fn(async () => ({ data: [] })) };
  return device;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('update interval', () => {
  test('automatic shares 2 minutes per device; a chosen interval is used as it is', () => {
    const { driver, devices } = createDriver();
    const auto = createDevice(driver);
    const fixed = createDevice(driver, { settings: { pollInterval: '10' } });
    devices.push(auto, fixed);
    expect(driver._calculatePollInterval(auto)).toBe(4 * MINUTE);
    expect(driver._calculatePollInterval(fixed)).toBe(10 * MINUTE);
    // Devices without the setting (older code paths) keep the automatic interval
    expect(driver._calculatePollInterval({})).toBe(4 * MINUTE);
  });

  test('planned calls a day count the devices of the same login, with polls and event log reads', () => {
    const { driver, devices } = createDriver();
    const a = createDevice(driver, { settings: { pollInterval: '5', eventLog: '30' } });
    const b = createDevice(driver);
    const other = createDevice(driver, { session: 'session-2', settings: { pollInterval: '2' } });
    devices.push(a, b, other);
    // a: 288 + 48; b: automatic, 6 minutes with three devices = 240
    expect(driver.plannedCallsPerDay('session-1')).toBe(288 + 48 + 240);
    expect(driver.plannedCallsPerDay('session-1', { device: b, settings: { pollInterval: '2', eventLog: '15' } })).toBe(288 + 48 + 720 + 96);
  });

  test('a choice over Viessmann\'s daily limit is refused before anything changes', async () => {
    const { driver, devices } = createDriver();
    const a = createDevice(driver, { settings: { pollInterval: '2' } });
    const b = createDevice(driver);
    devices.push(a, b);
    driver._startPolling = jest.fn(async () => {});

    await expect(b.onSettings({ newSettings: { ...b.__settings, pollInterval: '2' }, changedKeys: ['pollInterval'] }))
      .rejects.toThrow('this Viessmann account would need about 1440 API calls a day');
    expect(driver._startPolling).not.toHaveBeenCalled();
    expect(b.getPollSetting('pollInterval')).toBe('auto');

    await b.onSettings({ newSettings: { ...b.__settings, pollInterval: '5' }, changedKeys: ['pollInterval'] });
    expect(b.getPollSetting('pollInterval')).toBe('5');
    expect(driver._startPolling).toHaveBeenCalledWith(b, b.getPollingKey());
    expect(driver._calculatePollInterval(b)).toBe(5 * MINUTE);
  });
});

describe('event log', () => {
  const event = (minutesAgo, errorCode, extra = {}) => ({
    eventType: 'device-error',
    eventTimestamp: new Date(NOW - minutesAgo * MINUTE).toISOString(),
    body: {
      errorCode, errorDescription: `Text of ${errorCode}`, active: true, deviceId: '0', ...extra,
    },
  });

  async function deviceWithEventLog(minutes = '30') {
    const { driver, devices, cards } = createDriver();
    await driver._registerTriggerCards();
    const device = createDevice(driver, { settings: { eventLog: minutes } });
    devices.push(device);
    return { device, cards };
  }

  test('is off by default: nothing is read', async () => {
    const { driver } = createDriver();
    const device = createDevice(driver);
    device.getMonitor().scheduleEventLog();
    expect(device.homey.setTimeout).not.toHaveBeenCalled();
  });

  test('turned on, it starts from now and triggers new events of this device once', async () => {
    const { device, cards } = await deviceWithEventLog();
    device.getMonitor().scheduleEventLog();
    expect(device.homey.setTimeout).toHaveBeenCalledWith(expect.any(Function), 30 * MINUTE);
    expect(device.getStoreValue('knownMessages').events).toEqual({ at: NOW, keys: [] });

    jest.setSystemTime(NOW + 30 * MINUTE);
    device.oAuth2Client.getEventsHistory.mockResolvedValueOnce({
      data: [event(-10, 'F.160'), event(-20, 'S.123', { active: false }), event(-15, 'F.1', { deviceId: 'RoomControl-1' }), event(5, 'old')],
    });
    await device.getMonitor().readEventLog();

    expect(device.oAuth2Client.getEventsHistory).toHaveBeenCalledWith({ installationId: 1, gatewaySerial: 'gw', start: new Date(NOW).toISOString() });
    expect(cards.get('event-logged').trigger.mock.calls.map(([, tokens]) => tokens)).toEqual([
      {
        code: 'F.160', description: 'Text of F.160', type: 'device-error', active: true,
      },
      {
        code: 'S.123', description: 'Text of S.123', type: 'device-error', active: false,
      },
    ]);
    expect(cards.get('event-code-logged').trigger).toHaveBeenCalledWith(device, { description: 'Text of F.160', type: 'device-error', active: true }, { code: 'F.160' });

    // The same events again: nothing new
    device.oAuth2Client.getEventsHistory.mockResolvedValueOnce({ data: [event(-10, 'F.160'), event(-20, 'S.123', { active: false })] });
    await device.getMonitor().readEventLog();
    expect(cards.get('event-logged').trigger).toHaveBeenCalledTimes(2);
  });

  test('the code card fires only for its code', async () => {
    const { cards } = await deviceWithEventLog();
    const { listener } = cards.get('event-code-logged');
    await expect(listener({ code: ' f.160 ' }, { code: 'F.160' })).resolves.toBe(true);
    await expect(listener({ code: 'F.16' }, { code: 'F.160' })).resolves.toBe(false);
  });

  test('a failed read is logged and does not stop the device', async () => {
    const { device } = await deviceWithEventLog('60');
    device.oAuth2Client.getEventsHistory.mockRejectedValueOnce(new Error('Viessmann HTTP 403'));
    await expect(device.getMonitor().readEventLog()).resolves.toBeUndefined();
    expect(device.error).toHaveBeenCalledWith('Could not update the event log:', expect.any(Error));
  });

  test('stops with the device', async () => {
    const { device } = await deviceWithEventLog();
    device.driver._stopPolling = jest.fn(async () => {});
    device.getMonitor().scheduleEventLog();
    await device.onOAuth2Deleted();
    expect(device.homey.clearTimeout).toHaveBeenCalled();
  });
});
