/* eslint-env jest */

'use strict';

// The values a device computes itself (computedValues.js): power in W from the device's own
// reading, Viessmann's consumption figure for yesterday, and the daily figures of the starts and
// hours counters. Each is empty (null) without a sound basis.

const {
  ComputedValues, powerInWatts, yesterdayConsumption, updateDailyCounter, startsInLastHour, localDate, MIDNIGHT_GAP,
} = require('../computedValues');
const { PATHS } = require('../config');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const TZ = 'Europe/Stockholm';
// 26 Nov 2026, 12:00 in Stockholm (UTC+1)
const NOON = Date.parse('2026-11-26T11:00:00Z');
// Local midnight in Stockholm
const MIDNIGHT_27 = Date.parse('2026-11-26T23:00:00Z');

const feature = (path, properties, extra = {}) => ({
  feature: path, isEnabled: true, properties, ...extra,
});
const power = (value, unit = 'kilowatt', status = 'connected') => ({ status: { value: status }, value: { type: 'number', unit, value } });
const days = (values, readAt, unit = 'kilowattHour') => ({
  day: { type: 'array', unit, value: values },
  dayValueReadAt: { type: 'string', value: readAt },
});
const stats = (starts, hours) => ({ starts: { value: starts }, hours: { value: hours, unit: 'hour' } });

describe('power', () => {
  test.each([
    [power(0.916), 916],
    [power(736, 'watt'), 736],
    [power(0), 0],
    [power(6.7, 'ampere'), undefined],
    [power(null), undefined],
    [{}, undefined],
    [undefined, undefined],
  ])('%j is %p W', (properties, watts) => {
    expect(powerInWatts(properties)).toBe(watts);
  });

  const read = (data, roles = ['type:heatpump']) => new ComputedValues().read({ data }, roles, { now: NOON, timeZone: TZ }).values.get('measure_power');

  test('the device\'s own consumption comes first, the inverter output second', () => {
    expect(read([feature(PATHS.POWER_CONSUMPTION, power(0.916)), feature(PATHS.INVERTER_POWER, power(736, 'watt'))])).toEqual({ value: 916 });
    expect(read([feature(PATHS.INVERTER_POWER, power(736, 'watt'))])).toEqual({ value: 736 });
    expect(read([feature(PATHS.POWER_CONSUMPTION, power(null, 'kilowatt', 'notConnected')), feature(PATHS.INVERTER_POWER, power(1508, 'watt'))]))
      .toEqual({ value: 1508 });
    // A unit the app does not know is no value: the other source, or empty
    expect(read([feature(PATHS.POWER_CONSUMPTION, power(4, 'ampere')), feature(PATHS.INVERTER_POWER, power(800, 'watt'))])).toEqual({ value: 800 });
    expect(read([feature(PATHS.POWER_CONSUMPTION, power(4, 'ampere'))])).toEqual({ value: null });
  });

  test('a datapoint that is gone empties the value; a response without mapped features keeps it', () => {
    expect(read([feature(PATHS.HOT_WATER_TEMP, { value: { value: 45 } })])).toEqual({ value: null });
    expect(read([feature('some.unmapped.feature', { value: { value: 1 } })])).toBeUndefined();
  });
});

