/* eslint-env jest */

'use strict';

// Writes that did not take (writeChecks.js): checked on the polls from a minute after the write.
// One poll with the value confirms it; only two polls in a row with another value reject it.

const {
  WriteChecks, sameValue, WRITE_CHECK_AFTER, WRITE_CHECK_EXPIRY, REJECT_AFTER_POLLS,
} = require('../writeChecks');

const NOW = Date.parse('2026-11-26T12:00:00Z');
const MINUTE = 60 * 1000;
const HOT_WATER = 'target_temperature.hotWater';
const poll = (value) => (name) => (name === HOT_WATER ? value : undefined);

test('numbers match within rounding, other values exactly', () => {
  expect(sameValue(50, 50.004)).toBe(true);
  expect(sameValue(50, 50.5)).toBe(false);
  expect(sameValue('standby', 'standby')).toBe(true);
  expect(sameValue('standby', 'dhw')).toBe(false);
});

test('writes are checked from a minute later: confirmed at once, rejected after two polls, or forgotten', () => {
  expect(REJECT_AFTER_POLLS).toBe(2);
  const checks = new WriteChecks();
  checks.remember('target_temperature.hotWater', 50, NOW);
  checks.remember('thermostat_mode.heating', 'standby', NOW);
  checks.remember('target_temperature.heating', 21, NOW);
  const reported = { 'target_temperature.hotWater': 50.004, 'thermostat_mode.heating': 'dhw' };

  expect(checks.check((name) => reported[name], NOW + 10 * 1000)).toEqual({ rejected: [], confirmed: [] });
  expect(checks.check((name) => reported[name], NOW + WRITE_CHECK_AFTER)).toEqual({
    rejected: [],
    confirmed: ['target_temperature.hotWater'],
  });
  expect(checks.check((name) => reported[name], NOW + 3 * MINUTE)).toEqual({
    rejected: [{ capabilityName: 'thermostat_mode.heating', wanted: 'standby', actual: 'dhw' }],
    confirmed: [],
  });
  // Not reported: kept for a while, then forgotten without a message
  expect(checks.writes.has('target_temperature.heating')).toBe(true);
  expect(checks.check(() => undefined, NOW + WRITE_CHECK_EXPIRY + 1)).toEqual({ rejected: [], confirmed: [] });
  expect(checks.writes.size).toBe(0);
});

test('a stale first poll and then the written value: confirmed, no rejection', () => {
  const checks = new WriteChecks();
  checks.remember(HOT_WATER, 50, NOW);
  expect(checks.check(poll(45), NOW + 2 * MINUTE)).toEqual({ rejected: [], confirmed: [] });
  expect(checks.check(poll(50), NOW + 4 * MINUTE)).toEqual({ rejected: [], confirmed: [HOT_WATER] });
  expect(checks.writes.size).toBe(0);
});

test('another value twice in a row rejects the write once', () => {
  const checks = new WriteChecks();
  checks.remember(HOT_WATER, 50, NOW);
  expect(checks.check(poll(45), NOW + 2 * MINUTE).rejected).toEqual([]);
  expect(checks.check(poll(46), NOW + 4 * MINUTE).rejected).toEqual([{ capabilityName: HOT_WATER, wanted: 50, actual: 46 }]);
  expect(checks.check(poll(46), NOW + 6 * MINUTE)).toEqual({ rejected: [], confirmed: [] });
});

test('while the values are frozen nothing is judged, and the count starts again after', () => {
  const checks = new WriteChecks();
  checks.remember(HOT_WATER, 50, NOW);
  expect(checks.check(poll(45), NOW + 2 * MINUTE).rejected).toEqual([]);
  for (let minutes = 4; minutes <= 10; minutes += 2) {
    expect(checks.check(poll(45), NOW + minutes * MINUTE, { frozen: true })).toEqual({ rejected: [], confirmed: [] });
  }
  expect(checks.check(poll(45), NOW + 12 * MINUTE).rejected).toEqual([]);
  expect(checks.check(poll(45), NOW + 14 * MINUTE).rejected).toHaveLength(1);
});

test('frozen for longer than the expiry: forgotten without a message', () => {
  const checks = new WriteChecks();
  checks.remember(HOT_WATER, 50, NOW);
  expect(checks.check(poll(45), NOW + WRITE_CHECK_EXPIRY + 1, { frozen: true })).toEqual({ rejected: [], confirmed: [] });
  expect(checks.writes.size).toBe(0);
});

test('a poll without the value between two others starts the count again', () => {
  const checks = new WriteChecks();
  checks.remember(HOT_WATER, 50, NOW);
  checks.check(poll(45), NOW + 2 * MINUTE);
  checks.check(poll(undefined), NOW + 4 * MINUTE);
  expect(checks.check(poll(45), NOW + 6 * MINUTE).rejected).toEqual([]);
  expect(checks.check(poll(45), NOW + 8 * MINUTE).rejected).toHaveLength(1);
});

test('a new write replaces the one before it', () => {
  const checks = new WriteChecks();
  checks.remember('target_temperature.hotWater', 50, NOW);
  checks.remember('target_temperature.hotWater', 55, NOW + 1000);
  expect(checks.check(() => 55, NOW + 1000 + WRITE_CHECK_AFTER).confirmed).toEqual(['target_temperature.hotWater']);
});
