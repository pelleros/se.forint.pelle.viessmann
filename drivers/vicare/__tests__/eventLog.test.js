/* eslint-env jest */

'use strict';

// The installation's event log (eventLog.js): the events of one device and which are new.

const {
  readEvents, newEvents, eventPositionFrom, startPosition, eventLogMinutes, matchesEventCode,
} = require('../eventLog');

const MINUTE = 60 * 1000;
const NOW = Date.parse('2026-11-26T11:00:00Z');
const event = (minutesAgo, errorCode, extra = {}) => ({
  eventType: 'device-error',
  eventTimestamp: new Date(NOW - minutesAgo * MINUTE).toISOString(),
  body: {
    errorCode, errorDescription: `Text of ${errorCode}`, active: true, deviceId: '0', ...extra,
  },
});

test('the setting gives the interval in minutes, or 0 when off', () => {
  expect(['off', '15', '60', undefined, '0'].map(eventLogMinutes)).toEqual([0, 15, 60, 0, 0]);
});

test('events of this device, oldest first; other devices and unusable entries are left out', () => {
  const response = {
    data: [event(1, 'F.160'), event(3, 'S.123', { active: false }), event(2, 'F.1', { deviceId: 'RoomControl-1' }),
      { eventType: 'gateway-offline', createdAt: new Date(NOW).toISOString() }, { body: {} }, null],
  };
  expect(readEvents(response, '0')).toEqual([
    {
      code: 'S.123', description: 'Text of S.123', type: 'device-error', active: false, time: NOW - 3 * MINUTE,
    },
    {
      code: 'F.160', description: 'Text of F.160', type: 'device-error', active: true, time: NOW - MINUTE,
    },
    {
      code: 'gateway-offline', description: '', type: 'gateway-offline', active: true, time: NOW,
    },
  ]);
  expect(readEvents([event(1, 'X')], '0')).toHaveLength(1);
  expect(readEvents(undefined, '0')).toEqual([]);
});

test('only events after the read position count, and not those older than `since`', () => {
  const position = startPosition(null, NOW - 30 * MINUTE);
  expect(startPosition(position, NOW)).toBe(position);
  const response = { data: [event(40, 'old'), event(20, 'A'), event(10, 'B')] };
  const first = newEvents(response, '0', position, NOW - 15 * MINUTE);
  expect(first.events.map((item) => item.code)).toEqual(['B']);
  expect(first.position).toEqual({ at: NOW - 10 * MINUTE, keys: [expect.stringContaining('B')] });
  expect(newEvents(response, '0', first.position, 0)).toMatchObject({ events: [], changed: false });
});

test('a stored position is read back, a broken one is none', () => {
  expect(eventPositionFrom({ at: NOW, keys: ['k'] })).toEqual({ at: NOW, keys: ['k'] });
  expect(eventPositionFrom({ at: 'x', keys: [] })).toBeNull();
});

test('the code card matches its code, whatever the case', () => {
  expect(matchesEventCode({ code: ' f.160 ' }, { code: 'F.160' })).toBe(true);
  expect(matchesEventCode({ code: 'F.16' }, { code: 'F.160' })).toBe(false);
  expect(matchesEventCode({}, { code: 'F.160' })).toBe(false);
});
