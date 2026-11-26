/* eslint-env jest */
/* eslint-disable max-classes-per-file */

'use strict';

// Covers the polling loop in driver.js (lib/DevicePoller.js does the scheduling): which
// feature request each poll makes, how poll errors change the device's availability, and
// that polling stops cleanly when the device is deleted.

jest.mock('homey-oauth2app', () => ({
  OAuth2Driver: class {

    constructor() {
      this.log = jest.fn();
      this.error = jest.fn();
      let nextTimer = 0;
      this.homey = {
        // Timers are recorded, not run: tests run the scheduled poll themselves
        setTimeout: jest.fn(() => {
          nextTimer += 1;
          return { timer: nextTimer };
        }),
        clearTimeout: jest.fn(),
        error: jest.fn(),
      };
      this.getDevices = jest.fn(() => []);
    }

  },
  OAuth2Device: class {

    constructor() {
      this.log = jest.fn();
      this.error = jest.fn();
    }

  },
  OAuth2Error: class extends Error {},
}));

const ViessmannDriver = require('../driver');
const ViessmannDevice = require('../device');
const { apiError, tokenError } = require('../../../lib/apiError');

const REPAIR = 'Authentication failed, open the device and choose Repair';
const { PATHS } = require('../config');

const DEVICE_KEY = '123456-0000000000000000-0';
// The log shows the device key with the installation id and gateway serial masked
const LOGGED_KEY = '…456-…000-0';
const expectNoIdsLogged = (driver) => {
  const logged = JSON.stringify([...driver.log.mock.calls, ...driver.error.mock.calls].map((call) => call.map(String)));
  expect(logged).not.toContain('123456');
  expect(logged).not.toContain('0000000000000000');
};
const POLL_INTERVAL = 120000;
const EXTENDED = 0.01; // Math.random() below 0.03 triggers an extended poll
const REGULAR = 0.5;

const createDriver = () => new ViessmannDriver();

function createPolledDevice() {
  let available = true;
  return {
    getFeatures: jest.fn(async () => ({ data: [] })),
    onFeaturesUpdated: jest.fn(async () => {}),
    getAvailable: jest.fn(() => available),
    setAvailable: jest.fn(async () => {
      available = true;
    }),
    setUnavailable: jest.fn(async () => {
      available = false;
    }),
  };
}

// The timers that schedule the next poll (the poll deadline and stop timers are shorter)
function pollTimers(driver) {
  const { calls, results } = driver.homey.setTimeout.mock;
  return calls
    .map(([callback, ms], index) => ({ callback, ms, handle: results[index].value }))
    .filter(({ ms }) => ms >= POLL_INTERVAL);
}

// Waits until the poller has no poll in progress
async function waitForPoll(poller) {
  while (poller.running) await poller.running;
  await new Promise((resolve) => setImmediate(resolve));
}

