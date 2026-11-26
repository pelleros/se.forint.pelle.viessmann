/* eslint-env jest */

'use strict';

// lib/errorMessages.js (translations) loads homey-oauth2app through lib/apiError.js
// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const { WRITE_LIMITS, WRITE_CHECKS, takeWrite } = require('../writeLimits');

afterEach(() => WRITE_CHECKS.splice(0));

test('the limits per hour stop runaway Flows, not a Flow every 5 minutes', () => {
  expect(WRITE_LIMITS).toEqual({
    heatingCurve: 12, hotWaterBoost: 12, hotWaterCharge: 12, command: 30,
  });
});

test('counts per device and kind, and says when the next write is possible', () => {
  let now = 0;
  const clock = () => now;
  const first = {};
  const second = {};
  // A runaway Flow: a write every 4 minutes
  for (let i = 0; i < WRITE_LIMITS.hotWaterBoost; i++) {
    takeWrite(first, 'hotWaterBoost', clock);
    now += 4 * 60 * 1000;
  }
  // At 48 minutes; the first write leaves the window at 60
  expect(() => takeWrite(first, 'hotWaterBoost', clock)).toThrow('(at most 12 per hour). Try again in 12 minutes.');
  now = 60 * 60 * 1000;
  expect(() => takeWrite(first, 'hotWaterBoost', clock)).not.toThrow();
  expect(() => takeWrite(first, 'hotWaterCharge', clock)).not.toThrow();
  expect(() => takeWrite(second, 'hotWaterBoost', clock)).not.toThrow();
});

test('a further check runs after the hourly limit and before the write is counted', () => {
  const device = {};
  const check = jest.fn(() => {
    throw new Error('daily quota used up');
  });
  WRITE_CHECKS.push(check);
  expect(() => takeWrite(device, 'command')).toThrow('daily quota used up');
  expect(check).toHaveBeenCalledWith(device, 'command');
  expect(device._writeLimiters.command.times).toEqual([]);
  WRITE_CHECKS.splice(0);
  expect(() => takeWrite(device, 'command')).not.toThrow();
  expect(device._writeLimiters.command.times).toHaveLength(1);
});

test('a kind without a limit is a programming error', () => {
  expect(() => takeWrite({}, 'nothing')).toThrow('No write limit for "nothing"');
});
