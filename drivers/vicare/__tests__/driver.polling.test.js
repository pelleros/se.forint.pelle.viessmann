/* eslint-env jest */
/* eslint-disable max-classes-per-file */

'use strict';

// Covers the polling loop in driver.js: which feature request each poll makes,
// how poll errors change the device's availability, and that polling stops cleanly
// when the device is deleted.

jest.mock('homey-oauth2app', () => ({
  OAuth2Driver: class {

    constructor() {
      this.log = jest.fn();
      this.error = jest.fn();
      this.homey = {
        setInterval: jest.fn(() => ({ timer: true })),
        clearInterval: jest.fn(),
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
}));

const ViessmannDriver = require('../driver');
const ViessmannDevice = require('../device');
const { PATHS } = require('../config');

const DEVICE_KEY = '123456-0000000000000000-0';
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

// Starts polling (which polls once immediately) and returns a function that runs the next poll
async function startPolling(driver, device) {
  await driver._startPolling(device, DEVICE_KEY, POLL_INTERVAL);
  expect(driver.homey.setInterval).toHaveBeenCalledWith(expect.any(Function), POLL_INTERVAL);
  const [doPoll] = driver.homey.setInterval.mock.calls[driver.homey.setInterval.mock.calls.length - 1];
  return doPoll;
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
    expect(device.getFeatures).toHaveBeenCalledWith(true);
    expect(device.onFeaturesUpdated).toHaveBeenCalledWith(response, false);
  });

  test('an extended poll requests all features', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(EXTENDED);
    const driver = createDriver();
    const device = createPolledDevice();
    const response = { data: [{ feature: 'heating.some.future.feature' }] };
    device.getFeatures.mockResolvedValue(response);

    await startPolling(driver, device);

    expect(device.getFeatures).toHaveBeenCalledWith(false);
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
});

describe('ViessmannDriver polling errors', () => {
  beforeEach(() => {
    jest.spyOn(Math, 'random').mockReturnValue(REGULAR);
  });

  test('marks the device as needing re-authentication on an unauthorized error', async () => {
    const driver = createDriver();
    const device = createPolledDevice();
    // Message produced by ViessmannOAuth2Client.onHandleNotOK for HTTP 401
    device.getFeatures.mockRejectedValue(new Error('Unauthorized - check credentials'));

    await startPolling(driver, device);

    expect(device.setUnavailable).toHaveBeenCalledTimes(1);
    expect(device.setUnavailable).toHaveBeenCalledWith('Authentication failed');
  });

  test('recognises a 401 status even when the message differs', async () => {
    const driver = createDriver();
    const device = createPolledDevice();
    const error = new Error('Token expired');
    error.status = 401;
    device.getFeatures.mockRejectedValue(error);

    await startPolling(driver, device);

    expect(device.setUnavailable).toHaveBeenCalledWith('Authentication failed');
  });

  test('other errors only make the device unavailable after three failures in a row', async () => {
    const driver = createDriver();
    const device = createPolledDevice();
    device.getFeatures.mockRejectedValue(new Error('Rate limit exceeded'));

    const doPoll = await startPolling(driver, device);
    await doPoll();
    expect(device.setUnavailable).not.toHaveBeenCalled();

    await doPoll();
    expect(device.setUnavailable).toHaveBeenCalledTimes(1);
    expect(device.setUnavailable).toHaveBeenCalledWith('Multiple communication errors');
  });

  test('a successful poll resets the error count and makes the device available again', async () => {
    const driver = createDriver();
    const device = createPolledDevice();
    device.getFeatures.mockRejectedValueOnce(new Error('Unauthorized - check credentials'));

    const doPoll = await startPolling(driver, device);
    expect(device.getAvailable()).toBe(false);

    await doPoll();
    expect(device.setAvailable).toHaveBeenCalled();
    expect(device.getAvailable()).toBe(true);
  });

  test('errors without a message do not break the poll loop', async () => {
    const driver = createDriver();
    const device = createPolledDevice();
    device.getFeatures.mockRejectedValue({ code: 'ECONNRESET' });

    const doPoll = await startPolling(driver, device);
    await expect(doPoll()).resolves.toBeUndefined();
    expect(driver.error).toHaveBeenCalled();
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
    const timerTick = await startPolling(driver, device);
    const [timer] = driver.homey.setInterval.mock.results.map((result) => result.value);
    expect(driver._devicePollers.has(DEVICE_KEY)).toBe(true);

    await device.onOAuth2Deleted();

    expect(driver.homey.clearInterval).toHaveBeenCalledWith(timer);
    expect(driver._devicePollers.has(DEVICE_KEY)).toBe(false);

    // A tick that was already queued when the device was deleted does nothing
    device.oAuth2Client.getFeatures.mockClear();
    await timerTick();
    expect(device.oAuth2Client.getFeatures).not.toHaveBeenCalled();
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
    const timerTick = await startPolling(driver, device);

    let rejectRequest;
    device.oAuth2Client.getFeatures.mockImplementationOnce(() => new Promise((resolve, reject) => {
      rejectRequest = reject;
    }));
    const tick = timerTick();
    await device.onOAuth2Deleted();
    rejectRequest(new Error('Unauthorized - check credentials'));
    await tick;

    expect(device.setUnavailable).not.toHaveBeenCalled();
    expect(driver.error).not.toHaveBeenCalled();
  });

  test('a device deleted during the first poll never gets a poll timer', async () => {
    const driver = createDriver();
    const device = createDeletableDevice(driver);
    device.oAuth2Client.getFeatures.mockImplementationOnce(async () => {
      await device.onOAuth2Deleted();
      return { data: [] };
    });

    await driver._startPolling(device, DEVICE_KEY, POLL_INTERVAL);

    expect(driver.homey.setInterval).not.toHaveBeenCalled();
    expect(driver._devicePollers.has(DEVICE_KEY)).toBe(false);
    expect(device.onFeaturesUpdated).not.toHaveBeenCalled();
  });

  test('a rejected setUnavailable (device_not_found) is logged, not an unhandled rejection', async () => {
    const driver = createDriver();
    const device = createPolledDevice();
    device.getFeatures.mockRejectedValue(new Error('Rate limit exceeded'));
    const deviceNotFound = new Error('device_not_found');
    device.setUnavailable.mockRejectedValue(deviceNotFound);

    const rejections = await collectUnhandledRejections(async () => {
      const timerTick = await startPolling(driver, device);
      await timerTick();
      await expect(timerTick()).resolves.toBeUndefined(); // third failure: setUnavailable rejects
    });

    expect(rejections).toEqual([]);
    expect(device.setUnavailable).toHaveBeenCalledWith('Multiple communication errors');
    expect(driver.error).toHaveBeenCalledWith(expect.stringContaining(DEVICE_KEY), deviceNotFound);
  });

  test('a rejected setAvailable is logged, not an unhandled rejection', async () => {
    const driver = createDriver();
    const device = createPolledDevice();
    device.getAvailable.mockReturnValue(false);
    const deviceNotFound = new Error('device_not_found');
    device.setAvailable.mockRejectedValue(deviceNotFound);

    const rejections = await collectUnhandledRejections(async () => {
      const timerTick = await startPolling(driver, device);
      await expect(timerTick()).resolves.toBeUndefined();
    });

    expect(rejections).toEqual([]);
    expect(driver.error).toHaveBeenCalledWith(expect.stringContaining(DEVICE_KEY), deviceNotFound);
  });
});
