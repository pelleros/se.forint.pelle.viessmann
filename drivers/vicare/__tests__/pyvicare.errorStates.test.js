/* eslint-env jest */

'use strict';

// The error states (access refused, used-up quota, offline gateway) and a response with odd
// values, for a few devices from PyViCare (test/fixtures/pyvicare/) after the update from
// 1.0.14: the device says what is wrong, polls again when it should, keeps its capabilities and
// values, and recovers with the next good response.

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const { FEATURES, DERIVED } = require('../config');
const { apiError } = require('../../../lib/apiError');
const { loadPyViCareFixtures, identityOf } = require('../../../test/helpers/pyvicareFixtures');
const { upgradeFrom1014 } = require('../../../test/helpers/upgradeFrom1014');

const NAMES = ['Vitocal250A.json', 'Vitodens200W.json', 'Vitocal262A_T2H-R290.json', 'VitovalorPT2.json'];
const fixtures = loadPyViCareFixtures().filter(({ name }) => NAMES.includes(name));

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const POLL_INTERVAL = 2 * MINUTE;
// 13:00 in Berlin; the failing poll below runs one interval later, at 13:02
const NOW = Date.parse('2026-01-15T12:00:00Z');
const clone = (value) => JSON.parse(JSON.stringify(value));

const ERROR_STATES = [
  ['Viessmann refuses access (HTTP 402)',
    () => apiError({ status: 402, body: { errorType: 'PACKAGE_NOT_PAID_FOR', message: 'User does not have access to the given feature.' } }),
    "Viessmann is refusing access to this account's data. This is often a temporary problem at Viessmann; the app tries again every hour. If it lasts, contact Viessmann's developer support.",
    HOUR],
  ['the quota is used up (HTTP 429)',
    () => apiError({ status: 429, headers: { get: (name) => (name.toLowerCase() === 'retry-after' ? '3600' : null) } }),
    'Viessmann API limit reached, updates resume at 14:02.',
    HOUR],
  ['the gateway is offline',
    () => apiError({ status: 400, body: { errorType: 'DEVICE_COMMUNICATION_ERROR', extendedPayload: { reason: 'GATEWAY_OFFLINE' } } }),
    'The Viessmann gateway is offline. Check that it has power and an internet connection.',
    5 * MINUTE],
];

// A device from the fixture, updated from 1.0.14 and polled once
async function upgraded(dump) {
  const result = await upgradeFrom1014({ identity: identityOf(dump), before: dump });
  result.driver.homey.clock = { getTimezone: () => 'Europe/Berlin' };
  return result;
}

const pollTimers = (driver) => driver.homey.setTimeout.mock.calls
  .map(([callback, ms]) => ({ callback, ms }))
  .filter(({ ms }) => ms >= POLL_INTERVAL);
const lastDelay = (driver) => pollTimers(driver).pop().ms;

// Runs the poll the last timer scheduled, that much later
async function nextPoll(driver, pollingKey) {
  const { callback, ms } = pollTimers(driver).pop();
  Date.now.mockReturnValue(Date.now() + ms);
  callback();
  const poller = driver._devicePollers.get(pollingKey);
  while (poller.running) await poller.running;
}

// The values a poll copies from the response. Computed values follow the clock (e.g. starts in the
// last hour), so they are left out here and tested in computedValues.test.js.
const COMPUTED = new Set(Object.values(FEATURES).flatMap((feature) => feature.capabilities)
  .filter((capability) => capability.computed).map((capability) => capability.capabilityName));
const valuesOf = (device) => Object.fromEntries(device.getCapabilities().filter((id) => !COMPUTED.has(id))
  .map((id) => [id, device.getCapabilityValue(id)]));

