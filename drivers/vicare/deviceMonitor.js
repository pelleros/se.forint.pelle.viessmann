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

'use strict';

// Everything a device does with a poll beyond copying values (see device.js): the values it
// computes itself (computedValues.js), its status (deviceStatus.js: faults, logbook, frozen values,
// writes that did not take) shown as alarm_problem, a warning, Flow triggers and notifications,
// its health for the settings page, and the maintenance action "Refresh Viessmann features".
// Nothing here may stop a poll: every failure is logged.

const { ComputedValues } = require('./computedValues');
const { StatusTracker } = require('./deviceStatus');
const { featureMapper } = require('./featureMapper');
const { FEATURES } = require('./config');
const { translate } = require('../../lib/errorMessages');

const PROBLEM_CAPABILITY = 'alarm_problem';
const REFRESH_CAPABILITY = 'button.refreshFeatures';
// "Refresh Viessmann features" reads all features once: at most this often (API quota)
const REFRESH_INTERVAL = 10 * 60 * 1000;
// A message about a write that did not take stays this long, unless a poll shows the value took
const WRITE_MESSAGE_DURATION = 6 * 60 * 60 * 1000;

/**
 * A date and time in Homey's time zone, e.g. "26 Nov, 14:05".
 * @param {any} homey
 * @param {number} time
 * @returns {string}
 */
function formatDateTime(homey, time) {
  let timeZone = 'UTC';
  try {
    timeZone = homey?.clock?.getTimezone?.() || 'UTC';
  } catch (error) {
    // UTC
  }
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(time)) + (timeZone === 'UTC' ? ' UTC' : '');
  } catch (error) {
    return new Date(time).toISOString();
  }
}

class DeviceMonitor {

  /**
   * @param {any} device the ViessmannDevice
   */
  constructor(device) {
    this.device = device;
    this.computed = new ComputedValues({ dailyCounters: this.storeValue('dailyCounters') });
    this.status = new StatusTracker({ known: this.storeValue('knownMessages') });
    /** @type {Map<string, { wanted: any, actual: any, at: number }>} */
    this.writeProblems = new Map();
    this.problem = { faults: /** @type {string[]} */ ([]), frozenSince: /** @type {number | null} */ (null) };
    this.warning = undefined;
    /** @type {{ lastUpdateAt: number | null, lastError: { message: string, at: number } | null }} */
    this.health = { lastUpdateAt: null, lastError: null };
    this.lastRefreshAt = 0;
  }

  storeValue(key) {
    try {
      return this.device.getStoreValue?.(key);
    } catch (error) {
      return undefined;
    }
  }

  get homey() {
    return this.device.homey;
  }

  timeZone() {
    try {
      const timeZone = this.homey?.clock?.getTimezone?.();
      return typeof timeZone === 'string' && timeZone !== '' ? timeZone : undefined;
    } catch (error) {
      return undefined;
    }
  }

  // The maintenance action's listener (the button capability itself comes from the config)
  registerListeners() {
    if (!this.device.hasCapability(REFRESH_CAPABILITY) || this.refreshListener) return;
    this.refreshListener = true;
    this.device.registerCapabilityListener(REFRESH_CAPABILITY, async () => this.refreshFeatures());
  }

  /**
   * Handles a successful, circuit-normalized features response after the device applied its
   * values.
   * @param {import('./featureMapper').FeaturesResponse} response
   * @param {{ triggers?: boolean }} [options]
   */
  async onResponse(response, { triggers = true } = {}) {
    const now = Date.now();
    this.health.lastUpdateAt = now;
    // A response without any mapped feature says nothing (as for the other values)
    if (!response.data.some((feature) => FEATURES[feature.feature])) return;
    await this.safely('computed values', () => this.applyComputedValues(response, now, triggers));
    await this.safely('status', () => this.applyStatus(response, now, triggers));
  }

  // A failed poll, for the settings page
  onPollError(error) {
    const message = error instanceof Error ? error.message : String(error);
    this.health.lastError = { message: message.slice(0, 300), at: Date.now() };
  }

  /**
   * Remembers a successful write, so that a later poll can check that the value took.
   * @param {string} capabilityName
   * @param {{ command?: { useValueAsCommand?: boolean } }} capability its config
   * @param {any} value
   */
  rememberWrite(capabilityName, capability, value) {
    // An action such as the one-time charge ends by itself; only set points and modes are checked
    if (capability?.command?.useValueAsCommand) return;
    this.status.rememberWrite(capabilityName, value, Date.now());
    this.writeProblems.delete(capabilityName);
  }

  async safely(what, action) {
    try {
      await action();
    } catch (error) {
      this.device.error(`Could not update the ${what}:`, error);
    }
  }

  async applyComputedValues(response, now, triggers) {
    const { values, countersChanged } = this.computed.read(response, this.device.getRoles(), { now, timeZone: this.timeZone() });
    for (const [name, { value, units }] of values) {
      if (!this.device.hasCapability(name)) continue;
      if (units) await this.setUnits(name, units);
      await this.device.setCapabilityValueIfPossible(name, value, { trigger: triggers });
    }
    if (countersChanged) await this.device.setStoreValue('dailyCounters', this.computed.dailyCounters);
  }

