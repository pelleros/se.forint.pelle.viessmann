/* eslint-env jest */

'use strict';

// Temporary changes from Flows (boost.js): the change is sent, the restore is kept in the store
// and runs after the given minutes (also after a restart), and only undoes the boost's own
// change.

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const { polledFixtureDevice } = require('../../../test/helpers/polledFixtureDevice');
const {
  BoostController, boostsOf, STORE_KEY, RETRY_MS, GIVE_UP_MS, STARTUP_DELAY_MS,
} = require('../boost');
const { SHIFT } = require('../heatingCurve');
const { WRITE_LIMITS } = require('../writeLimits');

const MINUTE = 60 * 1000;
const TARGET = 'target_temperature.hotWater';
const CHARGE = 'thermostat_mode.hotWaterOneTimeCharge';

let clock;
beforeEach(() => {
  clock = { now: Date.parse('2026-11-26T12:00:00Z') };
  jest.spyOn(Date, 'now').mockImplementation(() => clock.now);
});
afterEach(() => jest.restoreAllMocks());

// Vitocal 222: hot water target 45 °C (10–60), curve shift -8, no charge running
const heatPump = () => polledFixtureDevice({ clock });
const sent = (device) => device.oAuth2Client.executeCommand.mock.calls
  .map(([request]) => [request.command, request.body]);

async function later(timers, ms) {
  clock.now += ms;
  await timers.run();
}

describe('hot water', () => {
  test('raises the target, keeps the restore in the store and restores after the minutes', async () => {
    const { device, timers } = await heatPump();
    await boostsOf(device).boostHotWater(55, 30);

    expect(sent(device)).toEqual([['setTargetTemperature', { temperature: 55 }]]);
    expect(device.getCapabilityValue(TARGET)).toBe(55);
    expect(device.getStoreValue(STORE_KEY)).toEqual({ hotWater: { previous: 45, boosted: 55, until: clock.now + 30 * MINUTE } });

    await later(timers, 29 * MINUTE);
    expect(sent(device)).toHaveLength(1);
    await later(timers, MINUTE);
    expect(sent(device)).toEqual([['setTargetTemperature', { temperature: 55 }], ['setTargetTemperature', { temperature: 45 }]]);
    expect(device.getCapabilityValue(TARGET)).toBe(45);
    expect(device.getStoreValue(STORE_KEY)).toEqual({});
    expect(timers.timers.size).toBe(0);
  });

  test('a target changed in the meantime is left as it is', async () => {
    const { device, timers } = await heatPump();
    await boostsOf(device).boostHotWater(55, 30);
    device.__values.set(TARGET, 50);
    await later(timers, 30 * MINUTE);
    expect(sent(device)).toHaveLength(1);
    expect(device.getStoreValue(STORE_KEY)).toEqual({});
    expect(device.log).toHaveBeenCalledWith('Hot water target was changed in the meantime, leaving it as it is');
  });

  test('a new boost while one runs keeps the original target and extends the end', async () => {
    const { device, timers } = await heatPump();
    const start = clock.now;
    await boostsOf(device).boostHotWater(55, 30);
    clock.now += 10 * MINUTE;
    await boostsOf(device).boostHotWater(60, 60);
    expect(device.getStoreValue(STORE_KEY).hotWater).toEqual({ previous: 45, boosted: 60, until: start + 70 * MINUTE });
    // A shorter one does not cut the running boost short
    await boostsOf(device).boostHotWater(60, 5);
    expect(device.getStoreValue(STORE_KEY).hotWater.until).toBe(start + 70 * MINUTE);
    expect(sent(device)).toEqual([['setTargetTemperature', { temperature: 55 }], ['setTargetTemperature', { temperature: 60 }]]);

    await later(timers, 60 * MINUTE);
    expect(sent(device).at(-1)).toEqual(['setTargetTemperature', { temperature: 45 }]);
  });

  test('a boost to the current target sends nothing and restores nothing', async () => {
    const { device, timers } = await heatPump();
    await boostsOf(device).boostHotWater(45, 10);
    await later(timers, 10 * MINUTE);
    expect(sent(device)).toEqual([]);
    expect(device.getStoreValue(STORE_KEY)).toEqual({});
  });

  test('is refused without a known target, outside the device\'s limits, or when the change fails', async () => {
    const { device } = await heatPump();
    await expect(boostsOf(device).boostHotWater(75, 30)).rejects.toThrow('temperature is outside the supported range');

    device.oAuth2Client.executeCommand.mockRejectedValueOnce(new Error('HTTP 502'));
    await expect(boostsOf(device).boostHotWater(55, 30)).rejects.toThrow('Error executing command: HTTP 502');
    expect(device.getStoreValue(STORE_KEY)).toEqual({});
    expect(device.getCapabilityValue(TARGET)).toBe(45);

    device.__values.set(TARGET, null);
    await expect(boostsOf(device).boostHotWater(55, 30)).rejects.toThrow('No current value from Viessmann yet');
    expect(device.getStoreValue(STORE_KEY)).toEqual({});
  });

  test('a failed change of a running boost keeps the running boost', async () => {
    const { device } = await heatPump();
    await boostsOf(device).boostHotWater(55, 30);
    const running = device.getStoreValue(STORE_KEY);
    device.oAuth2Client.executeCommand.mockRejectedValueOnce(new Error('HTTP 502'));
    await expect(boostsOf(device).boostHotWater(60, 30)).rejects.toThrow('HTTP 502');
    expect(device.getStoreValue(STORE_KEY)).toEqual(running);
  });

  test('at most 12 boosts that change the target per hour', async () => {
    const { device } = await heatPump();
    for (let i = 0; i < WRITE_LIMITS.hotWaterBoost; i++) await boostsOf(device).boostHotWater(i % 2 ? 51 : 50, 30);
    await expect(boostsOf(device).boostHotWater(52, 30)).rejects.toThrow('at most 12 per hour');
  });
});

