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

// Wires what a device does with a poll beyond copying values to the device: the values it computes
// (computedValues.js), faults and logbook entries (faultLog.js), values that stopped updating
// (frozenValues.js) and writes that did not take (writeChecks.js), shown as alarm_problem, a
// warning (statusMessages.js), Flow triggers and notifications; the event log (eventLog.js), the
// health for the settings page and the maintenance action "Refresh Viessmann features". The logic
// is in those modules; nothing here may stop a poll: every failure is logged.

const { ComputedValues } = require('./computedValues');
const { FaultLog } = require('./faultLog');
const { FrozenValues } = require('./frozenValues');
const { WriteChecks } = require('./writeChecks');
const {
  newEvents, eventPositionFrom, startPosition, eventLogMinutes,
} = require('./eventLog');
const { warningText, writeMessage } = require('./statusMessages');
const { featureMapper } = require('./featureMapper');
const { FEATURES } = require('./config');
const { translate, timeZoneOf } = require('../../lib/errorMessages');
const { maskText } = require('../../lib/logPrivacy');

/** @typedef {import('./featureMapper').FeaturesResponse} FeaturesResponse */

const MINUTE = 60 * 1000;
const PROBLEM_CAPABILITY = 'alarm_problem';
const REFRESH_CAPABILITY = 'button.refreshFeatures';
// "Refresh Viessmann features" reads all features once: at most this often (API quota)
const REFRESH_INTERVAL = 10 * MINUTE;
// A message about a write that did not take stays this long, unless a poll shows the value took
const WRITE_MESSAGE_DURATION = 6 * 60 * MINUTE;
// Events older than this many event log intervals are not triggered (e.g. from while the app was off)
const EVENT_TRIGGER_WINDOW = 2;
// At most this many event triggers per read
const MAX_EVENT_TRIGGERS = 20;

class DeviceMonitor {

  /**
   * @param {any} device the ViessmannDevice
   */
  constructor(device) {
    this.device = device;
    const known = this.storeValue('knownMessages');
    this.computed = new ComputedValues({ dailyCounters: this.storeValue('dailyCounters') });
    this.faultLog = new FaultLog(known);
    this.eventPosition = eventPositionFrom(known?.events);
    this.frozen = new FrozenValues();
    this.writes = new WriteChecks();
    /** @type {Map<string, { wanted: unknown, actual: unknown, at: number }>} */
    this.writeProblems = new Map();
    this.problem = { faults: /** @type {string[]} */ ([]), frozenSince: /** @type {number | null} */ (null) };
    /** @type {string | undefined} */
    this.warning = undefined;
    /** @type {{ lastUpdateAt: number | null, lastError: { message: string, at: number } | null }} */
    this.health = { lastUpdateAt: null, lastError: null };
    this.lastRefreshAt = 0;
    this.refreshListener = false;
    /** @type {any} */
    this.eventTimer = null;
  }

  /** @param {string} key */
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

  // What the store key knownMessages holds: reported faults, logbook and event log positions
  knownMessages() {
    return { ...this.faultLog.state, events: this.eventPosition };
  }

  async saveKnownMessages() {
    await this.device.setStoreValue('knownMessages', this.knownMessages());
  }

