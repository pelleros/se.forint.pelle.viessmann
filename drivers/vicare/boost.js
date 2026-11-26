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

// Temporary changes from Flow cards ("boosts") that are undone after a number of minutes:
//
//   hotWater        the hot water target, restored to the previous target
//   curveShift      the heating curve shift, restored to the previous shift
//   hotWaterCharge  a one-time hot water charge, stopped if the charge this boost started still
//                   runs
//
// What has to be restored is kept in the store (key `boostRestores`) before the change is
// sent, so a restart of Homey or the app does not lose it: on start, every pending restore is
// scheduled again (one that is due runs shortly after the first poll). A restore only undoes
// the boost's own change: when the value was changed in the meantime (by the user, a Flow or
// the controller), it is left as it is. A new boost of the same kind while one runs keeps the
// original previous value and extends the end time. A restore that fails is retried every few
// minutes for a day.
//
// A charge ends by itself, and another one can start later (by the controller, the user or a
// Flow), so the charge boost stops only the charge it started itself and has seen running ever
// since: the device reports every change of the charge (valueChanged), and once it is seen
// ended, the restore is done and a later charge is never touched. After a restart that cannot be
// told any more, so a stored charge restore then lets the charge end by itself. A charge that
// already runs when the card runs is not this boost's either.

const { featureMapper } = require('./featureMapper');
const { capabilityCommand, checkFeatureCommand } = require('./commands');
const { userError } = require('./userErrors');
const { takeWrite } = require('./writeLimits');
const heatingCurve = require('./heatingCurve');

const STORE_KEY = 'boostRestores';
const MINUTE = 60 * 1000;
const RETRY_MS = 5 * MINUTE;
const GIVE_UP_MS = 24 * 60 * MINUTE;
// After a start, wait for the first poll before restoring, so the comparison uses current values
const STARTUP_DELAY_MS = 2 * MINUTE;

const HOT_WATER_TARGET = 'target_temperature.hotWater';
const HOT_WATER_CHARGE = 'thermostat_mode.hotWaterOneTimeCharge';

/**
 * @typedef {{ previous?: number, boosted?: number, until: number }} Restore
 * @typedef {Record<string, Restore>} Restores
 */

/**
 * @typedef {import('./heatingCurve').CurveDevice & {
 *   getStoreValue: (key: string) => any,
 *   setStoreValue: (key: string, value: any) => Promise<any>,
 *   executeCommand: (path: string, capability: any, value: any) => Promise<any>,
 *   log: (...args: any[]) => void,
 *   homey: { setTimeout: (fn: () => void, ms: number) => any, clearTimeout: (timer: any) => void,
 *     __?: (key: string, tags?: Record<string, any>) => any },
 * }} BoostDevice
 */

/**
 * The feature path, capability, command and parameters of writing `value` to a capability.
 * @param {string} capabilityName
 * @param {any} value
 */
function capabilityWrite(capabilityName, value) {
  const target = featureMapper.commandTarget(capabilityName);
  if (!target) throw new Error(`${capabilityName} cannot be written`);
  return { path: target.path, capability: target.capability, ...capabilityCommand(target.capability, value) };
}

/**
 * Writes a capability through the device (which checks, sends and then shows the value).
 * @param {BoostDevice} device
 * @param {string} capabilityName
 * @param {any} value
 */
async function writeCapability(device, capabilityName, value) {
  const write = capabilityWrite(capabilityName, value);
  await device.executeCommand(write.path, write.capability, value);
}

// How each kind of boost is undone, if it is still in effect
/** @type {Record<string, (device: BoostDevice, restore: Restore, owns: boolean) => Promise<void>>} */
const UNDO = {
  async hotWater(device, restore) {
    const current = device.getCapabilityValue(HOT_WATER_TARGET);
    if (current == null) throw userError(device, 'value_unknown');
    if (current !== restore.boosted) {
      device.log('Hot water target was changed in the meantime, leaving it as it is');
    } else if (restore.previous !== restore.boosted) {
      await writeCapability(device, HOT_WATER_TARGET, restore.previous);
    }
  },
  async curveShift(device, restore) {
    const { shift } = heatingCurve.currentCurve(device);
    if (shift !== restore.boosted || typeof restore.previous !== 'number') {
      device.log('Heating curve shift was changed in the meantime, leaving it as it is');
    } else {
      await heatingCurve.writeCurve(device, { shift: restore.previous }, { limited: false });
    }
  },
  // `owns`: the charge running now is the one this boost started (see valueChanged)
  async hotWaterCharge(device, restore, owns) {
    if (!owns) {
      device.log('Leaving the one-time charge to end by itself: it cannot be told apart from a later one');
    } else if (device.getCapabilityValue(HOT_WATER_CHARGE) === 'activate') {
      await writeCapability(device, HOT_WATER_CHARGE, 'deactivate');
    }
  },
};