describe('after a restart', () => {
  test('a pending restore is scheduled again and runs at its time', async () => {
    const { device, timers } = await heatPump();
    await boostsOf(device).boostHotWater(55, 30);
    const store = device.getStore();
    boostsOf(device).stop();
    expect(timers.timers.size).toBe(0);
    expect(device.getStoreValue(STORE_KEY).hotWater).toBeDefined();

    // Homey restarts 10 minutes later: a new device object with the same store and values
    clock.now += 10 * MINUTE;
    const restarted = await heatPump();
    restarted.device.__store = { ...restarted.device.__store, ...store };
    restarted.device.__values.set(TARGET, 55);
    boostsOf(restarted.device).resume();
    await later(restarted.timers, 19 * MINUTE);
    expect(sent(restarted.device)).toEqual([]);
    await later(restarted.timers, MINUTE);
    expect(sent(restarted.device)).toEqual([['setTargetTemperature', { temperature: 45 }]]);
  });

  test('a restore that came due while Homey was off runs after the first poll', async () => {
    const { device } = await heatPump();
    await boostsOf(device).boostHotWater(55, 30);
    const store = device.getStore();
    boostsOf(device).stop();

    clock.now += 3 * 60 * MINUTE;
    const restarted = await heatPump();
    restarted.device.__store = { ...restarted.device.__store, ...store };
    restarted.device.__values.set(TARGET, 55);
    boostsOf(restarted.device).resume();
    await later(restarted.timers, STARTUP_DELAY_MS - 1);
    expect(sent(restarted.device)).toEqual([]);
    await later(restarted.timers, 1);
    expect(sent(restarted.device)).toEqual([['setTargetTemperature', { temperature: 45 }]]);
  });

  test('the device schedules the pending restores when it starts', async () => {
    const { device, timers } = await heatPump();
    const until = clock.now + 30 * MINUTE;
    device.__store = {
      installationId: 900001,
      gatewaySerial: '9999000000000001',
      deviceId: '0',
      roles: device._roles,
      features: device._features,
      constraints: {},
      operatingModes: [],
      heatingCircuitId: '0',
      commandMetadata: device._commands,
      version: '2.0.0',
      [STORE_KEY]: { hotWater: { previous: 45, boosted: 55, until } },
    };
    device.driver._startPolling = jest.fn(async () => {});
    await device.onOAuth2Init();
    expect([...timers.timers.values()].map((timer) => timer.at)).toEqual([until]);
  });

  test('unloading or deleting the device stops its timers', async () => {
    const { device } = await heatPump();
    const controller = boostsOf(device);
    jest.spyOn(controller, 'stop');
    device.driver._stopPolling = jest.fn(async () => {});
    await device.onOAuth2Uninit();
    expect(controller.stop).toHaveBeenCalled();
    await device.onOAuth2Deleted();
    expect(controller.stop).toHaveBeenCalledTimes(2);
  });
});

