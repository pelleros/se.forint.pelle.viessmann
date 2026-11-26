/*
 *
 *  Copyright (C) 2024 Per Rosengren
 *  This file is part of se.forint.pelle.viessmann project.
 *
 *  se.forint.pelle.viessmann project is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  se.forint.pelle.viessmann project is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with se.forint.pelle.viessmann project.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

// @ts-check

'use strict';

// The holiday program's Flow actions. The dates a Flow card gives (Homey's date argument is
// DD-MM-YYYY; YYYY-MM-DD is accepted too) go to the API as YYYY-MM-DD, through commands.js like
// every other write.

const { PATHS } = require('./config');
const { sendFeatureCommand } = require('./commands');
const { userErrorFrom } = require('./userErrors');

const HOLIDAY_ACTIVE = 'measure_holiday_active';

/**
 * A date as YYYY-MM-DD, or null when it is no real date.
 * @param {unknown} text
 * @returns {string | null}
 */
function apiDate(text) {
  const match = String(text ?? '').trim().match(/^(\d{2})-(\d{2})-(\d{4})$|^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [year, month, day] = match[1] ? [match[3], match[2], match[1]] : [match[4], match[5], match[6]];
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCDate() === Number(day) && date.getUTCMonth() === Number(month) - 1 ? `${year}-${month}-${day}` : null;
}

/**
 * The parameters of the holiday program's `schedule` command. Throws an error with a code
 * (`holiday_invalid_date`, `holiday_end_before_start`) for dates that are no dates, an end
 * before the start, or the same day where the command says `sameDayAllowed: false`.
 * @param {unknown} start
 * @param {unknown} end
 * @param {Record<string, any> | undefined} scheduleCommand the command's metadata, if known
 * @returns {{ start: string, end: string }}
 */
function holidaySchedule(start, end, scheduleCommand) {
  const from = apiDate(start);
  const to = apiDate(end);
  if (!from || !to) throw Object.assign(new Error('Enter the dates as DD-MM-YYYY'), { code: 'holiday_invalid_date' });
  const sameDayAllowed = scheduleCommand?.params?.end?.constraints?.sameDayAllowed;
  if (to < from || (to === from && sameDayAllowed === false)) {
    throw Object.assign(new Error('The holiday must end after it starts'), { code: 'holiday_end_before_start' });
  }
  return { start: from, end: to };
}

/**
 * Schedules the holiday program from `start` to `end`; it shows as active once it has begun.
 * Throws the user's text for dates the device cannot take.
 * @param {import('./commands').CommandDevice} device
 * @param {unknown} start
 * @param {unknown} end
 * @returns {Promise<void>}
 */
async function startHoliday(device, start, end) {
  let parameters;
  try {
    parameters = holidaySchedule(start, end, device._commands?.[PATHS.HOLIDAY]?.schedule);
  } catch (error) {
    throw userErrorFrom(device, error);
  }
  await sendFeatureCommand(device, PATHS.HOLIDAY, 'schedule', parameters);
}

/**
 * Ends the holiday program, or cancels a scheduled one; the device shows it as off at once (also
 * in the status text).
 * @param {import('./commands').CommandDevice & {
 *   showWrittenValues: (values: Record<string, any>) => Promise<void> }} device
 * @returns {Promise<void>}
 */
async function endHoliday(device) {
  await sendFeatureCommand(device, PATHS.HOLIDAY, 'unschedule', {}, { confirm: { [HOLIDAY_ACTIVE]: false } });
  await device.showWrittenValues({ [HOLIDAY_ACTIVE]: false });
}

module.exports = {
  apiDate, holidaySchedule, startHoliday, endHoliday,
};
