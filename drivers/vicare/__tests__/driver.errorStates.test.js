/* eslint-env jest */

'use strict';

// What the user sees, and how often the app polls, when Viessmann refuses access to the account
// (HTTP 402), the API quota is used up (HTTP 429) or the gateway is offline; while polling and
// while adding a device.

const fs = require('fs');
const path = require('path');

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const ViessmannDriver = require('../driver');
const { apiError } = require('../../../lib/apiError');

const FIXTURES_DIR = path.join(__dirname, '../../../test/fixtures');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8'));

const DEVICE_KEY = '900001-9999000000000001-0';
const POLL_INTERVAL = 2 * 60 * 1000;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const NOW = Date.parse('2026-01-15T12:00:00Z'); // 13:00 in Stockholm

const REPAIR = 'Authentication failed, open the device and choose Repair';
const PACKAGE_NOT_PAID = "Viessmann is refusing access to this account's data. "
  + 'This is often a temporary problem at Viessmann; the app tries again every hour. '
  + "If it lasts, contact Viessmann's developer support.";
const PACKAGE_NOT_PAID_PAIRING = "Viessmann is refusing access to this account's data. "
  + "This is often a temporary problem at Viessmann; try again later. If it lasts, contact Viessmann's developer support.";
const GATEWAY_OFFLINE = 'The Viessmann gateway is offline. Check that it has power and an internet connection.';
const apiLimit = (time) => `Viessmann API limit reached, updates resume at ${time}.`;

const packageNotPaid = (message = 'User does not have access to the given feature.') => apiError({
  status: 402, body: { errorType: 'PACKAGE_NOT_PAID_FOR', message, extendedPayload: { clientId: 'x' } },
});
const rateLimited = (retryAfter) => apiError({
  status: 429, headers: { get: (name) => (name.toLowerCase() === 'retry-after' ? retryAfter : null) }, body: { errorType: 'RATE_LIMIT_EXCEEDED' },
});
const gatewayOffline = () => apiError({
  status: 400, body: { errorType: 'DEVICE_COMMUNICATION_ERROR', extendedPayload: { reason: 'GATEWAY_OFFLINE' } },
});

function createDriver() {
  const driver = new ViessmannDriver();
  driver.homey.clock = { getTimezone: () => 'Europe/Stockholm' };
  return driver;
}

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

// The timers that schedule the next poll (the poll deadline is shorter than the interval)
const pollTimers = (driver) => driver.homey.setTimeout.mock.calls
  .map(([callback, ms]) => ({ callback, ms }))
  .filter(({ ms }) => ms >= POLL_INTERVAL);

async function waitForPoll(poller) {
  while (poller.running) await poller.running;
  await new Promise((resolve) => setImmediate(resolve));
}

// Starts polling (one poll right away) and returns a function that runs the next scheduled
// poll the way its timer would, `elapsed` milliseconds later
async function startPolling(driver, device) {
  await driver._startPolling(device, DEVICE_KEY);
  const poller = driver._devicePollers.get(DEVICE_KEY);
  return async () => {
    const timers = pollTimers(driver);
    const { callback, ms } = timers[timers.length - 1];
    Date.now.mockReturnValue(Date.now() + ms);
    callback();
    await waitForPoll(poller);
  };
}