describe('a restore that fails', () => {
  test('is retried every few minutes and given up a day after its time', async () => {
    const { device, timers } = await heatPump();
    await boostsOf(device).boostHotWater(55, 30);
    device.oAuth2Client.executeCommand.mockRejectedValue(new Error('HTTP 503'));

    await later(timers, 30 * MINUTE);
    expect(device.error).toHaveBeenCalledWith('Could not restore after the temporary change (hotWater):', expect.any(Error));
    expect(device.getStoreValue(STORE_KEY).hotWater).toBeDefined();
    expect([...timers.timers.values()].map((timer) => timer.at)).toEqual([clock.now + RETRY_MS]);

    device.oAuth2Client.executeCommand.mockResolvedValue({ data: { success: true } });
    await later(timers, RETRY_MS);
    expect(sent(device).at(-1)).toEqual(['setTargetTemperature', { temperature: 45 }]);
    expect(device.getStoreValue(STORE_KEY)).toEqual({});
  });

  test('gives up after a day', async () => {
    const { device, timers } = await heatPump();
    await boostsOf(device).boostHotWater(55, 30);
    device.oAuth2Client.executeCommand.mockRejectedValue(new Error('HTTP 503'));
    await later(timers, 30 * MINUTE);
    clock.now += GIVE_UP_MS;
    await later(timers, RETRY_MS);
    expect(device.error).toHaveBeenCalledWith('Giving up restoring hotWater');
    expect(device.getStoreValue(STORE_KEY)).toEqual({});
    expect(timers.timers.size).toBe(0);
  });

  test('waits while the value is unknown', async () => {
    const { device, timers } = await heatPump();
    await boostsOf(device).boostHotWater(55, 30);
    device.__values.set(TARGET, null);
    await later(timers, 30 * MINUTE);
    expect(device.getStoreValue(STORE_KEY).hotWater).toBeDefined();
    device.__values.set(TARGET, 55);
    await later(timers, RETRY_MS);
    expect(sent(device).at(-1)).toEqual(['setTargetTemperature', { temperature: 45 }]);
  });
});

