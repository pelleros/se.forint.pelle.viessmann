/* eslint-env jest */

'use strict';

// The API call count per Viessmann login and UTC day (lib/apiQuota.js), and that the OAuth
// client counts every API request of its session.

jest.mock('homey-oauth2app', () => {
  // eslint-disable-next-line global-require
  const fake = require('../../test/helpers/fakeHomeyOAuth2App');
  return {
    ...fake,
    OAuth2Client: class {

      log() {}

      error() {}

      debug() {}

    },
  };
});

const {
  ApiQuota, callsPerDay, utcDate, SETTINGS_KEY,
} = require('../apiQuota');
const Client = require('../ViessmannOAuth2Client');

const NOON = Date.parse('2026-11-26T12:00:00Z');

function fakeHomey(stored) {
  const settings = new Map(stored ? [[SETTINGS_KEY, stored]] : []);
  return {
    settings: {
      get: jest.fn((key) => settings.get(key)),
      set: jest.fn((key, value) => settings.set(key, JSON.parse(JSON.stringify(value)))),
    },
  };
}

test('calls a day for an interval', () => {
  expect([2, 3, 5, 10, 15, 30, 60, 7].map(callsPerDay)).toEqual([720, 480, 288, 144, 96, 48, 24, 206]);
  expect(callsPerDay(0)).toBe(0);
  expect(utcDate(Date.parse('2026-11-26T23:30:00-02:00'))).toBe('2026-11-27');
});

test('counts per session, saves at most once a minute, and starts again at 00:00 UTC', () => {
  const homey = fakeHomey();
  const quota = ApiQuota.for(homey);
  expect(ApiQuota.for(homey)).toBe(quota);

  quota.count('session-a', NOON);
  quota.count('session-a', NOON + 1000);
  quota.count('session-b', NOON + 2000);
  expect(quota.usedToday('session-a', NOON + 3000)).toBe(2);
  expect(quota.usedToday('session-b', NOON + 3000)).toBe(1);
  expect(homey.settings.set).toHaveBeenCalledTimes(1);
  quota.count('session-a', NOON + 61 * 1000);
  expect(homey.settings.set).toHaveBeenCalledTimes(2);
  expect(homey.settings.get(SETTINGS_KEY)).toEqual({ date: '2026-11-26', sessions: { 'session-a': 3, 'session-b': 1 } });

  // A restart continues the count of the day
  const restarted = new ApiQuota(homey);
  expect(restarted.usedToday('session-a', NOON + 62 * 1000)).toBe(3);

  const midnight = Date.parse('2026-11-27T00:00:00Z');
  expect(quota.usedToday('session-a', midnight)).toBe(0);
  quota.count('session-a', midnight + 1);
  expect(homey.settings.get(SETTINGS_KEY)).toEqual({ date: '2026-11-27', sessions: { 'session-a': 1 } });
});

test('a broken stored value or settings store does not stop the count', () => {
  const quota = new ApiQuota(fakeHomey({ date: 5, sessions: 'x' }));
  quota.count('s', NOON);
  expect(quota.usedToday('s', NOON)).toBe(1);
  const failing = new ApiQuota({
    settings: {
      get: () => {
        throw new Error('x');
      },
      set: () => {
        throw new Error('full');
      },
    },
  });
  expect(() => failing.count('s', NOON)).not.toThrow();
  expect(ApiQuota.for(undefined).usedToday('s')).toBe(0);
});

test('the OAuth client counts every API request of its session', async () => {
  const homey = fakeHomey();
  const client = new Client();
  client.homey = homey;
  client.setSessionId('session-x');
  expect(client.getSessionId()).toBe('session-x');
  client.onBuildRequest = jest.fn(async () => ({ url: 'https://example.invalid/x', opts: { method: 'GET', headers: {} } }));
  client.onRequestError = jest.fn(async () => {
    throw new Error('offline');
  });
  const before = ApiQuota.for(homey).usedToday('session-x');
  await expect(client._executeRequest({ method: 'GET', path: '/x' })).rejects.toThrow('offline');
  expect(ApiQuota.for(homey).usedToday('session-x')).toBe(before + 1);
});

test('the event log is read for the gateway since a moment', async () => {
  const client = new Client();
  client.get = jest.fn(async () => ({ data: [] }));
  await client.getEventsHistory({ installationId: 123, gatewaySerial: '777', start: '2026-11-26T11:00:00.000Z' });
  expect(client.get).toHaveBeenCalledWith({
    path: '/events-history/installations/123/events?gatewaySerial=777&start=2026-11-26T11%3A00%3A00.000Z&limit=100',
  });
});