  /**
   * Runs a step; a failure is logged and never stops a poll.
   * @param {string} what
   * @param {() => Promise<unknown> | unknown} action
   */
  async safely(what, action) {
    try {
      await action();
    } catch (error) {
      this.device.error(`Could not update the ${what}:`, error);
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
   * values. A response without any mapped feature says nothing (as for the other values).
   * @param {FeaturesResponse} response
   * @param {{ triggers?: boolean }} [options]
   */
  async onResponse(response, { triggers = true } = {}) {
    const now = Date.now();
    this.health.lastUpdateAt = now;
    if (!response.data.some((feature) => FEATURES[feature.feature])) return;
    await this.safely('computed values', () => this.applyComputedValues(response, now, triggers));
    await this.safely('status', () => this.applyStatus(response, now, triggers));
  }

  /**
   * A failed poll, for the settings page. Network errors can carry request URLs with ids: they are
   * masked like in the log.
   * @param {unknown} error
   */
  onPollError(error) {
    const message = error instanceof Error ? error.message : String(error);
    this.health.lastError = { message: maskText(message).slice(0, 300), at: Date.now() };
  }

  /**
   * Remembers a successful write (commands.js), so that a later poll can check that the value
   * took.
   * @param {string} capabilityName
   * @param {unknown} value
   */
  rememberWrite(capabilityName, value) {
    this.writes.remember(capabilityName, value, Date.now());
    this.writeProblems.delete(capabilityName);
  }

  /**
   * @param {FeaturesResponse} response
   * @param {number} now
   * @param {boolean} triggers
   */
  async applyComputedValues(response, now, triggers) {
    const { values, countersChanged } = this.computed.read(response, this.device.getRoles(), { now, timeZone: timeZoneOf(this.homey) });
    for (const [name, { value, units }] of values) {
      if (!this.device.hasCapability(name)) continue;
      if (units) await this.setUnits(name, units);
      await this.device.setCapabilityValueIfPossible(name, value, { trigger: triggers });
    }
    if (countersChanged) await this.device.setStoreValue('dailyCounters', this.computed.dailyCounters);
  }

  /**
   * The unit a response gives for a capability whose unit varies by device (gas in m³ or kWh).
   * @param {string} name
   * @param {string} units
   */
  async setUnits(name, units) {
    const options = this.device.getCapabilityOptions(name) || {};
    if (options.units !== units) await this.device.setCapabilityOptions(name, { ...options, units });
  }

  /**
   * @param {FeaturesResponse} response
   * @param {number} now
   * @param {boolean} triggers
   */
  async applyStatus(response, now, triggers) {
    const log = this.faultLog.read(response);
    if (log.changed) await this.saveKnownMessages();
    this.problem = { faults: log.faults.map((fault) => fault.code), frozenSince: this.frozen.update(response, now) };
    if (triggers) {
      for (const fault of log.newFaults) {
        await this.trigger('fault-reported', { code: fault.code, priority: fault.priority || '' });
        await this.notify(translate(this.homey, 'status.fault_notification', { device: this.deviceName(), code: fault.code }));
      }
      for (const entry of log.logbook) {
        await this.trigger('logbook-entry-added', {
          event: entry.event, actor: entry.actor, status: entry.status ?? -1, circuit: entry.circuit,
        });
      }
    }
    await this.checkWrites(response, now);
    await this.applyProblem();
  }

  /**
   * Checks remembered writes against the values of a poll, as the capabilities show them.
   * @param {FeaturesResponse} response
   * @param {number} now
   */
  async checkWrites(response, now) {
    const readings = featureMapper.readValues(response, this.device.getRoles());
    const reported = (/** @type {string} */ name) => {
      const value = readings.get(name)?.value;
      return value === undefined || value === null ? value : featureMapper.displayValue(name, value);
    };
    const { rejected, confirmed } = this.writes.check(reported, now);
    for (const name of confirmed) this.writeProblems.delete(name);
    for (const { capabilityName, wanted, actual } of rejected) {
      this.writeProblems.set(capabilityName, { wanted, actual, at: now });
      await this.notify(writeMessage(this.homey, this.writeProblem(capabilityName, wanted, actual)));
    }
    for (const [name, problem] of this.writeProblems) {
      if (reported(name) === problem.wanted || now - problem.at > WRITE_MESSAGE_DURATION) this.writeProblems.delete(name);
    }
  }

  /**
   * @param {string} capabilityName
   * @param {unknown} wanted
   * @param {unknown} actual
   * @returns {import('./statusMessages').WriteProblem}
   */
  writeProblem(capabilityName, wanted, actual) {
    let options = {};
    try {
      options = this.device.getCapabilityOptions(capabilityName) || {};
    } catch (error) {
      // no options
    }
    return {
      capabilityName, options, wanted, actual,
    };
  }

  // alarm_problem (faults, frozen values) and the device's warning (also writes that did not take)
  async applyProblem() {
    const { faults, frozenSince } = this.problem;
    if (this.device.hasCapability(PROBLEM_CAPABILITY)) {
      await this.device.setCapabilityValueIfPossible(PROBLEM_CAPABILITY, faults.length > 0 || frozenSince !== null);
    }
    const writes = [...this.writeProblems].map(([name, { wanted, actual }]) => this.writeProblem(name, wanted, actual));
    const warning = warningText(this.homey, { faults, frozenSince, writes });
    if (warning === (this.warning ?? '')) return;
    this.warning = warning;
    if (warning) await this.device.setWarning?.(warning);
    else await this.device.unsetWarning?.();
  }

  deviceName() {
    try {
      return this.device.getName?.() || 'Viessmann';
    } catch (error) {
      return 'Viessmann';
    }
  }

  /**
   * @param {string} id
   * @param {Record<string, unknown>} tokens
   * @param {Record<string, unknown>} [state]
   */
  async trigger(id, tokens, state = tokens) {
    await this.safely(`trigger ${id}`, () => this.device.driver?.triggerEvent?.(id, this.device, tokens, state));
  }

  /** @param {string} excerpt */
  async notify(excerpt) {
    await this.safely('notification', () => this.homey?.notifications?.createNotification?.({ excerpt }));
  }

  // (Re)starts reading the event log at its interval (device setting eventLog), or stops it
  scheduleEventLog() {
    this.stopEventLog();
    const minutes = eventLogMinutes(this.device.getPollSetting?.('eventLog'));
    if (!minutes || this.device._uninitialized || !this.homey?.setTimeout) return;
    if (!this.eventPosition) {
      this.eventPosition = startPosition(this.eventPosition, Date.now());
      this.safely('event log position', () => this.saveKnownMessages()).catch(() => {});
    }
    this.eventTimer = this.homey.setTimeout(() => {
      this.eventTimer = null;
      this.readEventLog().then(() => this.scheduleEventLog(), () => this.scheduleEventLog());
    }, minutes * MINUTE);
  }

  stopEventLog() {
    if (this.eventTimer) this.homey?.clearTimeout?.(this.eventTimer);
    this.eventTimer = null;
  }

  // Reads the new entries of the installation's event log and fires their triggers
  async readEventLog() {
    await this.safely('event log', async () => {
      const minutes = eventLogMinutes(this.device.getPollSetting?.('eventLog'));
      if (!minutes) return;
      const now = Date.now();
      const position = startPosition(this.eventPosition, now - minutes * MINUTE);
      const response = await this.device.oAuth2Client.getEventsHistory({
        installationId: this.device._installationId,
        gatewaySerial: this.device._gatewaySerial,
        start: new Date(position.at).toISOString(),
      });
      const read = newEvents(response, this.device._deviceId, position, now - EVENT_TRIGGER_WINDOW * minutes * MINUTE);
      this.eventPosition = read.position;
      if (read.changed) await this.saveKnownMessages();
      for (const { code, ...event } of read.events.slice(-MAX_EVENT_TRIGGERS)) {
        const tokens = {
          description: event.description, type: event.type, active: event.active,
        };
        await this.trigger('event-logged', { code, ...tokens });
        await this.trigger('event-code-logged', tokens, { code });
      }
    });
  }

  /**
   * The maintenance action: reads all features once (one API call), merges them into the stored
   * metadata (the feature list only grows, nothing is removed), adds the capabilities of new
   * features and shows the values from the same read. Polling pauses meanwhile and keeps its
   * backoff. At most once per REFRESH_INTERVAL, because it uses the API quota.
   */
  async refreshFeatures() {
    const now = Date.now();
    if (now - this.lastRefreshAt < REFRESH_INTERVAL) {
      const minutes = Math.ceil((REFRESH_INTERVAL - (now - this.lastRefreshAt)) / MINUTE);
      throw new Error(translate(this.homey, 'status.refresh_too_soon', { minutes }));
    }
    this.lastRefreshAt = now;
    const { device } = this;
    const response = await device.getFeatures();
    const metadata = device.mergeRefreshedMetadata(device.driver._readDeviceMetadata(response, device.getSetting?.('heatingCircuit') || 'auto'));
    await device.driver._pausePolling(device.getPollingKey());
    try {
      await device.applyCircuitMetadata(metadata);
      await device.onFeaturesUpdated(response, false);
    } finally {
      device.resumePolling();
    }
    device.log('Features refreshed:', metadata.features.length);
    return true;
  }

}

module.exports = { DeviceMonitor, REFRESH_INTERVAL };
