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

// Daily figures of a starts and hours counter (compressor, burner), as exact differences from a
// midnight baseline in Homey's time zone: starts today, starts yesterday and the average run time
// per start yesterday; and starts in the last hour. Pure functions on plain state: the device
// keeps the state per counter in its store (`dailyCounters`), the hourly readings in memory.

const MINUTE = 60 * 1000;
// The longest gap between the last poll before midnight and the first one after it that still
// gives a midnight baseline: the device's poll interval plus MIDNIGHT_SLACK (a slow response, a
// short backoff), and never less than MIDNIGHT_GAP, which is also the gap when the interval is
// not known. A longer gap (the app was off, or a long backoff) gives no baseline for the day. A
// start in the gap counts for the new day (the resolution of the poll interval).
const MIDNIGHT_GAP = 35 * MINUTE;
const MIDNIGHT_SLACK = 10 * MINUTE;
// "Starts in the last hour" compares with the newest reading at least an hour old, at most this
// much older. It does not follow the poll interval on purpose: with hourly polling the reading
// one poll back (an hour and a few seconds) is still taken, but with polls more than about
// 95 minutes apart the figure would cover far more than an hour, so it stays empty.
const HOUR_TOLERANCE = 35 * MINUTE;
// Average run time per start only when the run time is at least this many times the resolution
// of the hours counter (0.1 h, or 1 h for counters that only count whole hours): at most 10 % off
const RUNTIME_RESOLUTION_FACTOR = 10;

/**
 * @param {unknown} value
 * @returns {value is number}
 */
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Midnight baseline of a counter and yesterday's differences.
 * @typedef {object} CounterState
 * @property {string} date local date of the last reading
 * @property {number} at time of the last reading
 * @property {number} starts last starts value
 * @property {number | null} hours last hours value
 * @property {{ starts: number, hours: number | null } | null} base the counters at midnight today
 * @property {{ starts: number, hours: number | null } | null} yesterday yesterday's differences
 * @property {boolean} [fractionalHours] the hours counter has shown tenths
 */

/**
 * @typedef {object} DailyFigures
 * @property {number | null} startsToday
 * @property {number | null} startsYesterday
 * @property {number | null} runtimePerStartYesterday minutes
 */

/**
 * The longest gap around midnight that still gives a baseline, for a poll interval.
 * @param {number | undefined} [pollInterval] milliseconds
 * @returns {number}
 */
function midnightGap(pollInterval) {
  return isNumber(pollInterval) && pollInterval > 0 ? Math.max(MIDNIGHT_GAP, pollInterval + MIDNIGHT_SLACK) : MIDNIGHT_GAP;
}

/**
 * The local date (YYYY-MM-DD) of a moment in a time zone.
 * @param {number} time epoch milliseconds
 * @param {string} timeZone
 * @returns {string}
 */
function localDate(time, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(time));
}

/**
 * The date after a local date.
 * @param {string} date YYYY-MM-DD
 * @returns {string}
 */
function nextDate(date) {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/**
 * The state after a reading on a new day: the last reading before midnight is the new day's
 * baseline when the readings are continuous (next day, a gap of at most `gap`, counter not
 * reset); yesterday's differences need yesterday's baseline as well.
 * @param {CounterState} state
 * @param {{ starts: number, hours: number | null }} reading
 * @param {number} now
 * @param {string} date
 * @param {number} gap see midnightGap
 * @returns {CounterState}
 */
function startDay(state, reading, now, date, gap) {
  const continuous = nextDate(state.date) === date && now >= state.at && now - state.at <= gap
    && reading.starts >= state.starts;
  const end = { starts: state.starts, hours: isNumber(state.hours) ? state.hours : null };
  const yesterday = continuous && state.base ? {
    starts: end.starts - state.base.starts,
    hours: end.hours !== null && isNumber(state.base.hours) ? end.hours - state.base.hours : null,
  } : null;
  return {
    date, at: now, starts: reading.starts, hours: reading.hours, base: continuous ? end : null, yesterday,
  };
}

/**
 * The figures a state gives for a starts reading.
 * @param {CounterState} state
 * @param {number} starts
 * @returns {DailyFigures}
 */
function figures(state, starts) {
  const { base, yesterday } = state;
  const ran = yesterday?.hours;
  const resolution = state.fractionalHours ? 0.1 : 1;
  const enoughRuntime = yesterday && yesterday.starts > 0 && isNumber(ran) && ran >= RUNTIME_RESOLUTION_FACTOR * resolution;
  return {
    startsToday: base && starts >= base.starts ? starts - base.starts : null,
    startsYesterday: yesterday ? yesterday.starts : null,
    runtimePerStartYesterday: enoughRuntime ? Math.round((/** @type {number} */ (ran) * 60) / yesterday.starts) : null,
  };
}

/**
 * The daily figures of a counter after a new reading, and its new state (`changed` when it should
 * be stored: rarely, at a new day or when a baseline is dropped). A counter that goes backwards
 * drops today's baseline.
 * @param {CounterState | undefined} state
 * @param {{ starts: number, hours?: unknown }} reading
 * @param {number} now
 * @param {string} timeZone
 * @param {{ pollInterval?: number }} [options] the device's poll interval (see midnightGap)
 * @returns {DailyFigures & { state: CounterState, changed: boolean }}
 */
function updateDailyCounter(state, reading, now, timeZone, { pollInterval } = {}) {
  const date = localDate(now, timeZone);
  const current = { starts: reading.starts, hours: isNumber(reading.hours) ? reading.hours : null };
  const fractionalHours = Boolean(state?.fractionalHours) || (current.hours !== null && !Number.isInteger(current.hours));
  /** @type {CounterState} */
  let next;
  let changed = true;
  if (!state || typeof state.date !== 'string' || !isNumber(state.starts)) {
    next = {
      date, at: now, ...current, base: null, yesterday: null,
    };
  } else if (state.date !== date) {
    next = startDay(state, current, now, date, midnightGap(pollInterval));
  } else {
    const backwards = current.starts < state.starts || (current.hours !== null && isNumber(state.hours) && current.hours < state.hours);
    next = {
      ...state, at: now, ...current, base: backwards ? null : state.base,
    };
    changed = (backwards && state.base !== null) || fractionalHours !== Boolean(state.fractionalHours);
  }
  next.fractionalHours = fractionalHours;
  return { ...figures(next, current.starts), state: next, changed };
}

/**
 * Starts in the last hour from the starts counter: the difference with the newest reading at
 * least an hour old, if that reading is not much older (see HOUR_TOLERANCE). The readings are kept
 * in memory only, so the figure is empty for the first hour after a start of the app.
 * @param {{ at: number, starts: number }[]} history readings, oldest first (changed in place)
 * @param {number} starts
 * @param {number} now
 * @returns {number | null}
 */
function startsInLastHour(history, starts, now) {
  if (history.length > 0 && starts < history[history.length - 1].starts) history.splice(0);
  history.push({ at: now, starts });
  const hourAgo = now - 60 * MINUTE;
  while (history.length > 1 && history[1].at <= hourAgo) history.shift();
  const reference = history[0];
  if (reference.at > hourAgo || reference.at < hourAgo - HOUR_TOLERANCE) return null;
  return starts - reference.starts;
}

module.exports = {
  updateDailyCounter, startsInLastHour, localDate, nextDate, midnightGap, MIDNIGHT_GAP, MIDNIGHT_SLACK, HOUR_TOLERANCE,
};
