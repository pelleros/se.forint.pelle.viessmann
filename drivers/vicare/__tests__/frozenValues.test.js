/* eslint-env jest */

'use strict';

// Values that stopped updating (frozenValues.js): no feature timestamp moved for a long time
// while polls work.

const { FrozenValues, newestTimestamp, FROZEN_AFTER } = require('../frozenValues');

const MINUTE = 60 * 1000;
const NOW = Date.parse('2026-11-26T12:00:00Z');
const at = (timestamp) => ({ data: [{ feature: 'heating.sensors.temperature.outside', timestamp }] });

test('the newest feature timestamp', () => {
  const response = { data: [...at('2026-11-26T10:00:00Z').data, ...at('2026-11-26T11:00:00Z').data, { timestamp: 'garbage' }, null] };
  expect(newestTimestamp(response)).toBe(Date.parse('2026-11-26T11:00:00Z'));
  expect(newestTimestamp({ data: [] })).toBeUndefined();
});

test('frozen when no timestamp moves for a long time; only what the app sees counts', () => {
  const frozen = new FrozenValues();
  const old = '2026-11-20T08:00:00.000Z';
  // Old timestamps at the start are not enough
  expect(frozen.update(at(old), NOW)).toBeNull();
  expect(frozen.update(at(old), NOW + FROZEN_AFTER - MINUTE)).toBeNull();
  expect(frozen.update(at(old), NOW + FROZEN_AFTER)).toBe(Date.parse(old));
  // Moving again ends it
  expect(frozen.update(at('2026-11-26T18:00:00.000Z'), NOW + FROZEN_AFTER + MINUTE)).toBeNull();
});

test('a response without timestamps changes nothing', () => {
  const frozen = new FrozenValues(10 * MINUTE);
  expect(frozen.update({ data: [] }, NOW)).toBeNull();
  frozen.update(at('2026-11-26T11:00:00Z'), NOW);
  expect(frozen.update({ data: [] }, NOW + 10 * MINUTE)).toBe(Date.parse('2026-11-26T11:00:00Z'));
});
