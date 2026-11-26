/* eslint-env jest */

'use strict';

// holiday.js: the dates of the holiday program.

const { apiDate, holidaySchedule } = require('../holiday');

test('a date from a Flow card (DD-MM-YYYY or YYYY-MM-DD) becomes YYYY-MM-DD; no date is null', () => {
  expect(apiDate('24-12-2026')).toBe('2026-12-24');
  expect(apiDate(' 2027-01-02 ')).toBe('2027-01-02');
  expect(apiDate('31-02-2026')).toBeNull();
  expect(apiDate('2026-13-01')).toBeNull();
  expect(apiDate('soon')).toBeNull();
  expect(apiDate(undefined)).toBeNull();
});

test('the schedule needs real dates and an end after the start', () => {
  expect(holidaySchedule('24-12-2026', '02-01-2027', undefined)).toEqual({ start: '2026-12-24', end: '2027-01-02' });
  expect(() => holidaySchedule('soon', '02-01-2027')).toThrow(expect.objectContaining({ code: 'holiday_invalid_date' }));
  expect(() => holidaySchedule('10-03-2026', '03-03-2026')).toThrow(expect.objectContaining({ code: 'holiday_end_before_start' }));
});

test('one day is allowed unless the command says sameDayAllowed: false', () => {
  const command = (sameDayAllowed) => ({ params: { end: { constraints: { sameDayAllowed } } } });
  expect(holidaySchedule('2026-03-10', '2026-03-10', command(true))).toEqual({ start: '2026-03-10', end: '2026-03-10' });
  expect(holidaySchedule('2026-03-10', '2026-03-10', undefined).end).toBe('2026-03-10');
  expect(() => holidaySchedule('2026-03-10', '2026-03-10', command(false))).toThrow(expect.objectContaining({ code: 'holiday_end_before_start' }));
});
