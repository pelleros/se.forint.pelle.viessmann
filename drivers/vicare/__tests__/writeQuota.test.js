/* eslint-env jest */

'use strict';

// The Viessmann account's allowance for writes (writeQuota.js): a write is refused only when the
// calls left today would no longer cover the planned updates until 00:00 UTC, or after a burst of
// writes; undoing a temporary change is never refused.

// lib/errorMessages.js (translations) loads homey-oauth2app through lib/apiError.js
// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const { writeRefusal, plannedUntilReset, takeAccountWrite } = require('../writeQuota');
const { ApiQuota, DAILY_LIMIT, WRITE_BURST_LIMIT } = require('../../../lib/apiQuota');

const MINUTE = 60 * 1000;
const NOON = Date.parse('2026-11-26T12:00:00Z');
const RESET = Date.parse('2026-11-27T00:00:00Z');

describe('writeRefusal', () => {
  test('the planned updates until the reset count pro rata, rounded up', () => {
    expect(plannedUntilReset(720, NOON)).toBe(360);
    expect(plannedUntilReset(1400, Date.parse('2026-11-26T23:59:00Z'))).toBe(1);
    expect(plannedUntilReset(0, NOON)).toBe(0);
  });

  test('a write may use the calls the planned updates do not need', () => {
    // 720 a day: 360 until midnight; 1450 - 1089 = 361 left, one for the write
    expect(writeRefusal({
      usedToday: 1089, plannedPerDay: 720, burstWaitMs: 0, now: NOON,
    })).toBeNull();
    expect(writeRefusal({
      usedToday: 1090, plannedPerDay: 720, burstWaitMs: 0, now: NOON,
    })).toEqual({ reason: 'quota', left: 360, resetsAt: RESET });
  });

  test('past the daily limit nothing is left, also without planned updates', () => {
    expect(writeRefusal({
      usedToday: DAILY_LIMIT - 1, plannedPerDay: 0, burstWaitMs: 0, now: NOON,
    })).toBeNull();
    expect(writeRefusal({
      usedToday: DAILY_LIMIT + 5, plannedPerDay: 0, burstWaitMs: 0, now: NOON,
    })).toEqual({ reason: 'quota', left: 0, resetsAt: RESET });
  });

  test('a burst of writes waits for the window', () => {
    expect(writeRefusal({
      usedToday: 10, plannedPerDay: 720, burstWaitMs: 90 * 1000, now: NOON,
    })).toEqual({ reason: 'burst', waitMs: 90 * 1000 });
  });
});

describe('takeAccountWrite', () => {
  let now;
  const clock = () => now;

  function account({ sessionId = 'session', plannedPerDay = 720 } = {}) {
    const homey = {
      clock: { getTimezone: () => 'Europe/Stockholm' },
      __: (key) => key,
    };
    const device = (session = sessionId) => ({
      homey,
      getStoreValue: (key) => (key === 'OAuth2SessionId' ? session : undefined),
      driver: { plannedCallsPerDay: jest.fn(() => plannedPerDay) },
    });
    return { homey, device, quota: ApiQuota.for(homey) };
  }

  beforeEach(() => {
    now = NOON;
  });

  test('refuses when the calls left today are needed for the updates, with the reset in Homey\'s time', () => {
    const { device, quota } = account();
    for (let i = 0; i < 1090; i++) quota.count('session', now);
    const target = device();
    const error = (() => {
      try {
        return takeAccountWrite(target, { now: clock });
      } catch (caught) {
        return caught;
      }
    })();
    expect(error.code).toBe('write_quota_reserved');
    expect(error.message).toBe('The Viessmann account has only 360 API calls left today, and the regular updates of its devices need them '
      + 'until the daily count resets (27 Nov, 01:00). Try again then, or choose a longer update interval in the device settings.');
    expect(target.driver.plannedCallsPerDay).toHaveBeenCalledWith('session');
  });

  test('another account of the same Homey is not affected', () => {
    const { device, quota } = account();
    for (let i = 0; i < DAILY_LIMIT; i++) quota.count('session', now);
    expect(() => takeAccountWrite(device('other'), { now: clock })).not.toThrow();
  });

  test(`at most ${WRITE_BURST_LIMIT} writes per 10 minutes per account, for all its devices`, () => {
    const { device } = account();
    for (let i = 0; i < WRITE_BURST_LIMIT; i++) {
      takeAccountWrite(device(), { now: clock });
      now += 10 * 1000;
    }
    expect(() => takeAccountWrite(device(), { now: clock }))
      .toThrow('Too many changes to this Viessmann account in a short time (at most 20 per 10 minutes for all its devices). Try again in 7 minutes.');
    expect(() => takeAccountWrite(device('other'), { now: clock })).not.toThrow();
    now = NOON + 10 * MINUTE;
    expect(() => takeAccountWrite(device(), { now: clock })).not.toThrow();
  });

  test('a refused write takes nothing; undoing a temporary change is never refused', () => {
    const { device, quota } = account();
    for (let i = 0; i < WRITE_BURST_LIMIT; i++) takeAccountWrite(device(), { now: clock });
    expect(() => takeAccountWrite(device(), { now: clock })).toThrow('Too many changes');
    expect(quota.writeWindow('session').times).toHaveLength(WRITE_BURST_LIMIT);
    for (let i = 0; i < DAILY_LIMIT; i++) quota.count('session', now);
    expect(() => takeAccountWrite(device(), { now: clock, restoring: true })).not.toThrow();
  });

  test('without a Homey or a driver the daily limit alone applies', () => {
    expect(() => takeAccountWrite({ getStoreValue: () => undefined })).not.toThrow();
  });
});
