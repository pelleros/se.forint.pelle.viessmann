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

// Limits the commands one device sends to Viessmann, which count against the daily API quota:
// the same command (one command of one feature) runs at most once per `minInterval`, and when
// more arrive meanwhile only the latest is sent. A Flow loop or a voice assistant that sends
// many set points in a row therefore costs a few calls, not hundreds. On top of that, a device
// sends at most `maxPerWindow` commands per `window`; more are refused with an error.

/**
 * @typedef {object} WriteLimiterOptions
 * @property {number} [minInterval] least time between two runs of the same command, in ms
 * @property {number} [maxPerWindow] most commands per window
 * @property {number} [window] in ms
 * @property {() => number} [now]
 * @property {(callback: () => void, ms: number) => any} [setTimeout]
 * @property {(timer: any) => void} [clearTimeout]
 */

class WriteLimiter {

  /** @param {WriteLimiterOptions} [options] */
  constructor({
    minInterval = 10 * 1000,
    maxPerWindow = 30,
    window = 60 * 60 * 1000,
    now = Date.now,
    setTimeout: schedule = setTimeout,
    clearTimeout: cancel = clearTimeout,
  } = {}) {
    this.minInterval = minInterval;
    this.maxPerWindow = maxPerWindow;
    this.window = window;
    this.now = now;
    this.schedule = schedule;
    this.cancel = cancel;
    /** @type {Map<string, number>} when each command last ran */
    this.lastRun = new Map();
    /** @type {Map<string, { timer: any, resolve: (ran: boolean) => void }>} */
    this.pending = new Map();
    /** @type {number[]} when the commands of the current window ran */
    this.history = [];
  }

  /**
   * Runs `task`, the command `key`, no sooner than `minInterval` after its previous run. A
   * command that has to wait is replaced by a newer one with the same key: the replaced one
   * resolves false without running. Resolves true once the task has run; rejects with the
   * task's error, or, without running it, when the window's limit is reached.
   * @param {string} key
   * @param {() => Promise<any>} task
   * @returns {Promise<boolean>}
   */
  run(key, task) {
    const waiting = this.pending.get(key);
    if (waiting) {
      this.cancel(waiting.timer);
      this.pending.delete(key);
      waiting.resolve(false);
    }
    const last = this.lastRun.get(key);
    const wait = last === undefined ? 0 : last + this.minInterval - this.now();
    if (wait <= 0) return this.execute(key, task);
    return new Promise((resolve, reject) => {
      const timer = this.schedule(() => {
        this.pending.delete(key);
        this.execute(key, task).then(resolve, reject);
      }, wait);
      this.pending.set(key, { timer, resolve });
    });
  }

  /**
   * @param {string} key
   * @param {() => Promise<any>} task
   * @returns {Promise<boolean>}
   */
  async execute(key, task) {
    const now = this.now();
    this.history = this.history.filter((time) => time > now - this.window);
    if (this.history.length >= this.maxPerWindow) {
      throw Object.assign(new Error(`Too many commands: at most ${this.maxPerWindow} per hour, try again later`), {
        code: 'too_many_commands',
      });
    }
    this.history.push(now);
    this.lastRun.set(key, now);
    await task();
    return true;
  }

  // Drops the commands that are still waiting (they resolve false), e.g. when the device is deleted
  stop() {
    for (const waiting of this.pending.values()) {
      this.cancel(waiting.timer);
      waiting.resolve(false);
    }
    this.pending.clear();
  }

}

module.exports = WriteLimiter;
