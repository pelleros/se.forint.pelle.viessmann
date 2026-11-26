/* eslint-env jest */

'use strict';

// Error states the user is told about (Viessmann refuses access, the quota is used up,
// the gateway is offline): how they are recognised and the translated messages.

const fs = require('fs');
const path = require('path');

jest.mock('homey-oauth2app', () => ({ OAuth2Error: class extends Error {} }));

const { apiError, apiErrorState, API_STATES } = require('../apiError');
const {
  translate, formatClockTime, formatDateTime, timeZoneOf, apiStateMessage,
} = require('../errorMessages');

const LOCALES_DIR = path.join(__dirname, '../../locales');
const LANGUAGES = ['en', 'de', 'nl', 'fr', 'sv'];
const KEYS = ['errors.package_not_paid', 'errors.gateway_offline', 'errors.api_limit', 'pair.api_limit', 'pair.package_not_paid'];
const lookup = (locale, key) => key.split('.').reduce((node, part) => node?.[part], locale);

const NOW = Date.parse('2026-01-15T12:00:00Z');
const fail = () => {
  throw new Error('unavailable');
};
const headers = (retryAfter) => ({ get: (name) => (name.toLowerCase() === 'retry-after' ? retryAfter : null) });

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(NOW);
});
afterEach(() => {
  jest.useRealTimers();
});

describe('apiErrorState', () => {
  test.each([
    ['HTTP 402', apiError({ status: 402 }), API_STATES.PACKAGE_NOT_PAID],
    ['PACKAGE_NOT_PAID_FOR with another status', apiError({ status: 403, body: { errorType: 'PACKAGE_NOT_PAID_FOR' } }), API_STATES.PACKAGE_NOT_PAID],
    ['HTTP 429', apiError({ status: 429 }), API_STATES.RATE_LIMITED],
    ['GATEWAY_OFFLINE as reason', apiError({ status: 400, body: { errorType: 'DEVICE_COMMUNICATION_ERROR', extendedPayload: { reason: 'GATEWAY_OFFLINE' } } }), API_STATES.GATEWAY_OFFLINE],
    ['GATEWAY_OFFLINE as error type', apiError({ status: 502, body: { errorType: 'GATEWAY_OFFLINE' } }), API_STATES.GATEWAY_OFFLINE],
    ['another device communication error', apiError({ status: 400, body: { errorType: 'DEVICE_COMMUNICATION_ERROR', extendedPayload: { reason: 'TIMEOUT' } } }), null],
    ['HTTP 500', apiError({ status: 500 }), null],
    ['HTTP 401', apiError({ status: 401 }), null],
    ['a network error', new Error('socket hang up'), null],
    ['undefined', undefined, null],
    ['a string', 'HTTP 402', null],
  ])('%s', (_, error, expected) => {
    expect(apiErrorState(error)).toBe(expected);
  });
});

describe('apiError reads only safe parts of the extended payload', () => {
  test.each([
    ['lower case', 'gateway_offline'],
    ['free text', 'The gateway with serial 7571381573 is offline'],
    ['not a string', 42],
    ['too long', `A${'B'.repeat(80)}`],
  ])('a reason that is no short code (%s) is ignored', (_, reason) => {
    const error = apiError({ status: 400, body: { errorType: 'DEVICE_COMMUNICATION_ERROR', extendedPayload: { reason } } });
    expect(error.apiReason).toBeUndefined();
    expect(apiErrorState(error)).toBeNull();
    if (typeof reason === 'string') expect(error.message).not.toContain(reason);
  });

  test('the reason is not repeated when the description already has it', () => {
    const error = apiError({ status: 400, body: { reason: 'GATEWAY_OFFLINE', extendedPayload: { reason: 'GATEWAY_OFFLINE' } } });
    expect(error.message.match(/GATEWAY_OFFLINE/g)).toHaveLength(1);
  });
});

describe('apiError: when the quota resets', () => {
  const rateLimited = (extendedPayload, retryAfter) => apiError({
    status: 429, headers: headers(retryAfter), body: { errorType: 'RATE_LIMIT_EXCEEDED', extendedPayload },
  });

  test.each([
    ['limitReset only', { limitReset: NOW + 3600000 }, undefined, 3600000],
    ['the later of limitReset and Retry-After (limitReset)', { limitReset: NOW + 3600000 }, '600', 3600000],
    ['the later of limitReset and Retry-After (Retry-After)', { limitReset: NOW + 60000 }, '600', 600000],
    ['a limitReset in the past', { limitReset: NOW - 60000 }, undefined, 0],
    ['a limitReset that is no number', { limitReset: '2026-01-15T13:00:00Z' }, undefined, undefined],
    ['no limitReset and no Retry-After', {}, undefined, undefined],
    ['no extended payload', null, undefined, undefined],
  ])('%s', (_, extendedPayload, retryAfter, expected) => {
    expect(rateLimited(extendedPayload, retryAfter).retryAfterMs).toBe(expected);
  });

  test('limitReset is only read for HTTP 429', () => {
    expect(apiError({ status: 500, body: { extendedPayload: { limitReset: NOW + 3600000 } } }).retryAfterMs).toBeUndefined();
  });
});

