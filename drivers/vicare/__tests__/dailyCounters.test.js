/* eslint-env jest */

'use strict';

// Daily figures of the starts and hours counters (dailyCounters.js): starts today and yesterday
// from a midnight baseline, the average run time per start yesterday, and starts in the last hour.

const {
  updateDailyCounter, startsInLastHour, localDate, nextDate, MIDNIGHT_GAP,
} = require('../dailyCounters');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const TZ = 'Europe/Stockholm';
// 26 Nov 2026, 12:00 in Stockholm (UTC+1)
const NOON = Date.parse('2026-11-26T11:00:00Z');
// Local midnight in Stockholm
const MIDNIGHT_27 = Date.parse('2026-11-26T23:00:00Z');

test('local dates in a time zone, and the next date', () => {
  expect(localDate(MIDNIGHT_27 - MINUTE, TZ)).toBe('2026-11-26');
  expect(localDate(MIDNIGHT_27, TZ)).toBe('2026-11-27');
  expect(nextDate('2026-12-31')).toBe('2027-01-01');
  expect(nextDate('2026-03-28')).toBe('2026-03-29');
});

describe('daily counters', () => {
  // Polls every 2 minutes from `from` to `to`, with the counter given per poll time
  function run(state, from, to, counter, step = 2 * MINUTE) {
    let result = { state };
    for (let time = from; time <= to; time += step) {
      result = updateDailyCounter(result.state, counter(time), time, TZ);
    }
    return result;
  }

  test('starts today need a midnight baseline: none on the first day', () => {
    const first = updateDailyCounter(undefined, { starts: 100, hours: 10 }, NOON, TZ);
    expect(first).toMatchObject({
      startsToday: null, startsYesterday: null, runtimePerStartYesterday: null, changed: true,
    });
    const later = updateDailyCounter(first.state, { starts: 103, hours: 10.5 }, NOON + HOUR, TZ);
    expect(later).toMatchObject({ startsToday: null, changed: true });
    expect(updateDailyCounter(later.state, { starts: 104, hours: 10.6 }, NOON + 2 * HOUR, TZ).changed).toBe(false);
  });

  test('across midnight: today counts from the last reading before midnight, yesterday follows a day later', () => {
    // 26 Nov: 100 starts at noon, one start an hour
    const starts = (time) => 100 + Math.floor((time - NOON) / HOUR);
    const hours = (time) => 10 + (time - NOON) / (2 * HOUR);
    const day1 = run(undefined, NOON, MIDNIGHT_27 + 10 * MINUTE, (time) => ({ starts: starts(time), hours: hours(time) }));
    // The baseline is the poll at 23:58; the start at midnight counts for the new day
    expect(day1.state.base).toEqual({ starts: 111, hours: hours(MIDNIGHT_27 - 2 * MINUTE) });
    expect(day1.startsToday).toBe(1);
    expect(day1.startsYesterday).toBeNull();

    const MIDNIGHT_28 = MIDNIGHT_27 + 24 * HOUR;
    const day2 = run(day1.state, MIDNIGHT_27 + 12 * MINUTE, MIDNIGHT_28 + 4 * MINUTE, (time) => ({ starts: starts(time), hours: hours(time) }));
    expect(day2.startsToday).toBe(1);
    expect(day2.startsYesterday).toBe(24);
    // 12 hours in 24 starts: 30 minutes per start
    expect(day2.runtimePerStartYesterday).toBe(30);
  });

  test('average run time per start needs enough run time for the counter\'s resolution', () => {
    const base = { starts: 100, hours: 1000 };
    const state = {
      date: '2026-11-26', at: MIDNIGHT_27 - MINUTE, starts: 110, hours: 1005, base, yesterday: null, fractionalHours: false,
    };
    // Whole hours only: 5 h is too little to divide by 10 starts
    expect(updateDailyCounter(state, { starts: 110, hours: 1005 }, MIDNIGHT_27 + MINUTE, TZ)).toMatchObject({
      startsYesterday: 10, runtimePerStartYesterday: null,
    });
    // A counter with tenths: 5 h over 10 starts is 30 minutes per start
    expect(updateDailyCounter({ ...state, fractionalHours: true }, { starts: 110, hours: 1005 }, MIDNIGHT_27 + MINUTE, TZ))
      .toMatchObject({ runtimePerStartYesterday: 30 });
    // 12 whole hours over 10 starts
    expect(updateDailyCounter({ ...state, hours: 1012 }, { starts: 110, hours: 1012 }, MIDNIGHT_27 + MINUTE, TZ))
      .toMatchObject({ runtimePerStartYesterday: 72 });
    // No starts: no average
    expect(updateDailyCounter({ ...state, starts: 100, hours: 1012 }, { starts: 100, hours: 1012 }, MIDNIGHT_27 + MINUTE, TZ))
      .toMatchObject({ startsYesterday: 0, runtimePerStartYesterday: null });
  });

  test('offline or restarted around midnight: no baseline for the new day, and no yesterday the day after', () => {
    const state = {
      date: '2026-11-26', at: MIDNIGHT_27 - 30 * MINUTE, starts: 110, hours: 1005, base: { starts: 100, hours: 1000 }, yesterday: null,
    };
    const late = updateDailyCounter(state, { starts: 111, hours: 1005 }, state.at + MIDNIGHT_GAP + MINUTE, TZ);
    expect(late).toMatchObject({ startsToday: null, startsYesterday: null });
    expect(late.state.base).toBeNull();
    // A whole day missed
    const skipped = updateDailyCounter(state, { starts: 140, hours: 1020 }, MIDNIGHT_27 + 24 * HOUR + MINUTE, TZ);
    expect(skipped).toMatchObject({ startsToday: null, startsYesterday: null });
  });

  test('a counter that goes backwards empties today\'s figure until the next midnight', () => {
    const state = {
      date: '2026-11-27', at: MIDNIGHT_27 + HOUR, starts: 110, hours: 1005, base: { starts: 100, hours: 1000 }, yesterday: null,
    };
    const reset = updateDailyCounter(state, { starts: 3, hours: 0 }, MIDNIGHT_27 + 2 * HOUR, TZ);
    expect(reset).toMatchObject({ startsToday: null, changed: true });
    expect(updateDailyCounter(reset.state, { starts: 5, hours: 1 }, MIDNIGHT_27 + 3 * HOUR, TZ).startsToday).toBeNull();
    // A reset at midnight gives no baseline either
    expect(updateDailyCounter({ ...state, date: '2026-11-26', at: MIDNIGHT_27 - MINUTE }, { starts: 2, hours: 0 }, MIDNIGHT_27 + MINUTE, TZ).state.base).toBeNull();
  });
});

describe('starts in the last hour', () => {
  test('the difference with the reading an hour ago, empty during the first hour', () => {
    const history = [];
    const results = [];
    for (let minute = 0; minute <= 90; minute += 2) results.push([minute, startsInLastHour(history, 100 + Math.floor(minute / 10), NOON + minute * MINUTE)]);
    expect(results.find(([minute]) => minute === 58)[1]).toBeNull();
    expect(results.find(([minute]) => minute === 60)[1]).toBe(6);
    expect(results.find(([minute]) => minute === 90)[1]).toBe(6);
  });

  test('a long gap or a counter that goes backwards gives nothing', () => {
    const history = [];
    startsInLastHour(history, 100, NOON);
    expect(startsInLastHour(history, 110, NOON + 2 * HOUR)).toBeNull();
    expect(startsInLastHour(history, 5, NOON + 3 * HOUR)).toBeNull();
    expect(startsInLastHour(history, 7, NOON + 4 * HOUR)).toBe(2);
  });
});