// Starts polling (which polls once immediately) and returns a function that runs the next
// scheduled poll the way its timer would: the timer callback ignores the poll's promise
async function startPolling(driver, device) {
  await driver._startPolling(device, DEVICE_KEY);
  const poller = driver._devicePollers.get(DEVICE_KEY);
  return async () => {
    const timers = pollTimers(driver);
    timers[timers.length - 1].callback();
    await waitForPoll(poller);
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ViessmannDriver polling feature requests', () => {
  test('a regular poll requests the filtered feature list', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(REGULAR);
    const driver = createDriver();
    const device = createPolledDevice();
    const response = { data: [{ feature: PATHS.OUTSIDE_TEMP }] };
    device.getFeatures.mockResolvedValue(response);

    await startPolling(driver, device);

    expect(device.getFeatures).toHaveBeenCalledTimes(1);
    expect(device.getFeatures).toHaveBeenCalledWith({ useFilter: true });
    expect(device.onFeaturesUpdated).toHaveBeenCalledWith(response, false);
    expect(pollTimers(driver).pop().ms).toBe(POLL_INTERVAL);
  });

  test('an extended poll requests all features', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(EXTENDED);
    const driver = createDriver();
    const device = createPolledDevice();
    const response = { data: [{ feature: 'heating.some.future.feature' }] };
    device.getFeatures.mockResolvedValue(response);

    await startPolling(driver, device);

    expect(device.getFeatures).toHaveBeenCalledWith({ useFilter: false });
    expect(device.onFeaturesUpdated).toHaveBeenCalledWith(response, true);
  });

  test.each([
    ['regular', REGULAR, Object.values(PATHS).join(',')],
    ['extended', EXTENDED, undefined],
  ])('a %s poll reaches the API client with the right filter', async (_, random, expectedFilter) => {
    jest.spyOn(Math, 'random').mockReturnValue(random);
    const driver = createDriver();
    const device = new ViessmannDevice();
    device._installationId = 123456;
    device._gatewaySerial = '0000000000000000';
    device._deviceId = '0';
    device.oAuth2Client = { getFeatures: jest.fn(async () => ({ data: [] })) };
    device.getAvailable = jest.fn(() => true);
    device.setAvailable = jest.fn();
    device.setUnavailable = jest.fn();
    device.onFeaturesUpdated = jest.fn(async () => {});

    await startPolling(driver, device);

    expect(device.oAuth2Client.getFeatures).toHaveBeenCalledTimes(1);
    expect(device.oAuth2Client.getFeatures.mock.calls[0][0].filter).toBe(expectedFilter);
  });

  test('starting an already polling device reschedules it without an extra poll', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(REGULAR);
    const driver = createDriver();
    const device = createPolledDevice();
    await startPolling(driver, device);
    const poller = driver._devicePollers.get(DEVICE_KEY);

    await driver._startPolling(device, DEVICE_KEY);

    expect(driver._devicePollers.get(DEVICE_KEY)).toBe(poller);
    expect(device.getFeatures).toHaveBeenCalledTimes(1);
    const timers = pollTimers(driver);
    expect(timers).toHaveLength(2);
    expect(driver.homey.clearTimeout).toHaveBeenCalledWith(timers[0].handle);
  });
});

