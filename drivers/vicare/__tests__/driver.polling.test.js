/* eslint-env jest */
/* eslint-disable max-classes-per-file */

'use strict';

// Covers the polling loop in driver.js: which feature request each poll makes.

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