const lastDelay = (driver) => pollTimers(driver).pop().ms;

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  jest.spyOn(Math, 'random').mockReturnValue(0.5); // a regular (filtered) poll
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('polling: Viessmann refuses access to the account (HTTP 402)', () => {
  test('says so right away and polls again after an hour', async () => {
    const driver = createDriver();
    const device = createPolledDevice();
    device.getFeatures.mockRejectedValue(packageNotPaid());

    const nextPoll = await startPolling(driver, device);

    expect(device.setUnavailable).toHaveBeenCalledTimes(1);
    expect(device.setUnavailable).toHaveBeenCalledWith(PACKAGE_NOT_PAID);
    expect(lastDelay(driver)).toBe(HOUR);

    await nextPoll();
    expect(device.setUnavailable).toHaveBeenLastCalledWith(PACKAGE_NOT_PAID);
    expect(lastDelay(driver)).toBe(HOUR);
    expect(device.getFeatures).toHaveBeenCalledTimes(2);
  });

  test('a successful poll makes the device available again at the normal interval', async () => {
    const driver = createDriver();
    const device = createPolledDevice();
    device.getFeatures.mockRejectedValueOnce(packageNotPaid());

    const nextPoll = await startPolling(driver, device);
    await nextPoll();

    expect(device.getAvailable()).toBe(true);
    expect(device.onFeaturesUpdated).toHaveBeenCalled();
    expect(lastDelay(driver)).toBe(POLL_INTERVAL);
  });

  test('is never mistaken for a login problem, whatever its text says', async () => {
    const driver = createDriver();
    const device = createPolledDevice();
    device.getFeatures.mockRejectedValue(packageNotPaid('Unauthorized for this package'));

    await startPolling(driver, device);

    expect(device.setUnavailable).toHaveBeenCalledWith(PACKAGE_NOT_PAID);
    expect(device.setUnavailable).not.toHaveBeenCalledWith(REPAIR);
  });

  test('uses Homey\'s translation', async () => {
    const driver = createDriver();
    driver.homey.__ = jest.fn((key) => `translated ${key}`);
    const device = createPolledDevice();
    device.getFeatures.mockRejectedValue(packageNotPaid());

    await startPolling(driver, device);

    expect(device.setUnavailable).toHaveBeenCalledWith('translated errors.package_not_paid');
  });
});

describe('polling: the API quota is used up (HTTP 429)', () => {
  test('says when updates resume (Homey\'s time) and waits until then', async () => {
    const driver = createDriver();
    const device = createPolledDevice();
    device.getFeatures.mockRejectedValueOnce(rateLimited(String(3 * 60 * 60)));

    const nextPoll = await startPolling(driver, device);

    expect(device.setUnavailable).toHaveBeenCalledWith(apiLimit('16:00'));
    expect(lastDelay(driver)).toBe(3 * HOUR);

    await nextPoll();
    expect(device.getAvailable()).toBe(true);
    expect(lastDelay(driver)).toBe(POLL_INTERVAL);
  });

  test('takes the reset time from the response body', async () => {
    const driver = createDriver();
    const device = createPolledDevice();
    device.getFeatures.mockRejectedValueOnce(apiError({
      status: 429, body: { errorType: 'RATE_LIMIT_EXCEEDED', extendedPayload: { limitReset: NOW + 90 * MINUTE } },
    }));

    await startPolling(driver, device);

    expect(device.setUnavailable).toHaveBeenCalledWith(apiLimit('14:30'));
    expect(lastDelay(driver)).toBe(90 * MINUTE);
  });

  test('a reset sooner than the backoff shows when the next poll really runs', async () => {
    const driver = createDriver();
    const device = createPolledDevice();
    device.getFeatures.mockRejectedValueOnce(rateLimited('1'));

    await startPolling(driver, device);

    // Backoff after one failure: twice the interval
    expect(lastDelay(driver)).toBe(2 * POLL_INTERVAL);
    expect(device.setUnavailable).toHaveBeenCalledWith(apiLimit('13:04'));
  });

  test('without a known reset time it is handled like other errors', async () => {
    const driver = createDriver();
    const device = createPolledDevice();
    device.getFeatures.mockRejectedValue(rateLimited(null));

    const nextPoll = await startPolling(driver, device);
    await nextPoll();
    expect(device.setUnavailable).not.toHaveBeenCalled();

    await nextPoll();
    expect(device.setUnavailable).toHaveBeenCalledWith('Viessmann HTTP 429: API rate limit exceeded — RATE_LIMIT_EXCEEDED');
  });
});