describe('ViessmannDriver polling errors', () => {
  beforeEach(() => {
    jest.spyOn(Math, 'random').mockReturnValue(REGULAR);
  });

  test('marks the device as needing re-authentication on an unauthorized error', async () => {
    const driver = createDriver();
    const device = createPolledDevice();
    // Message of the pre-1.0.15 ViessmannOAuth2Client for HTTP 401
    device.getFeatures.mockRejectedValue(new Error('Unauthorized - check credentials'));

    await startPolling(driver, device);

    expect(device.setUnavailable).toHaveBeenCalledTimes(1);
    expect(device.setUnavailable).toHaveBeenCalledWith(REPAIR);
  });

  test('recognises a 401 status even when the message differs', async () => {
    const driver = createDriver();
    const device = createPolledDevice();
    device.getFeatures.mockRejectedValue(apiError({ status: 401 }));

    await startPolling(driver, device);

    expect(device.setUnavailable).toHaveBeenCalledWith(REPAIR);
  });

  test.each([
    ['invalid_grant (HTTP 400)', { status: 400, body: { error: 'invalid_grant', error_description: 'Invalid grant' } }],
    ['invalid_client (HTTP 401)', { status: 401, body: { error: 'invalid_client' } }],
    ['no stored refresh token', { status: 401, body: { message: 'No refresh token stored' } }],
  ])('a refresh token the IdP rejects (%s) asks for Repair right away', async (_, response) => {
    const driver = createDriver();
    const device = createPolledDevice();
    device.getFeatures.mockRejectedValue(tokenError(response));

    await startPolling(driver, device);

    expect(device.setUnavailable).toHaveBeenCalledTimes(1);
    expect(device.setUnavailable).toHaveBeenCalledWith(REPAIR);
  });

  test.each([
    ['the IdP answers HTTP 503', () => tokenError({ status: 503, statusText: 'Service Unavailable', body: '<html></html>' })],
    ['the IdP answers another 4xx', () => tokenError({ status: 400, body: { error: 'invalid_request' } })],
    ['the token request times out', () => Object.assign(new Error('network timeout at: https://iam.example/token'), { type: 'request-timeout' })],
    ['the token request has no network', () => Object.assign(new Error('request to https://iam.example/token failed, reason: ENOTFOUND'), { code: 'ENOTFOUND' })],
  ])('a temporary refresh failure (%s) backs off without a Repair prompt', async (_, createError) => {
    const driver = createDriver();
    const device = createPolledDevice();
    device.getFeatures.mockRejectedValue(createError());

    const nextPoll = await startPolling(driver, device);
    expect(pollTimers(driver).pop().ms).toBe(2 * POLL_INTERVAL);
    await nextPoll();
    expect(device.setUnavailable).not.toHaveBeenCalled();
    await nextPoll();
    expect(device.setUnavailable).toHaveBeenCalledTimes(1);
    expect(device.setUnavailable.mock.calls[0][0]).not.toMatch(/Repair|Authentication failed/);
  });

  test('other errors only make the device unavailable after three failures in a row', async () => {
    const driver = createDriver();
    const device = createPolledDevice();
    device.getFeatures.mockRejectedValue(new Error('socket hang up'));

    const nextPoll = await startPolling(driver, device);
    await nextPoll();
    expect(device.setUnavailable).not.toHaveBeenCalled();

    await nextPoll();
    expect(device.setUnavailable).toHaveBeenCalledTimes(1);
    // Network errors can contain request URLs with installation ids: use a generic message
    expect(device.setUnavailable).toHaveBeenCalledWith('Multiple communication errors');
  });

  test('after three failures an API error shows its own (safe) message', async () => {
    const driver = createDriver();
    const device = createPolledDevice();
    const error = apiError({ status: 503, statusText: 'Service Unavailable' });
    device.getFeatures.mockRejectedValue(error);

    const nextPoll = await startPolling(driver, device);
    await nextPoll();
    await nextPoll();

    expect(device.setUnavailable).toHaveBeenCalledWith('Viessmann HTTP 503: Service Unavailable');
  });

  test('backs off after failures and returns to the normal interval after a success', async () => {
    const driver = createDriver();
    const device = createPolledDevice();
    device.getFeatures.mockRejectedValueOnce(new Error('socket hang up'));

    const nextPoll = await startPolling(driver, device);
    expect(pollTimers(driver).pop().ms).toBe(2 * POLL_INTERVAL);

    await nextPoll();
    expect(pollTimers(driver).pop().ms).toBe(POLL_INTERVAL);
  });

  test('a successful poll resets the error count and makes the device available again', async () => {
    const driver = createDriver();
    const device = createPolledDevice();
    device.getFeatures.mockRejectedValueOnce(new Error('Unauthorized - check credentials'));

    const nextPoll = await startPolling(driver, device);
    expect(device.getAvailable()).toBe(false);

    await nextPoll();
    expect(device.setAvailable).toHaveBeenCalled();
    expect(device.getAvailable()).toBe(true);
  });

  test.each([
    ['an object without a message', { code: 'ECONNRESET' }],
    ['undefined', undefined],
  ])('a rejection with %s does not break the poll loop', async (_, rejection) => {
    const driver = createDriver();
    const device = createPolledDevice();
    device.getFeatures.mockRejectedValue(rejection);

    const nextPoll = await startPolling(driver, device);
    await expect(nextPoll()).resolves.toBeUndefined();
    await nextPoll();
    expect(driver.error).toHaveBeenCalled();
    expect(device.getFeatures).toHaveBeenCalledTimes(3);
  });
});

