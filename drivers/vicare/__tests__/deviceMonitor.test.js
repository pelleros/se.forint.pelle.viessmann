/* eslint-env jest */

'use strict';

// What a device does with a poll beyond copying values (deviceMonitor.js): computed values,
// alarm_problem and the warning, fault and logbook triggers, notifications, write checks, the
// health for the settings page and the maintenance action.

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const ViessmannDevice = require('../device');
const { PATHS } = require('../config');
const { FROZEN_AFTER } = require('../frozenValues');
const { REFRESH_INTERVAL } = require('../deviceMonitor');

const MINUTE = 60 * 1000;
const NOW = Date.parse('2026-11-26T11:00:00Z');

const errors = (...codes) => ({
  feature: PATHS.DEVICE_ERRORS, isEnabled: true, timestamp: '2026-11-26T10:59:00.000Z', properties: { entries: { value: codes.map((code) => ({ errorCode: code, priority: 'error' })) } },
});
const temperature = (value, timestamp = '2026-11-26T10:59:00.000Z') => ({
  feature: PATHS.HOT_WATER_TEMP, isEnabled: true, timestamp, properties: { value: { value } },
});
const target = (value) => ({
  feature: PATHS.HOT_WATER_TARGET, isEnabled: true, properties: { value: { value } }, commands: { setTargetTemperature: { params: {} } },
});
const gas = (unit) => ({
  feature: PATHS.GAS_TOTAL,
  isEnabled: true,
  properties: { day: { unit, value: [1, 31] }, dayValueReadAt: { value: '2026-11-26T06:00:00.000Z' } },
});

async function createDevice(features = [PATHS.HOT_WATER_TEMP, PATHS.HOT_WATER_TARGET, PATHS.GAS_TOTAL]) {
  const device = new ViessmannDevice();
  const events = [];
  device.driver = {
    getTriggerCard: () => null,
    triggerEvent: jest.fn(async (id, _, tokens) => events.push([id, tokens])),
    _pausePolling: jest.fn(async () => {}),
    _resumePolling: jest.fn(() => true),
    _readDeviceMetadata: jest.fn(() => ({ features: [PATHS.HOT_WATER_TEMP, PATHS.OUTSIDE_TEMP], heatingCircuitId: '0' })),
  };
  device.homey = {
    clock: { getTimezone: () => 'Europe/Stockholm' },
    i18n: { getLanguage: () => 'en' },
    notifications: { createNotification: jest.fn(async () => {}) },
    __: (key) => key,
  };
  device.setWarning = jest.fn(async () => {});
  device.unsetWarning = jest.fn(async () => {});
  device.getName = () => 'Heat pump';
  device._roles = ['type:heatpump'];
  device._features = features;
  device.__store = { installationId: 1, gatewaySerial: 'g', deviceId: '0' };
  device.oAuth2Client = {
    executeCommand: jest.fn(async () => ({ data: { success: true } })),
    getFeatures: jest.fn(async () => ({ data: [temperature(45), { feature: PATHS.OUTSIDE_TEMP, isEnabled: true, properties: { value: { value: 3 } } }] })),
  };
  await device.initializeCapabilities();
  await device.registerCapabilityListeners();
  device.getMonitor().registerListeners();
  return { device, events };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  jest.useRealTimers();
});

test('every device gets the problem alarm and the maintenance action', async () => {
  const { device } = await createDevice([PATHS.HOT_WATER_TEMP]);
  expect(device.getCapabilities()).toEqual(expect.arrayContaining(['alarm_problem', 'button.refreshFeatures']));
  expect(device.getCapabilityOptions('button.refreshFeatures')).toMatchObject({ maintenanceAction: true });
});

describe('faults', () => {
  test('a fault sets alarm_problem and the warning, and is triggered and notified once', async () => {
    const { device, events } = await createDevice();
    await device.onFeaturesUpdated({ data: [temperature(45), errors('F.160')] });
    await device.onFeaturesUpdated({ data: [temperature(45), errors('F.160')] });

    expect(device.getCapabilityValue('alarm_problem')).toBe(true);
    expect(device.setWarning).toHaveBeenCalledTimes(1);
    expect(device.setWarning).toHaveBeenCalledWith(expect.stringContaining('F.160'));
    expect(events).toEqual([['fault-reported', { code: 'F.160', priority: 'error' }]]);
    expect(device.homey.notifications.createNotification).toHaveBeenCalledTimes(1);
    expect(device.getStoreValue('knownMessages')).toEqual({ faults: ['F.160'], logbook: null, events: null });

    await device.onFeaturesUpdated({ data: [temperature(45), errors()] });
    expect(device.getCapabilityValue('alarm_problem')).toBe(false);
    expect(device.unsetWarning).toHaveBeenCalledTimes(1);
  });

  test('a fault already reported before a restart is not reported again', async () => {
    const { device, events } = await createDevice();
    device.__store.knownMessages = { faults: ['F.160'], logbook: null };
    device._monitor = undefined;
    await device.onFeaturesUpdated({ data: [temperature(45), errors('F.160')] });
    expect(device.getCapabilityValue('alarm_problem')).toBe(true);
    expect(events).toEqual([]);
  });

  test('without triggers (switching circuits) nothing is fired, but the alarm still shows', async () => {
    const { device, events } = await createDevice();
    await device.onFeaturesUpdated({ data: [temperature(45), errors('F.160')] }, false, { triggers: false });
    expect(events).toEqual([]);
    expect(device.getCapabilityValue('alarm_problem')).toBe(true);
  });
});