describe('polling: the gateway is offline', () => {
  test('says so right away and probes again after five minutes, then with the usual backoff', async () => {
    const driver = createDriver();
    const device = createPolledDevice();
    device.getFeatures.mockRejectedValue(gatewayOffline());

    const nextPoll = await startPolling(driver, device);
    expect(device.setUnavailable).toHaveBeenCalledWith(GATEWAY_OFFLINE);
    expect(lastDelay(driver)).toBe(5 * MINUTE);

    await nextPoll();
    expect(lastDelay(driver)).toBe(4 * POLL_INTERVAL);
    await nextPoll();
    await nextPoll();
    await nextPoll();
    expect(lastDelay(driver)).toBe(30 * MINUTE);
    expect(device.setUnavailable).toHaveBeenLastCalledWith(GATEWAY_OFFLINE);
  });

  test('a successful poll clears it', async () => {
    const driver = createDriver();
    const device = createPolledDevice();
    device.getFeatures.mockRejectedValueOnce(gatewayOffline());

    const nextPoll = await startPolling(driver, device);
    expect(device.getAvailable()).toBe(false);

    await nextPoll();
    expect(device.getAvailable()).toBe(true);
    expect(device.onFeaturesUpdated).toHaveBeenCalled();
  });
});

describe('adding a device', () => {
  const INSTALLATIONS = fixture('vitocal_222_installations.json');
  const FEATURES = fixture('vitocal_222_features.json');
  const clone = (value) => JSON.parse(JSON.stringify(value));

  function client({ installations = clone(INSTALLATIONS), features = async () => clone(FEATURES) } = {}) {
    return {
      getInstallations: jest.fn(async () => (installations instanceof Error ? Promise.reject(installations) : installations)),
      getFeatures: jest.fn(features),
    };
  }

  // The installation list with the heating device's gateway (or the device) reported offline
  function offline(where) {
    const installations = clone(INSTALLATIONS);
    const gateway = installations.data[0].gateways[0];
    if (where === 'gateway') gateway.aggregatedStatus = 'Offline';
    else gateway.devices.find((device) => device.deviceType === 'heating').status = 'Offline';
    return installations;
  }

  test.each([
    ['the features', () => client({ features: () => Promise.reject(packageNotPaid()) })],
    ['the installations', () => client({ installations: packageNotPaid() })],
  ])('access refused for %s is explained', async (_, createClient) => {
    const driver = createDriver();
    const error = await driver.onPairListDevices({ oAuth2Client: createClient() }).catch((caught) => caught);

    expect(error.message).toBe(PACKAGE_NOT_PAID_PAIRING);
    expect(error.cause.status).toBe(402);
  });

  test('a used-up quota says when to try again', async () => {
    const driver = createDriver();
    const oAuth2Client = client({ features: () => Promise.reject(rateLimited(String(45 * 60))) });

    await expect(driver.onPairListDevices({ oAuth2Client }))
      .rejects.toThrow('The Viessmann API limit has been reached. Try again after 13:45.');
  });

  test('an offline gateway reported by the API is explained', async () => {
    const driver = createDriver();
    const oAuth2Client = client({ features: () => Promise.reject(gatewayOffline()) });

    await expect(driver.onPairListDevices({ oAuth2Client })).rejects.toThrow(GATEWAY_OFFLINE);
  });

  test.each(['gateway', 'device'])('a failing read is explained when the installation list reports the %s offline', async (where) => {
    const driver = createDriver();
    const oAuth2Client = client({ installations: offline(where), features: () => Promise.reject(apiError({ status: 502 })) });

    const error = await driver.onPairListDevices({ oAuth2Client }).catch((caught) => caught);

    expect(error.message).toBe(GATEWAY_OFFLINE);
  });

  test('an offline status alone does not stop pairing when the features can be read', async () => {
    const driver = createDriver();

    const devices = await driver.onPairListDevices({ oAuth2Client: client({ installations: offline('gateway') }) });

    expect(devices).toHaveLength(1);
  });

  test('any other error is passed on unchanged', async () => {
    const driver = createDriver();
    const failure = apiError({ status: 502 });
    const oAuth2Client = client({ features: () => Promise.reject(failure) });

    await expect(driver.onPairListDevices({ oAuth2Client })).rejects.toBe(failure);
  });
});