describe('translate', () => {
  test('uses Homey\'s translation', () => {
    const homey = { __: jest.fn((key, tags) => `[${key} ${tags.time}]`) };
    expect(translate(homey, 'errors.api_limit', { time: '14:05' })).toBe('[errors.api_limit 14:05]');
  });

  test.each([
    ['no i18n', {}],
    ['no homey', undefined],
    ['a missing translation (Homey returns the key)', { __: (key) => key }],
    ['a failing i18n', { __: fail }],
  ])('falls back to English with %s', (_, homey) => {
    expect(translate(homey, 'errors.api_limit', { time: '14:05' })).toBe('Viessmann API limit reached, updates resume at 14:05.');
  });

  test('an unknown key comes back as it is', () => {
    expect(translate(undefined, 'errors.unknown')).toBe('errors.unknown');
  });
});

describe('formatClockTime', () => {
  const stockholm = { clock: { getTimezone: () => 'Europe/Stockholm' } };

  test.each([
    ['in winter', '2026-01-15T13:05:00Z', '14:05'],
    ['in summer', '2026-07-15T13:05:00Z', '15:05'],
    ['rounded up to the next minute', '2026-01-15T13:05:01Z', '14:06'],
    ['after midnight', '2026-01-15T23:30:00Z', '00:30'],
  ])('in Homey\'s time zone %s', (_, time, expected) => {
    expect(formatClockTime(stockholm, Date.parse(time))).toBe(expected);
  });

  test.each([
    ['no clock', {}],
    ['an unknown time zone', { clock: { getTimezone: () => 'Mars/Olympus_Mons' } }],
    ['a failing clock', { clock: { getTimezone: fail } }],
  ])('in UTC with %s', (_, homey) => {
    expect(formatClockTime(homey, Date.parse('2026-01-15T13:05:00Z'))).toBe('13:05 UTC');
  });
});

describe('apiStateMessage', () => {
  const homey = { clock: { getTimezone: () => 'Europe/Stockholm' } };
  const retryAt = Date.parse('2026-01-15T15:00:00Z');

  test.each([
    ['access refused', apiError({ status: 402 }), {},
      "Viessmann is refusing access to this account's data. This is often a temporary problem at Viessmann; the app tries again every hour. If it lasts, contact Viessmann's developer support."],
    ['access refused while adding a device', apiError({ status: 402 }), { pairing: true },
      "Viessmann is refusing access to this account's data. This is often a temporary problem at Viessmann; try again later. If it lasts, contact Viessmann's developer support."],
    ['an offline gateway', apiError({ status: 400, body: { extendedPayload: { reason: 'GATEWAY_OFFLINE' } } }), {},
      'The Viessmann gateway is offline. Check that it has power and an internet connection.'],
    ['the quota', apiError({ status: 429 }), { retryAt }, 'Viessmann API limit reached, updates resume at 16:00.'],
    ['the quota while adding a device', apiError({ status: 429 }), { retryAt, pairing: true }, 'The Viessmann API limit has been reached. Try again after 16:00.'],
    ['the quota without a known reset', apiError({ status: 429 }), {}, null],
    ['any other error', apiError({ status: 500 }), { retryAt }, null],
  ])('%s', (_, error, options, expected) => {
    expect(apiStateMessage(homey, error, options)).toBe(expected);
  });
});

describe('locales', () => {
  test.each(LANGUAGES)('%s has every message, with the time placeholder where needed', (language) => {
    const locale = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), 'utf8'));
    for (const key of KEYS) {
      const text = lookup(locale, key);
      expect([key, typeof text]).toEqual([key, 'string']);
      expect(text.trim().length).toBeGreaterThan(10);
      expect([key, text.includes('__time__')]).toEqual([key, key.endsWith('api_limit')]);
    }
  });
});

describe('formatDateTime', () => {
  test('a date and time in Homey\'s time zone, or in UTC saying so', () => {
    const time = Date.parse('2026-11-26T10:59:00Z');
    expect(formatDateTime({ clock: { getTimezone: () => 'Europe/Stockholm' } }, time)).toBe('26 Nov, 11:59');
    expect(formatDateTime({}, time)).toBe('26 Nov, 10:59 UTC');
    expect(timeZoneOf({
      clock: {
        getTimezone: () => {
          throw new Error('x');
        },
      },
    })).toBeUndefined();
  });
});