test('values that stop updating set the alarm and a warning with advice', async () => {
  const { device } = await createDevice();
  await device.onFeaturesUpdated({ data: [temperature(45)] });
  jest.setSystemTime(NOW + FROZEN_AFTER);
  await device.onFeaturesUpdated({ data: [temperature(45)] });
  expect(device.getCapabilityValue('alarm_problem')).toBe(true);
  expect(device.setWarning).toHaveBeenCalledWith(expect.stringContaining('Vitoconnect'));
  expect(device.setWarning).toHaveBeenCalledWith(expect.stringContaining('26 Nov, 11:59'));

  await device.onFeaturesUpdated({ data: [temperature(46, '2026-11-26T17:00:00.000Z')] });
  expect(device.getCapabilityValue('alarm_problem')).toBe(false);
  expect(device.unsetWarning).toHaveBeenCalled();
});

describe('writes', () => {
  test('a write the next poll does not show is told to the user; a later match clears it', async () => {
    const { device } = await createDevice();
    await device.__listeners.get('target_temperature.hotWater')(50);
    expect(device.getCapabilityValue('target_temperature.hotWater')).toBe(50);

    jest.setSystemTime(NOW + 2 * MINUTE);
    await device.onFeaturesUpdated({ data: [temperature(45), target(48)] });
    expect(device.setWarning).toHaveBeenCalledWith(expect.stringContaining('Hot water Normal is 48 °C instead of 50 °C'));
    expect(device.homey.notifications.createNotification).toHaveBeenCalledWith({ excerpt: expect.stringContaining('did not take') });
    // Not an alarm: the heating system works, it just kept its value
    expect(device.getCapabilityValue('alarm_problem')).toBe(false);

    await device.onFeaturesUpdated({ data: [temperature(45), target(50)] });
    expect(device.unsetWarning).toHaveBeenCalled();
  });

  test('a write the poll shows is confirmed silently', async () => {
    const { device } = await createDevice();
    await device.__listeners.get('target_temperature.hotWater')(50);
    jest.setSystemTime(NOW + 2 * MINUTE);
    await device.onFeaturesUpdated({ data: [temperature(45), target(50)] });
    expect(device.setWarning).not.toHaveBeenCalled();
  });

  test('a refused write (403) says it may be temporary', async () => {
    const { device } = await createDevice();
    device.oAuth2Client.executeCommand.mockRejectedValueOnce(Object.assign(new Error('Viessmann HTTP 403: Write access or API permission denied — Unknown'), { status: 403 }));
    await expect(device.__listeners.get('target_temperature.hotWater')(50)).rejects.toThrow('This is sometimes a temporary fault at Viessmann');
  });
});

test('gas yesterday takes the unit the device reports', async () => {
  const { device } = await createDevice();
  await device.onFeaturesUpdated({ data: [temperature(45), gas('kilowattHour')] });
  expect(device.getCapabilityValue('measure_gas_yesterday.total')).toBe(31);
  expect(device.getCapabilityOptions('measure_gas_yesterday.total').units).toBe('kWh');
});

test('the health shows the last update and the last error', async () => {
  const { device } = await createDevice();
  device.recordPollError(new Error('Viessmann HTTP 502: Bad gateway'));
  await device.onFeaturesUpdated({ data: [temperature(45)] });
  expect(device.getMonitor().health).toEqual({ lastUpdateAt: NOW, lastError: { message: 'Viessmann HTTP 502: Bad gateway', at: NOW } });
});

test('the maintenance action reads the features once, adds new ones and is rate limited', async () => {
  const { device } = await createDevice([PATHS.HOT_WATER_TEMP]);
  await device.__listeners.get('button.refreshFeatures')(true);
  expect(device.oAuth2Client.getFeatures).toHaveBeenCalledTimes(1);
  expect(device.getStoreValue('features')).toEqual([PATHS.HOT_WATER_TEMP, PATHS.OUTSIDE_TEMP]);
  expect(device.getCapabilityValue('measure_temperature.outside')).toBe(3);
  expect(device.driver._pausePolling).toHaveBeenCalled();
  expect(device.driver._resumePolling).toHaveBeenCalled();

  await expect(device.__listeners.get('button.refreshFeatures')(true)).rejects.toThrow('Try again in 10 minutes');
  jest.setSystemTime(NOW + REFRESH_INTERVAL);
  await device.__listeners.get('button.refreshFeatures')(true);
  expect(device.oAuth2Client.getFeatures).toHaveBeenCalledTimes(2);
});