  // The unit a response gives for a capability whose unit varies by device (gas in m³ or kWh)
  async setUnits(name, units) {
    const options = this.device.getCapabilityOptions(name) || {};
    if (options.units === units) return;
    await this.device.setCapabilityOptions(name, { ...options, units });
  }

  async applyStatus(response, now, triggers) {
    const result = this.status.read(response, now);
    if (result.knownChanged) await this.device.setStoreValue('knownMessages', this.status.known);

    this.problem = { faults: result.faults.map((fault) => fault.code), frozenSince: result.frozenSince };
    if (triggers) {
      for (const fault of result.newFaults) await this.reportFault(fault);
      for (const entry of result.logbook) {
        await this.trigger('logbook-entry-added', {
          event: entry.event, actor: entry.actor, status: entry.status ?? -1, circuit: entry.circuit,
        });
      }
    }

    // Writes: the value a poll reports, as the capability shows it
    const readings = featureMapper.readValues(response, this.device.getRoles());
    const { rejected, confirmed } = this.status.checkWrites((name) => {
      const reading = readings.get(name);
      return reading?.value === undefined || reading.value === null ? reading?.value : featureMapper.displayValue(name, reading.value);
    }, now);
    for (const name of confirmed) this.writeProblems.delete(name);
    for (const { capabilityName, wanted, actual } of rejected) {
      this.writeProblems.set(capabilityName, { wanted, actual, at: now });
      await this.notify(this.writeMessage(capabilityName, wanted, actual));
    }
    for (const [name, problem] of this.writeProblems) {
      const reading = readings.get(name);
      const reported = reading?.value === undefined ? undefined : featureMapper.displayValue(name, reading.value);
      if (reported === problem.wanted || now - problem.at > WRITE_MESSAGE_DURATION) this.writeProblems.delete(name);
    }

    await this.applyProblem();
  }

  // alarm_problem and the device's warning from the current problems
  async applyProblem() {
    const { faults, frozenSince } = this.problem;
    const messages = [];
    if (faults.length > 0) messages.push(translate(this.homey, 'status.fault', { codes: faults.join(', ') }));
    if (frozenSince !== null) messages.push(translate(this.homey, 'status.frozen', { time: formatDateTime(this.homey, frozenSince) }));
    for (const [name, { wanted, actual }] of this.writeProblems) messages.push(this.writeMessage(name, wanted, actual));

    if (this.device.hasCapability(PROBLEM_CAPABILITY)) {
      await this.device.setCapabilityValueIfPossible(PROBLEM_CAPABILITY, faults.length > 0 || frozenSince !== null);
    }
    const warning = messages.join(' ');
    if (warning === (this.warning ?? '')) return;
    this.warning = warning;
    if (warning) await this.device.setWarning?.(warning);
    else await this.device.unsetWarning?.();
  }

  async reportFault(fault) {
    await this.trigger('fault-reported', { code: fault.code, priority: fault.priority || '' });
    await this.notify(translate(this.homey, 'status.fault_notification', { device: this.deviceName(), code: fault.code }));
  }

  writeMessage(capabilityName, wanted, actual) {
    return translate(this.homey, 'status.write_not_applied', {
      capability: this.capabilityTitle(capabilityName),
      wanted: this.describe(capabilityName, wanted),
      actual: this.describe(capabilityName, actual),
    });
  }

  // A value with its unit, or a mode with its title
  describe(capabilityName, value) {
    let options = {};
    try {
      options = this.device.getCapabilityOptions(capabilityName) || {};
    } catch (error) {
      // no options
    }
    const language = this.language();
    const mode = Array.isArray(options.values) ? options.values.find((item) => item.id === value) : undefined;
    if (mode) return mode.title?.[language] || mode.title?.en || String(value);
    const units = typeof options.units === 'string' ? options.units : options.units?.[language] || options.units?.en;
    return units ? `${value} ${units}` : String(value);
  }

  capabilityTitle(capabilityName) {
    const title = featureMapper.capabilityByName(capabilityName)?.capabilityOptions?.title || {};
    return title[this.language()] || title.en || capabilityName;
  }

  language() {
    try {
      return this.homey?.i18n?.getLanguage?.() || 'en';
    } catch (error) {
      return 'en';
    }
  }

  deviceName() {
    try {
      return this.device.getName?.() || 'Viessmann';
    } catch (error) {
      return 'Viessmann';
    }
  }

  async trigger(id, tokens) {
    await this.safely(`trigger ${id}`, () => this.device.driver?.triggerEvent?.(id, this.device, tokens, tokens));
  }

  async notify(excerpt) {
    await this.safely('notification', () => this.homey?.notifications?.createNotification?.({ excerpt }));
  }

  /**
   * The maintenance action: reads all features once, adds what is new (nothing is removed) and
   * shows the values. At most once per REFRESH_INTERVAL, because it uses the API quota.
   */
  async refreshFeatures() {
    const now = Date.now();
    if (now - this.lastRefreshAt < REFRESH_INTERVAL) {
      throw new Error(translate(this.homey, 'status.refresh_too_soon', {
        minutes: Math.ceil((REFRESH_INTERVAL - (now - this.lastRefreshAt)) / 60000),
      }));
    }
    this.lastRefreshAt = now;
    await this.device.refreshFeatures();
    return true;
  }

}

module.exports = { DeviceMonitor, formatDateTime, REFRESH_INTERVAL };
