/* eslint-env jest */
/* eslint-disable max-classes-per-file */

'use strict';

// Covers the polling loop in driver.js: which feature request each poll makes
// and how poll errors change the device's availability.

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
