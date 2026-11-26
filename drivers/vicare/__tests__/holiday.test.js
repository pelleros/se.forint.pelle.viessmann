/* eslint-env jest */

'use strict';

// holiday.js: the holiday program's Flow actions and their dates.

// lib/errorMessages.js (translations) loads homey-oauth2app through lib/apiError.js
// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const {
  apiDate, holidaySchedule, startHoliday, endHoliday,
} = require('../holiday');
const en = require('../../../locales/en.json');

const HOLIDAY = 'heating.operating.programs.holiday';

// A device that records what it sends, shows and has confirmed
function device(commands) {
  const remembered = [];
  return {
    remembered,
    _commands: commands,
    _installationId: 'installation',
    _gatewaySerial: 'gateway',
    _deviceId: '0',
    _heatingCircuitId: '0',
    homey: { __: () => undefined },
    oAuth2Client: { executeCommand: jest.fn(async () => ({ data: { success: true } })) },
    error: jest.fn(),
    getMonitor: () => ({ rememberWrite: (...args) => remembered.push(args) }),
    setCapabilityValueIfPossible: jest.fn(async () => {}),
  };
}
const sent = (target) => target.oAuth2Client.executeCommand.mock.calls.map(([request]) => [request.feature, request.command, request.body]);

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

test('starting the holiday program sends the dates; it shows as active once it has begun', async () => {
  const target = device();
  await startHoliday(target, '24-12-2026', '02-01-2027');
  expect(sent(target)).toEqual([[HOLIDAY, 'schedule', { start: '2026-12-24', end: '2027-01-02' }]]);
  expect(target.setCapabilityValueIfPossible).not.toHaveBeenCalled();
  expect(target.remembered).toEqual([]);
});

test('dates the device cannot take are refused in the user\'s language, and nothing is sent', async () => {
  const target = device({ [HOLIDAY]: { schedule: { isExecutable: true, params: { end: { constraints: { sameDayAllowed: false } } } } } });
  await expect(startHoliday(target, 'soon', '02-01-2027')).rejects.toMatchObject({ code: 'holiday_invalid_date', message: en.flow.holiday_invalid_date });
  await expect(startHoliday(target, '2026-03-10', '2026-03-10'))
    .rejects.toMatchObject({ code: 'holiday_end_before_start', message: en.flow.holiday_end_before_start });
  expect(sent(target)).toEqual([]);
});

test('ending the holiday program shows it as off and has that confirmed', async () => {
  const target = device();
  await endHoliday(target);
  expect(sent(target)).toEqual([[HOLIDAY, 'unschedule', {}]]);
  expect(target.setCapabilityValueIfPossible).toHaveBeenCalledWith('measure_holiday_active', false);
  expect(target.remembered).toEqual([['measure_holiday_active', false]]);
});