describe('ViessmannDriver polling after the device is deleted', () => {
  beforeEach(() => {
    jest.spyOn(Math, 'random').mockReturnValue(REGULAR);
  });

  // Collects unhandled promise rejections while `run` executes (a poll timer ignores the
  // promise its callback returns, so a rejection there crashes the app on Homey)
  async function collectUnhandledRejections(run) {
    const rejections = [];
    const onUnhandledRejection = (reason) => rejections.push(reason);
    process.on('unhandledRejection', onUnhandledRejection);
    try {
      await run();
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
    return rejections;
  }

  function createDeletableDevice(driver) {
    const device = new ViessmannDevice();
    device.driver = driver;
    device._installationId = 123456;
    device._gatewaySerial = '0000000000000000';
    device._deviceId = '0';
    device.oAuth2Client = { getFeatures: jest.fn(async () => ({ data: [] })) };
    device.getAvailable = jest.fn(() => true);
    device.setAvailable = jest.fn(async () => {});
    device.setUnavailable = jest.fn(async () => {});
    device.onFeaturesUpdated = jest.fn(async () => {});
    return device;
  }

  test('deleting the device stops its poller', async () => {
    const driver = createDriver();
    const device = createDeletableDevice(driver);
    const nextPoll = await startPolling(driver, device);
    const [{ handle: timer }] = pollTimers(driver);
    expect(driver._devicePollers.has(DEVICE_KEY)).toBe(true);

    await device.onOAuth2Deleted();

    expect(driver.homey.clearTimeout).toHaveBeenCalledWith(timer);
    expect(driver._devicePollers.has(DEVICE_KEY)).toBe(false);

    // A timer that fires anyway after the device was deleted does nothing
    device.oAuth2Client.getFeatures.mockClear();
    await nextPoll();
    expect(device.oAuth2Client.getFeatures).not.toHaveBeenCalled();
    expect(pollTimers(driver)).toHaveLength(1);
  });

  test('unloading the device still stops its poller', async () => {
    const driver = createDriver();
    const device = createDeletableDevice(driver);
    await startPolling(driver, device);

    await device.onOAuth2Uninit();

    expect(driver._devicePollers.has(DEVICE_KEY)).toBe(false);
  });

  test('a poll in progress when the device is deleted leaves the device alone', async () => {
    const driver = createDriver();
    const device = createDeletableDevice(driver);
    const nextPoll = await startPolling(driver, device);

    let rejectRequest;
    device.oAuth2Client.getFeatures.mockImplementationOnce(() => new Promise((resolve, reject) => {
      rejectRequest = reject;
    }));
    const poll = nextPoll();
    const deleted = device.onOAuth2Deleted();
    rejectRequest(new Error('Unauthorized - check credentials'));
    await Promise.all([poll, deleted]);

    expect(device.setUnavailable).not.toHaveBeenCalled();
    expect(driver.error).not.toHaveBeenCalled();
    expect(pollTimers(driver)).toHaveLength(1);
  });

  test('a device deleted during the first poll never gets a poll timer', async () => {
    const driver = createDriver();
    const device = createDeletableDevice(driver);
    let resolveRequest;
    device.oAuth2Client.getFeatures.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRequest = resolve;
    }));

    const started = driver._startPolling(device, DEVICE_KEY);
    const deleted = device.onOAuth2Deleted();
    resolveRequest({ data: [] });
    await Promise.all([started, deleted]);

    expect(pollTimers(driver)).toHaveLength(0);
    expect(driver._devicePollers.has(DEVICE_KEY)).toBe(false);
    expect(device.onFeaturesUpdated).not.toHaveBeenCalled();
  });

  test('a rejected setUnavailable (device_not_found) is logged, not an unhandled rejection', async () => {
    const driver = createDriver();
    const device = createPolledDevice();
    device.getFeatures.mockRejectedValue(new Error('socket hang up'));
    const deviceNotFound = new Error('device_not_found');
    device.setUnavailable.mockRejectedValue(deviceNotFound);

    const rejections = await collectUnhandledRejections(async () => {
      const nextPoll = await startPolling(driver, device);
      await nextPoll();
      await expect(nextPoll()).resolves.toBeUndefined(); // third failure: setUnavailable rejects
    });

    expect(rejections).toEqual([]);
    expect(device.setUnavailable).toHaveBeenCalledWith('Multiple communication errors');
    expect(driver.error).toHaveBeenCalledWith(expect.stringContaining(LOGGED_KEY), deviceNotFound);
    expectNoIdsLogged(driver);
  });

  test('a rejected setAvailable is logged, not an unhandled rejection', async () => {
    const driver = createDriver();
    const device = createPolledDevice();
    device.getAvailable.mockReturnValue(false);
    const deviceNotFound = new Error('device_not_found');
    device.setAvailable.mockRejectedValue(deviceNotFound);

    const rejections = await collectUnhandledRejections(async () => {
      const nextPoll = await startPolling(driver, device);
      await expect(nextPoll()).resolves.toBeUndefined();
    });

    expect(rejections).toEqual([]);
    expect(driver.error).toHaveBeenCalledWith(expect.stringContaining(LOGGED_KEY), deviceNotFound);
    expectNoIdsLogged(driver);
  });
});