/*
  The response with every other mapped value replaced by something that is no value (object,
  NaN, Infinity, list) and with entries that are no feature. Returns the response and the
  capabilities whose features were changed.
*/
function withOddValues(dump, circuit) {
  const response = clone(dump);
  const garbage = [{ nested: 1 }, NaN, Infinity, ['x']];
  const touched = new Set();
  const touchedPaths = new Set();
  let mapped = 0;
  for (const feature of response.data) {
    const config = FEATURES[feature.feature.replace(new RegExp(`^heating\\.circuits\\.${circuit}\\.`), 'heating.circuits.0.')];
    if (!config || !feature.isEnabled || !feature.properties) continue;
    mapped += 1;
    if (mapped % 2 === 0) continue;
    for (const { capabilityName, propertyPath } of config.capabilities) {
      const [property] = propertyPath.split('.');
      if (feature.properties[property] && typeof feature.properties[property] === 'object') {
        feature.properties[property].value = garbage[mapped % garbage.length];
        touched.add(capabilityName);
        touchedPaths.add(feature.feature.replace(new RegExp(`^heating\\.circuits\\.${circuit}\\.`), 'heating.circuits.0.'));
      }
    }
  }
  // Derived capabilities have no value when every source they could read got an odd value (the
  // status text, which shows what is left, is checked in its own tests)
  const reportedPaths = new Set(response.data.filter((feature) => feature?.isEnabled && feature.properties)
    .map((feature) => feature.feature.replace(new RegExp(`^heating\\.circuits\\.${circuit}\\.`), 'heating.circuits.0.')));
  // When only some of its sources got an odd value, a derived value comes from the others
  const unpredictable = new Set(['measure_status_text']);
  for (const derived of DERIVED) {
    const sources = derived.sources.filter((path) => reportedPaths.has(path));
    if (sources.length > 0 && sources.every((path) => touchedPaths.has(path))) touched.add(derived.capabilityName);
    else if (sources.some((path) => touchedPaths.has(path))) unpredictable.add(derived.capabilityName);
  }
  response.data.push(null, 42, 'garbage', {}, { feature: 7, isEnabled: true });
  return { response, touched, unpredictable };
}

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  jest.spyOn(Math, 'random').mockReturnValue(0.5); // regular (filtered) polls only
});
afterEach(() => {
  jest.restoreAllMocks();
});

test('the chosen PyViCare responses are there', () => {
  expect(fixtures.map(({ name }) => name).sort()).toEqual([...NAMES].sort());
});

describe.each(fixtures.map(({ name, dump }) => [name, dump]))('PyViCare %s', (name, dump) => {
  test.each(ERROR_STATES)('when %s: says so, waits, keeps everything and recovers', async (_, createError, message, delay) => {
    const { driver, device, pollingKey } = await upgraded(dump);
    const capabilities = device.getCapabilities().sort();
    const values = valuesOf(device);

    device.oAuth2Client.getFeatures.mockRejectedValueOnce(createError());
    await nextPoll(driver, pollingKey);

    expect(device.setUnavailable).toHaveBeenCalledTimes(1);
    expect(device.setUnavailable).toHaveBeenCalledWith(message);
    expect(lastDelay(driver)).toBe(delay);
    expect(device.getCapabilities().sort()).toEqual(capabilities);
    expect(valuesOf(device)).toEqual(values);

    await nextPoll(driver, pollingKey);

    expect(device.getAvailable()).toBe(true);
    expect(lastDelay(driver)).toBe(POLL_INTERVAL);
    expect(device.removeCapability).not.toHaveBeenCalled();
    expect(valuesOf(device)).toEqual(values);
  });

  test('a response with odd values: the rest is applied and the device stays available', async () => {
    const { driver, device, pollingKey } = await upgraded(dump);
    const values = valuesOf(device);
    const { response, touched, unpredictable } = withOddValues(dump, device.getStoreValue('heatingCircuitId'));
    expect(touched.size).toBeGreaterThan(0);
    // Forget the values, so that the poll has to set each one again
    for (const id of device.getCapabilities()) device.__values.set(id, null);

    device.oAuth2Client.getFeatures.mockResolvedValueOnce(response);
    await nextPoll(driver, pollingKey);

    expect(device.setUnavailable).not.toHaveBeenCalled();
    expect(device.error).not.toHaveBeenCalledWith(expect.stringContaining('Error processing features update'), expect.anything());
    expect(lastDelay(driver)).toBe(POLL_INTERVAL);
    for (const id of Object.keys(values).filter((name) => !unpredictable.has(name))) {
      // An odd value is no value: the capability keeps what it had (here: nothing)
      const expected = touched.has(id) ? null : values[id];
      expect([id, device.getCapabilityValue(id)]).toEqual([id, expected]);
    }
  });
});