class BoostController {

  /**
   * @param {BoostDevice} device
   * @param {{ now?: () => number }} [options]
   */
  constructor(device, { now = Date.now } = {}) {
    this.device = device;
    this.now = now;
    /** @type {Record<string, any>} */
    this.timers = {};
    /** @type {Promise<any>} */
    this.queue = Promise.resolve();
    this.stopped = false;
    // The kinds whose change this boost has seen in effect without a break since it made it.
    // In memory only: after a restart nothing is owned (see the charge above)
    /** @type {Set<string>} */
    this.owned = new Set();
  }

  /** @returns {Restores} */
  restores() {
    const stored = this.device.getStoreValue(STORE_KEY);
    return stored && typeof stored === 'object' ? { ...stored } : {};
  }

  /** @param {Restores} restores */
  async save(restores) {
    await this.device.setStoreValue(STORE_KEY, restores);
  }

  /**
   * Runs `task` after the boost changes that are already running, one at a time.
   * @template T
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  exclusive(task) {
    const run = this.queue.then(task);
    this.queue = run.catch(() => {});
    return run;
  }

  /**
   * Sets the hot water target to `temperature` for `minutes`, then restores the previous one.
   * @param {number} temperature
   * @param {number} minutes
   */
  async boostHotWater(temperature, minutes) {
    return this.exclusive(async () => {
      const current = this.device.getCapabilityValue(HOT_WATER_TARGET);
      const running = this.restores().hotWater;
      const previous = running ? running.previous : current;
      if (typeof previous !== 'number' || typeof current !== 'number') throw userError(this.device, 'value_unknown');
      const write = capabilityWrite(HOT_WATER_TARGET, temperature);
      const changes = current !== temperature;
      if (changes) {
        checkFeatureCommand(this.device, write.path, write.command, write.parameters);
        takeWrite(this.device, 'hotWaterBoost', this.now);
      }
      await this.start('hotWater', { previous, boosted: temperature, until: this.endTime(running, minutes) }, async () => {
        if (changes) await writeCapability(this.device, HOT_WATER_TARGET, temperature);
      });
    });
  }

  /**
   * Changes the heating curve shift by `change` for `minutes`, then restores the previous one.
   * @param {number} change
   * @param {number} minutes
   */
  async boostCurveShift(change, minutes) {
    return this.exclusive(async () => {
      const { shift: current } = heatingCurve.currentCurve(this.device);
      const running = this.restores().curveShift;
      const previous = running?.previous ?? current;
      const boosted = heatingCurve.roundToStep(previous + change, this.device._commands?.[heatingCurve.CURVE_PATH]
        ?.setCurve?.params?.shift?.constraints);
      await this.start('curveShift', { previous, boosted, until: this.endTime(running, minutes) }, async () => {
        await heatingCurve.writeCurve(this.device, { shift: boosted });
      });
    });
  }

  /**
   * Starts a one-time hot water charge and stops it after `minutes` if it still runs.
   * @param {number} minutes
   */
  async boostHotWaterCharge(minutes) {
    return this.exclusive(async () => {
      const running = this.restores().hotWaterCharge;
      const active = this.device.getCapabilityValue(HOT_WATER_CHARGE) === 'activate';
      if (active && !this.owned.has('hotWaterCharge')) {
        // Someone else's charge: it ends by itself, and this boost will not stop it
        this.device.log('A one-time charge is already running; leaving it as it is');
        return;
      }
      const write = capabilityWrite(HOT_WATER_CHARGE, 'activate');
      if (!active) {
        checkFeatureCommand(this.device, write.path, write.command, write.parameters);
        takeWrite(this.device, 'hotWaterCharge', this.now);
      }
      await this.start('hotWaterCharge', { until: this.endTime(running, minutes) }, async () => {
        if (!active) await writeCapability(this.device, HOT_WATER_CHARGE, 'activate');
        this.owned.add('hotWaterCharge');
      });
    });
  }

