/* eslint-env jest */

'use strict';

// Locks the API quota of the poller (driver.js + lib/DevicePoller.js). Viessmann's free plan
// allows about 1,450 calls per day per ViCare user, shared by all devices of that user. The app
// polls each device every 2 minutes × the number of devices, about 720 calls per day in total,
// whatever the number of devices. Simulated with fake timers over whole days.

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const ViessmannDriver = require('../driver');
const { apiError } = require('../../../lib/apiError');
const { POLL_TIMEOUT, STOP_TIMEOUT } = require('../../../lib/DevicePoller');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const BASE_INTERVAL = 2 * MINUTE; // per device, multiplied by the number of devices
const TARGET_PER_DAY = 720;
const MAX_PER_DAY = 800;

// A driver with real (fake-timer) scheduling. `known` is what driver.getDevices() returns.
function createDriver() {
  const driver = new ViessmannDriver();
  const known = [];
  driver.getDevices = () => known;
  // Jest's fake timers, installed in beforeEach
  driver.homey = { setTimeout, clearTimeout, error: jest.fn() };
  return { driver, known };
}

// A device that records when it is polled; `respond` may throw to simulate API errors
function createDevice(name, respond = async () => ({ data: [] })) {
  const polls = [];
  return {
    name,
    polls,
    getFeatures: jest.fn(async () => {
      polls.push(Date.now());
      return respond(polls.length);
    }),
    onFeaturesUpdated: jest.fn(async () => {}),
    getAvailable: () => true,
    setAvailable: jest.fn(async () => {}),
    setUnavailable: jest.fn(async () => {}),
  };
}

// What onOAuth2Init does for polling (it polls once right away)
const startDevice = (driver, device) => driver._startPolling(device, device.name);

const callsBetween = (devices, from, to) => devices
  .reduce((sum, device) => sum + device.polls.filter((time) => time >= from && time < to).length, 0);
