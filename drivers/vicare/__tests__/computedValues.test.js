/* eslint-env jest */

'use strict';

// The values a device computes itself (computedValues.js): power in W from the device's own
// reading, Viessmann's consumption figure for yesterday, and which daily figures of the starts
// counters a device gets (the counting itself: dailyCounters.test.js). Each is empty (null)
// without a sound basis.

const { ComputedValues, powerInWatts, yesterdayConsumption } = require('../computedValues');
const { localDate } = require('../dailyCounters');
const { PATHS } = require('../config');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const TZ = 'Europe/Stockholm';
// 26 Nov 2026, 12:00 in Stockholm (UTC+1)
const NOON = Date.parse('2026-11-26T11:00:00Z');

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