describe('yesterday\'s consumption', () => {
  test('day[1] is yesterday when the values were read today (Homey\'s time zone)', () => {
    expect(yesterdayConsumption(days([1.2, 5.5, 4.2], '2026-11-26T06:10:00Z'), NOON, TZ)).toEqual({ value: 5.5, units: 'kWh' });
    // 23:30 UTC on the 25th is 00:30 on the 26th in Stockholm
    expect(yesterdayConsumption(days([0, 5.5], '2026-11-25T23:30:00Z'), NOON, TZ)).toEqual({ value: 5.5, units: 'kWh' });
    expect(yesterdayConsumption(days([0, 5.5], '2026-11-25T23:30:00Z'), NOON, 'UTC')).toEqual({ value: null, units: 'kWh' });
  });

  test('values read before today are stale: no figure, whatever day[1] says', () => {
    expect(yesterdayConsumption(days([3, 5.5], '2026-11-25T20:00:00Z'), NOON, TZ)).toEqual({ value: null, units: 'kWh' });
    expect(yesterdayConsumption(days([3, 5.5], '2026-11-22T20:00:00Z'), NOON, TZ)).toEqual({ value: null, units: 'kWh' });
    expect(yesterdayConsumption(days([3, 5.5], 'not a date'), NOON, TZ)).toEqual({ value: null, units: 'kWh' });
    expect(yesterdayConsumption(days([3], '2026-11-26T06:00:00Z'), NOON, TZ)).toEqual({ value: null, units: 'kWh' });
  });

  test('the unit comes from the response; an unknown unit gives nothing', () => {
    expect(yesterdayConsumption(days([0.5, 1.4], '2026-11-26T06:00:00Z', 'cubicMeter'), NOON, TZ)).toEqual({ value: 1.4, units: 'm³' });
    expect(yesterdayConsumption(days([0, 2500], '2026-11-26T06:00:00Z', 'wattHour'), NOON, TZ)).toEqual({ value: 2.5, units: 'kWh' });
    expect(yesterdayConsumption(days([0, 2], '2026-11-26T06:00:00Z', 'liter'), NOON, TZ)).toEqual({ value: null, units: undefined });
  });

  test('electricity is only shown in kWh; gas in the unit the device reports', () => {
    const computed = new ComputedValues();
    const { values } = computed.read({
      data: [
        feature(PATHS.ELECTRICITY_TOTAL, days([0, 5.5], '2026-11-26T06:00:00Z')),
        feature(PATHS.ELECTRICITY_HEATING, days([0, 2], '2026-11-26T06:00:00Z', 'cubicMeter')),
        feature(PATHS.GAS_TOTAL, days([0, 31], '2026-11-26T06:00:00Z', 'kilowattHour')),
        feature(PATHS.GAS_HEATING, days([0, 1.4], '2026-11-25T06:00:00Z', 'cubicMeter')),
      ],
    }, [], { now: NOON, timeZone: TZ });
    expect(values.get('measure_electricity_yesterday.total')).toEqual({ value: 5.5, units: 'kWh' });
    expect(values.get('measure_electricity_yesterday.heating')).toEqual({ value: null });
    expect(values.get('measure_gas_yesterday.total')).toEqual({ value: 31, units: 'kWh' });
    expect(values.get('measure_gas_yesterday.heating')).toEqual({ value: null, units: 'm³' });
    // Not reported at all: empty
    expect(values.get('measure_gas_yesterday.hotWater')).toEqual({ value: null });
  });

  test('without a known time zone there is no figure', () => {
    const { values } = new ComputedValues().read({ data: [feature(PATHS.ELECTRICITY_TOTAL, days([0, 5.5], '2026-11-26T06:00:00Z'))] }, [], { now: NOON });
    expect(values.get('measure_electricity_yesterday.total')).toEqual({ value: null, units: 'kWh' });
  });
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

describe('ComputedValues', () => {
  test('daily figures need the role of their counter, and report when the state should be stored', () => {
    const computed = new ComputedValues();
    const response = { data: [feature(PATHS.COMPRESSOR_STATS, stats(100, 10.5)), feature(PATHS.BURNER_STATS, stats(50, 3))] };
    const boiler = computed.read(response, ['type:boiler'], { now: NOON, timeZone: TZ });
    expect(boiler.values.has('measure_compressor_number.compressorStartsToday')).toBe(false);
    expect(boiler.values.get('measure_burner_number.burnerStartsToday')).toEqual({ value: null });
    expect(boiler.countersChanged).toBe(true);
    expect(Object.keys(computed.dailyCounters)).toEqual([PATHS.BURNER_STATS]);
    expect(computed.read(response, ['type:boiler'], { now: NOON + MINUTE, timeZone: TZ }).countersChanged).toBe(false);
  });

  test('stored state survives a restart: today\'s figure continues', () => {
    const dailyCounters = {
      [PATHS.BURNER_STATS]: {
        date: localDate(NOON, TZ), at: NOON - HOUR, starts: 45, hours: 3, base: { starts: 40, hours: 2 }, yesterday: { starts: 12, hours: 4 },
      },
    };
    const { values } = new ComputedValues({ dailyCounters }).read({ data: [feature(PATHS.BURNER_STATS, stats(50, 3))] }, [], { now: NOON, timeZone: TZ });
    expect(values.get('measure_burner_number.burnerStartsToday')).toEqual({ value: 10 });
    expect(values.get('measure_burner_number.burnerStartsYesterday')).toEqual({ value: 12 });
    // 4 whole hours are too little to divide over 12 starts
    expect(values.get('measure_burner_number.burnerRuntimePerStartYesterday')).toEqual({ value: null });
  });
});