  /**
   * Called by the device for every change of a capability value. A charge seen ended after
   * this boost started it ends the charge boost: there is nothing left to stop.
   * @param {string} capabilityName
   * @param {any} value as the capability shows it
   */
  async valueChanged(capabilityName, value) {
    if (capabilityName !== HOT_WATER_CHARGE || value === 'activate' || !this.restores().hotWaterCharge) return;
    this.owned.delete('hotWaterCharge');
    try {
      await this.drop('hotWaterCharge');
    } catch (error) {
      this.device.error('Could not forget the ended one-time charge:', error);
    }
  }

  /**
   * Restores everything right away. Throws the first error after trying every restore; the
   * failed ones stay scheduled for a retry.
   */
  async endAll() {
    return this.exclusive(async () => {
      const errors = [];
      for (const kind of Object.keys(this.restores())) {
        try {
          await this.runRestore(kind);
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length > 0) throw errors[0];
    });
  }

  /** Schedules the restores kept in the store (on start). */
  resume() {
    this.stopped = false;
    const earliest = this.now() + STARTUP_DELAY_MS;
    for (const [kind, restore] of Object.entries(this.restores())) {
      this.schedule(kind, Math.max(Number(restore?.until) || 0, earliest));
    }
  }

  /** Stops the timers (the device is unloaded or deleted); the store keeps what is pending. */
  stop() {
    this.stopped = true;
    for (const kind of Object.keys(this.timers)) this.clearTimer(kind);
  }

  /**
   * The end time of a boost: `minutes` from now, or later when a running boost ends later.
   * @param {Restore | undefined} running
   * @param {number} minutes
   * @returns {number}
   */
  endTime(running, minutes) {
    return Math.max(this.now() + minutes * MINUTE, running?.until || 0);
  }

  /**
   * Stores the restore, applies the change and schedules the restore. When the change fails,
   * the store goes back to what it was.
   * @param {string} kind
   * @param {Restore} restore
   * @param {() => Promise<void>} apply
   */
  async start(kind, restore, apply) {
    const before = this.restores()[kind];
    await this.save({ ...this.restores(), [kind]: restore });
    try {
      await apply();
    } catch (error) {
      const restores = this.restores();
      if (before) restores[kind] = before;
      else delete restores[kind];
      await this.save(restores);
      throw error;
    }
    this.schedule(kind, restore.until);
  }

  /**
   * @param {string} kind
   * @param {number} at
   */
  schedule(kind, at) {
    this.clearTimer(kind);
    if (this.stopped) return;
    this.timers[kind] = this.device.homey.setTimeout(() => {
      delete this.timers[kind];
      this.exclusive(() => this.runRestore(kind)).catch(() => {});
    }, Math.max(0, at - this.now()));
  }

  /** @param {string} kind */
  clearTimer(kind) {
    if (this.timers[kind] === undefined) return;
    this.device.homey.clearTimeout(this.timers[kind]);
    delete this.timers[kind];
  }

  /**
   * Restores one kind; on failure, schedules a retry (or gives up after a day) and throws.
   * @param {string} kind
   */
  async runRestore(kind) {
    this.clearTimer(kind);
    try {
      await this.restore(kind);
    } catch (error) {
      this.device.error(`Could not restore after the temporary change (${kind}):`, error);
      const restore = this.restores()[kind];
      if (restore && this.now() - restore.until > GIVE_UP_MS) {
        this.device.error(`Giving up restoring ${kind}`);
        await this.drop(kind);
      } else if (restore) {
        this.schedule(kind, this.now() + RETRY_MS);
      }
      throw error;
    }
  }

  /**
   * Undoes one boost, if it is still in effect, and forgets it.
   * @param {string} kind
   */
  async restore(kind) {
    const restore = this.restores()[kind];
    if (!restore) return;
    await UNDO[kind]?.(this.device, restore, this.owned.has(kind));
    await this.drop(kind);
  }

  /** @param {string} kind */
  async drop(kind) {
    this.clearTimer(kind);
    this.owned.delete(kind);
    const restores = this.restores();
    if (!(kind in restores)) return;
    delete restores[kind];
    await this.save(restores);
  }

}

/**
 * The device's boost controller (created on first use).
 * @param {BoostDevice & { _boosts?: BoostController }} device
 * @returns {BoostController}
 */
function boostsOf(device) {
  if (!device._boosts) device._boosts = new BoostController(device);
  return device._boosts;
}

module.exports = {
  BoostController, boostsOf, STORE_KEY, RETRY_MS, GIVE_UP_MS, STARTUP_DELAY_MS,
};