const gaps = (times) => times.slice(1).map((time, index) => time - times[index]);
const devicesNamed = (count, prefix = 'device') => Array.from({ length: count }, (_, index) => createDevice(`${prefix}-${index}`));

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(0);
  jest.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(async () => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe.each([1, 2, 3, 4, 5])('%i device(s)', (count) => {
  const interval = BASE_INTERVAL * count;

  test.each([
    ['all devices are known before they initialise', true],
    ['devices become known one by one while they initialise', false],
  ])('app start where %s stays within the daily quota', async (_, knownUpfront) => {
    const { driver, known } = createDriver();
    const devices = devicesNamed(count);
    if (knownUpfront) known.push(...devices);

    for (const device of devices) {
      if (!knownUpfront) known.push(device);
      await startDevice(driver, device);
    }
    await jest.advanceTimersByTimeAsync(DAY);

    const calls = callsBetween(devices, 0, DAY);
    expect(calls).toBeLessThanOrEqual(MAX_PER_DAY);
    expect(calls).toBeGreaterThanOrEqual(TARGET_PER_DAY - count); // keeps polling
    for (const device of devices) {
      // After the first scheduling every device polls every 2 minutes × the number of devices
      gaps(device.polls).slice(1).forEach((gap) => expect(gap).toBe(interval));
      expect(Math.min(...gaps(device.polls))).toBeGreaterThanOrEqual(BASE_INTERVAL);
    }
  });

  test('backoff and Retry-After never poll more often than the normal interval', async () => {
    const { driver, known } = createDriver();
    const others = devicesNamed(count - 1, 'other');
    // Errors in turn: a short Retry-After, Retry-After 0, a network error, then a long
    // Retry-After, then the API works again
    const errors = [
      () => apiError({ status: 429, headers: { get: () => '1' } }),
      () => apiError({ status: 429, headers: { get: () => '0' } }),
      () => new Error('socket hang up'),
      () => apiError({ status: 503 }),
      () => apiError({ status: 429, headers: { get: () => String(5 * 60 * 60) } }),
    ];
    const failing = createDevice('failing', async (attempt) => {
      if (attempt <= errors.length) throw errors[attempt - 1]();
      return { data: [] };
    });
    known.push(...others, failing);
    for (const device of [...others, failing]) await startDevice(driver, device);

    await jest.advanceTimersByTimeAsync(DAY);

    const failingGaps = gaps(failing.polls);
    failingGaps.forEach((gap) => expect(gap).toBeGreaterThanOrEqual(interval));
    // The long Retry-After (5 hours) is honoured
    expect(failingGaps[errors.length - 1]).toBeGreaterThanOrEqual(5 * HOUR);
    // After the API works again the normal interval returns
    failingGaps.slice(errors.length).forEach((gap) => expect(gap).toBe(interval));
    expect(callsBetween([...others, failing], 0, DAY)).toBeLessThanOrEqual(MAX_PER_DAY);
  });

  test('a device that keeps failing polls less often, never more', async () => {
    const { driver, known } = createDriver();
    const devices = Array.from({ length: count }, (_, index) => createDevice(`down-${index}`, async () => {
      throw apiError({ status: 429, headers: { get: () => '1' } });
    }));
    known.push(...devices);
    for (const device of devices) await startDevice(driver, device);

    await jest.advanceTimersByTimeAsync(DAY);

    for (const device of devices) {
      gaps(device.polls).forEach((gap) => expect(gap).toBeGreaterThanOrEqual(interval));
    }
    expect(callsBetween(devices, 0, DAY)).toBeLessThanOrEqual(TARGET_PER_DAY);
  });
});

describe.each([2, 3, 4, 5])('adding device number %i while the others poll', (count) => {
  test('existing pollers slow down at their next scheduling and the quota holds', async () => {
    const { driver, known } = createDriver();
    const existing = devicesNamed(count - 1, 'existing');
    known.push(...existing);
    for (const device of existing) await startDevice(driver, device);
    await jest.advanceTimersByTimeAsync(6 * HOUR + 17 * 1000);

    const addedAt = Date.now();
    const added = createDevice('added');
    known.push(added);
    await startDevice(driver, added);
    await jest.advanceTimersByTimeAsync(DAY);

    const newInterval = BASE_INTERVAL * count;
    const oldInterval = BASE_INTERVAL * (count - 1);
    for (const device of existing) {
      const after = device.polls.filter((time) => time >= addedAt);
      // The poll that was already scheduled happens at the old interval ...
      expect(after[0] - addedAt).toBeLessThanOrEqual(oldInterval);
      // ... and from then on the device polls at the new, slower interval
      gaps(after).forEach((gap) => expect(gap).toBe(newInterval));
    }
    gaps(added.polls).forEach((gap) => expect(gap).toBe(newInterval));

    expect(callsBetween([...existing, added], addedAt, addedAt + DAY)).toBeLessThanOrEqual(MAX_PER_DAY);
  });
});

describe('requests that never answer (e.g. a half-open connection)', () => {
  test('polling goes on, never faster than normal, and stopping does not hang', async () => {
    const { driver, known } = createDriver();
    const hanging = createDevice('hanging', () => new Promise(() => {}));
    const healthy = createDevice('healthy');
    known.push(hanging, healthy);
    const started = startDevice(driver, hanging);
    await jest.advanceTimersByTimeAsync(POLL_TIMEOUT);
    await started;
    await startDevice(driver, healthy);

    await jest.advanceTimersByTimeAsync(DAY);

    // Backoff up to 30 minutes plus the poll deadline: about 45 polls a day instead of none
    expect(hanging.polls.length).toBeGreaterThan(40);
    gaps(hanging.polls).forEach((gap) => expect(gap).toBeGreaterThanOrEqual(2 * BASE_INTERVAL));
    expect(healthy.polls.length).toBeGreaterThanOrEqual(TARGET_PER_DAY / 2);
    expect(hanging.setUnavailable).toHaveBeenCalledWith('Multiple communication errors');

    // Deleting the device while one of its polls hangs
    const poller = driver._devicePollers.get('hanging');
    while (!poller.running) await jest.advanceTimersByTimeAsync(MINUTE);
    let stopped = false;
    driver._stopPolling('hanging').then(() => {
      stopped = true;
    }, () => {});
    await jest.advanceTimersByTimeAsync(STOP_TIMEOUT);
    expect(stopped).toBe(true);
    const polls = hanging.polls.length;
    await jest.advanceTimersByTimeAsync(DAY);
    expect(hanging.polls).toHaveLength(polls);
  });
});
