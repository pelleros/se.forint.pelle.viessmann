/* eslint-env jest */

'use strict';

// Update interval and planned API calls a day, what a poll asks for and a poller's key (pollPlan.js).

const { PATHS } = require('../config');
const {
  pollInterval, plannedCallsPerDay, sharedPollCallsPerDay, followersInterval, withinPlan, isExtendedPoll, pollFilter, pollingKey,
  PLANNED_LIMIT, EXTENDED_POLL_SHARE, ROOM_POLL_INTERVAL,
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

test('about one poll in 30 reads all features', () => {
  expect(EXTENDED_POLL_SHARE).toBe(0.03);
  expect(isExtendedPoll(0)).toBe(true);
  expect(isExtendedPoll(0.029)).toBe(true);
  expect(isExtendedPoll(0.03)).toBe(false);
  expect(typeof isExtendedPoll()).toBe('boolean');
});

test('a regular poll asks for every configured path, on the device\'s heating circuit', () => {
  const paths = Object.values(PATHS);
  expect(pollFilter('0').split(',')).toEqual(paths);
  expect(pollFilter(undefined)).toBe(pollFilter('0'));
  const circuitOne = pollFilter('1').split(',');
  expect(circuitOne).toHaveLength(paths.length);
  expect(circuitOne).toContain('heating.circuits.1.operating.modes.active');
  expect(circuitOne.some((path) => path.startsWith('heating.circuits.0.'))).toBe(false);
});

test('a device\'s poller is known by its installation, gateway and device id', () => {
  expect(pollingKey({ installationId: 1234567, gatewaySerial: '7637415022052208', deviceId: '0' })).toBe('1234567-7637415022052208-0');
});

test('a poll also asks for the paths of the extra devices that share it, each once', () => {
  const paths = pollFilter('0', ['heating.circuits.1.operating.modes.active', 'heating.circuits.0.operating.modes.active']).split(',');
  expect(paths).toHaveLength(Object.values(PATHS).length + 1);
  expect(paths[paths.length - 1]).toBe('heating.circuits.1.operating.modes.active');
});

test('extra devices polled on their own: the longest interval they ask for, else automatic', () => {
  expect(followersInterval([{ pollInterval: () => undefined }, {}])).toBeUndefined();
  expect(followersInterval([{ pollInterval: () => ROOM_POLL_INTERVAL }, { pollInterval: () => 5 * MINUTE }])).toBe(15 * MINUTE);
  expect(sharedPollCallsPerDay([ROOM_POLL_INTERVAL, 2 * MINUTE])).toBe(96 + 720);
  expect(sharedPollCallsPerDay([])).toBe(0);
});
