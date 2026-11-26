/* eslint-env jest */

'use strict';

// Update interval and planned API calls a day (pollPlan.js).

const {
  pollInterval, plannedCallsPerDay, withinPlan, PLANNED_LIMIT,
} = require('../pollPlan');

const MINUTE = 60 * 1000;

test('automatic shares 2 minutes per device; a chosen interval is used as it is', () => {
  expect(pollInterval('auto', 3)).toBe(6 * MINUTE);
  expect(pollInterval(undefined, 0)).toBe(2 * MINUTE);
  expect(pollInterval('10', 3)).toBe(10 * MINUTE);
  // Below 2 minutes is no choice: automatic
  expect(pollInterval('1', 1)).toBe(2 * MINUTE);
});

test('planned calls add up polls and event log reads of a login\'s devices', () => {
  expect(plannedCallsPerDay([{ pollInterval: '5', eventLog: '30' }, { pollInterval: 'auto', eventLog: 'off' }], 3)).toBe(288 + 48 + 240);
  expect(plannedCallsPerDay([], 2)).toBe(0);
});

test('a plan within the limit leaves calls for everything else', () => {
  expect(withinPlan(720)).toBe(true);
  expect(withinPlan(PLANNED_LIMIT)).toBe(true);
  expect(withinPlan(1440)).toBe(false);
});
