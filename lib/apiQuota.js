// @ts-check

'use strict';

// Counts the app's calls to the Viessmann API per Viessmann login (OAuth session) and UTC day.
// Viessmann's free plan allows about 1,450 calls a day per account, shared with every other
// integration that uses the same client, and the count resets at 00:00 UTC. The app has no way
// to read Viessmann's own count, so this is the app's share only. Stored in the app settings
// (`apiCallsToday`), written at most once a minute.

const DAILY_LIMIT = 1450;
// Planned updates (polls and event log reads) may use at most this many, so that adding devices,
// the maintenance action and troubleshooting still have calls left
const PLANNED_LIMIT = 1400;
const SETTINGS_KEY = 'apiCallsToday';
const SAVE_INTERVAL = 60 * 1000;

/** @type {WeakMap<object, ApiQuota>} */
const instances = new WeakMap();

/**
 * The UTC date (YYYY-MM-DD) of a moment.
 * @param {number} time
 * @returns {string}
 */
const utcDate = (time) => new Date(time).toISOString().slice(0, 10);

/**
 * Calls a day for a poll interval in minutes.
 * @param {number} minutes
 * @returns {number}
 */
const callsPerDay = (minutes) => (minutes > 0 ? Math.ceil((24 * 60) / minutes) : 0);

class ApiQuota {

  /**
   * The counter of an app instance (one per Homey).
   * @param {any} homey
   * @returns {ApiQuota}
   */
  static for(homey) {
    // Without a Homey (tests, tools) the count is kept by a throw-away counter
    if (!homey || typeof homey !== 'object') return new ApiQuota(undefined);
    let quota = instances.get(homey);
    if (!quota) {
      quota = new ApiQuota(homey);
      instances.set(homey, quota);
    }
    return quota;
  }

  /**
   * @param {any} homey
   */
  constructor(homey) {
    this.homey = homey;
    /** @type {{ date: string, sessions: Record<string, number> }} */
    this.state = { date: '', sessions: {} };
    this.savedAt = 0;
    this.load();
  }

  load() {
    try {
      const stored = this.homey?.settings?.get?.(SETTINGS_KEY);
      if (stored && typeof stored.date === 'string' && stored.sessions && typeof stored.sessions === 'object') {
        this.state = { date: stored.date, sessions: { ...stored.sessions } };
      }
    } catch (error) {
      // a fresh count
    }
  }

  save(now) {
    try {
      this.homey?.settings?.set?.(SETTINGS_KEY, this.state);
      this.savedAt = now;
    } catch (error) {
      // counted in memory; saved with the next call
    }
  }

  /**
   * Starts a new count at 00:00 UTC.
   * @param {number} now
   */
  rollOver(now) {
    const today = utcDate(now);
    if (this.state.date !== today) {
      this.state = { date: today, sessions: {} };
      return true;
    }
    return false;
  }

  /**
   * Counts one API call of a session.
   * @param {string | undefined} sessionId
   * @param {number} [now]
   */
  count(sessionId, now = Date.now()) {
    const newDay = this.rollOver(now);
    const key = sessionId || 'unknown';
    this.state.sessions[key] = (this.state.sessions[key] || 0) + 1;
    if (newDay || now - this.savedAt >= SAVE_INTERVAL) this.save(now);
  }

  /**
   * Calls of a session today (UTC).
   * @param {string | undefined} sessionId
   * @param {number} [now]
   * @returns {number}
   */
  usedToday(sessionId, now = Date.now()) {
    this.rollOver(now);
    return this.state.sessions[sessionId || 'unknown'] || 0;
  }

}

module.exports = {
  ApiQuota, DAILY_LIMIT, PLANNED_LIMIT, callsPerDay, utcDate, SETTINGS_KEY,
};
