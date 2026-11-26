/* eslint-env jest */

'use strict';

// lib/errorMessages.js (translations) loads homey-oauth2app through lib/apiError.js
// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const { WRITE_LIMITS, takeWrite } = require('../writeLimits');

test('the limits per hour', () => {
  expect(WRITE_LIMITS).toEqual({
    heatingCurve: 6, hotWaterBoost: 6, hotWaterCharge: 6, command: 20,
  });
});

test('counts per device and kind, and says when the next write is possible', () => {
  let now = 0;
  const clock = () => now;
  const first = {};
  const second = {};
  for (let i = 0; i < WRITE_LIMITS.hotWaterBoost; i++) takeWrite(first, 'hotWaterBoost', clock);
  expect(() => takeWrite(first, 'hotWaterBoost', clock)).toThrow('(at most 6 per hour). Try again in 60 minutes.');
  expect(() => takeWrite(first, 'hotWaterCharge', clock)).not.toThrow();
  expect(() => takeWrite(second, 'hotWaterBoost', clock)).not.toThrow();
  now = 60 * 60 * 1000;
  expect(() => takeWrite(first, 'hotWaterBoost', clock)).not.toThrow();
});

test('a kind without a limit is a programming error', () => {
  expect(() => takeWrite({}, 'nothing')).toThrow('No write limit for "nothing"');
});
