/* eslint-env jest */

'use strict';

// Writes that did not take (writeChecks.js): checked on a poll a minute after the write.

const {
  WriteChecks, sameValue, WRITE_CHECK_AFTER, WRITE_CHECK_EXPIRY,
} = require('../writeChecks');

const NOW = Date.parse('2026-11-26T12:00:00Z');

test('numbers match within rounding, other values exactly', () => {
  expect(sameValue(50, 50.004)).toBe(true);
  expect(sameValue(50, 50.5)).toBe(false);
  expect(sameValue('standby', 'standby')).toBe(true);
  expect(sameValue('standby', 'dhw')).toBe(false);
});

test('writes are checked a minute later: confirmed, rejected, or forgotten', () => {
  const checks = new WriteChecks();
  checks.remember('target_temperature.hotWater', 50, NOW);
  checks.remember('thermostat_mode.heating', 'standby', NOW);
  checks.remember('target_temperature.heating', 21, NOW);
  const reported = { 'target_temperature.hotWater': 50.004, 'thermostat_mode.heating': 'dhw' };

  expect(checks.check((name) => reported[name], NOW + 10 * 1000)).toEqual({ rejected: [], confirmed: [] });
  expect(checks.check((name) => reported[name], NOW + WRITE_CHECK_AFTER)).toEqual({
    rejected: [{ capabilityName: 'thermostat_mode.heating', wanted: 'standby', actual: 'dhw' }],
    confirmed: ['target_temperature.hotWater'],
  });
  // Not reported: kept for a while, then forgotten without a message
  expect(checks.writes.has('target_temperature.heating')).toBe(true);
  expect(checks.check(() => undefined, NOW + WRITE_CHECK_EXPIRY + 1)).toEqual({ rejected: [], confirmed: [] });
  expect(checks.writes.size).toBe(0);
});

test('a new write replaces the one before it', () => {
  const checks = new WriteChecks();
  checks.remember('target_temperature.hotWater', 50, NOW);
  checks.remember('target_temperature.hotWater', 55, NOW + 1000);
  expect(checks.check(() => 55, NOW + 1000 + WRITE_CHECK_AFTER).confirmed).toEqual(['target_temperature.hotWater']);
});