describe('heating curve shift', () => {
  test('changes the shift for a while and restores it, even when the hourly limit is used up', async () => {
    const { device, timers } = await heatPump();
    await boostsOf(device).boostCurveShift(3, 60);
    expect(sent(device)).toEqual([['setCurve', { slope: 0.9, shift: -5 }]]);
    expect(device.getStoreValue(STORE_KEY).curveShift).toEqual({ previous: -8, boosted: -5, until: clock.now + 60 * MINUTE });

    // Use up the hourly heating curve changes
    device._writeLimiters.heatingCurve.times.push(...Array(WRITE_LIMITS.heatingCurve - 1).fill(clock.now));
    await later(timers, 60 * MINUTE);
    expect(sent(device).at(-1)).toEqual(['setCurve', { slope: 0.9, shift: -8 }]);
    expect(device.getCapabilityValue(SHIFT)).toBe(-8);
  });

  test('a lower shift for expensive hours works the same way', async () => {
    const { device } = await heatPump();
    await boostsOf(device).boostCurveShift(-2, 60);
    expect(sent(device)).toEqual([['setCurve', { slope: 0.9, shift: -10 }]]);
  });

  test('a shift changed in the meantime is left as it is', async () => {
    const { device, timers } = await heatPump();
    await boostsOf(device).boostCurveShift(3, 60);
    device.__values.set(SHIFT, 0);
    await later(timers, 60 * MINUTE);
    expect(sent(device)).toHaveLength(1);
    expect(device.log).toHaveBeenCalledWith('Heating curve shift was changed in the meantime, leaving it as it is');
  });

  test('a second boost is counted from the original shift', async () => {
    const { device } = await heatPump();
    await boostsOf(device).boostCurveShift(3, 60);
    await boostsOf(device).boostCurveShift(2, 60);
    expect(sent(device).map(([, body]) => body.shift)).toEqual([-5, -6]);
    expect(device.getStoreValue(STORE_KEY).curveShift.previous).toBe(-8);
  });
});

describe('one-time hot water charge', () => {
  test('starts a charge and stops it after the minutes if it still runs', async () => {
    const { device, timers } = await heatPump();
    await boostsOf(device).boostHotWaterCharge(45);
    expect(sent(device)).toEqual([['activate', {}]]);
    expect(device.getCapabilityValue(CHARGE)).toBe('activate');
    await later(timers, 45 * MINUTE);
    expect(sent(device)).toEqual([['activate', {}], ['deactivate', {}]]);
  });

  test('a charge that already ended is not touched', async () => {
    const { device, timers } = await heatPump();
    await boostsOf(device).boostHotWaterCharge(45);
    device.__values.set(CHARGE, 'deactivate');
    await later(timers, 45 * MINUTE);
    expect(sent(device)).toEqual([['activate', {}]]);
    expect(device.getStoreValue(STORE_KEY)).toEqual({});
  });

  test('a charge that already runs is not started again', async () => {
    const { device } = await heatPump();
    device.__values.set(CHARGE, 'activate');
    await boostsOf(device).boostHotWaterCharge(45);
    expect(sent(device)).toEqual([]);
    expect(device.getStoreValue(STORE_KEY).hotWaterCharge).toBeDefined();
  });
});

describe('ending boosts', () => {
  test('restores everything right away', async () => {
    const { device, timers } = await heatPump();
    await boostsOf(device).boostHotWater(55, 30);
    await boostsOf(device).boostCurveShift(2, 30);
    await boostsOf(device).endAll();
    expect(sent(device).slice(2)).toEqual([
      ['setTargetTemperature', { temperature: 45 }],
      ['setCurve', { slope: 0.9, shift: -8 }],
    ]);
    expect(device.getStoreValue(STORE_KEY)).toEqual({});
    expect(timers.timers.size).toBe(0);
  });

  test('tries every restore and reports the first failure; the failed one is retried later', async () => {
    const { device, timers } = await heatPump();
    await boostsOf(device).boostHotWater(55, 30);
    await boostsOf(device).boostCurveShift(2, 30);
    device.oAuth2Client.executeCommand.mockRejectedValueOnce(new Error('HTTP 503'));
    await expect(boostsOf(device).endAll()).rejects.toThrow('HTTP 503');
    expect(Object.keys(device.getStoreValue(STORE_KEY))).toEqual(['hotWater']);
    expect([...timers.timers.values()].map((timer) => timer.at)).toEqual([clock.now + RETRY_MS]);
  });

  test('with nothing running, nothing happens', async () => {
    const { device } = await heatPump();
    await expect(boostsOf(device).endAll()).resolves.toBeUndefined();
    expect(sent(device)).toEqual([]);
  });
});

test('a controller reads an odd store as no restores', () => {
  const controller = new BoostController({ getStoreValue: () => 'garbage' });
  expect(controller.restores()).toEqual({});
});
