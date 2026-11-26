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

/* eslint-disable max-classes-per-file */

// @ts-check

'use strict';

// An extra device (heating circuit, hot water, room; see extraProfiles.js) on Homey. It has no
// poller of its own: it shares the poll of its Viessmann device with the ViCare device
// (driver.js → follow), and gets its values from the same response. Writes go through the same
// path as the ViCare device's (capabilityWrites.js, commands.js), so the account's write
// allowance, the command checks and the check that a write took apply alike. A value that
// equals the current one is not sent (a Matter bridge or voice assistant repeating it).
//
// Each driver's device class sets KIND. The device stores what pairing read of its part of the
// Viessmann device (extraPairing.js); the feature list only ever grows, and capabilities are only
// ever added.

const { OAuth2Device } = require('homey-oauth2app');
const { featureMapper } = require('./featureMapper');
const capabilityWrites = require('./capabilityWrites');
const { recordFeatures } = require('./featureCards');
const { DeviceMonitor } = require('./deviceMonitor');
const { effectiveRoles, inferRoles } = require('./roles');
const { pollingKey, ROOM_POLL_INTERVAL } = require('./pollPlan');
const { sameValue } = require('./writeChecks');
const { userErrorFrom } = require('./userErrors');
const profiles = require('./extraProfiles');

// The driver that polls every Viessmann device
const POLL_DRIVER = 'vicare';
// When the poll driver is not ready yet at start, try again after this long
const JOIN_RETRY = 30 * 1000;

/**
 * What an extra device does with a poll beyond its values: only checking that its writes took.
 * Faults, values that stopped updating and computed values are shown by the ViCare device.
 */
class ExtraDeviceMonitor extends DeviceMonitor {

  /** @param {any} response the device's part of the response */
  async onResponse(response) {
    const now = Date.now();
    this.health.lastUpdateAt = now;
    await this.safely('write checks', async () => {
      await this.checkWrites(response, now);
      await this.applyProblem();
    });
  }

  /**
   * Options for the message about a write that did not take: the device's own capability, else
   * the configured one it is written through (units, mode titles).
   * @param {string} capabilityName
   * @param {unknown} wanted
   * @param {unknown} actual
   */
  writeProblem(capabilityName, wanted, actual) {
    let options = {};
    try {
      options = this.device.hasCapability(capabilityName)
        ? this.device.getCapabilityOptions(capabilityName) || {}
        : featureMapper.configuredOptions(capabilityName);
    } catch (error) {
      // no options
    }
    return {
      capabilityName, options, wanted, actual,
    };
  }

}

class ExtraDevice extends OAuth2Device {

  // 'circuit', 'hotWater' or 'room' (extraProfiles.js)
  static KIND = undefined;

  /** @type {string[]} capabilities with a listener */
  _listeners = [];

  /** @type {Map<string, { value: any, gone: boolean }>} the configured capabilities' last readings */
  _readings = new Map();

  /** @returns {import('./extraProfiles').ExtraKind} */
  get kind() {
    return /** @type {any} */ (this.constructor).KIND;
  }

  async onOAuth2Init() {
    this._uninitialized = false;
    this._installationId = this.getStoreValue('installationId');
    this._gatewaySerial = this.getStoreValue('gatewaySerial');
    this._deviceId = this.getStoreValue('deviceId');
    this._heatingCircuitId = this.getStoreValue('heatingCircuitId');
    this._roomId = this.getStoreValue('roomId');
    this._roles = this.getStoreValue('roles') || [];
    this._features = this.getStoreValue('features') || [];
    this._constraints = this.getStoreValue('constraints') || {};
    this._commands = this.getStoreValue('commandMetadata') || {};
    this._operatingModes = this.getStoreValue('operatingModes') || [];
    // The configured capabilities' last readings (featureMapper.readValues), by name
    this._readings = new Map();
    this._listeners = [];

    await this.setUpCapabilities();
    this.registerListeners();
    if (this._uninitialized) return;
    await this.joinPoll();
  }

  async onOAuth2Uninit() {
    await this.stopUpdates();
  }

  async onOAuth2Deleted() {
    await this.stopUpdates();
  }

  /* The device's part of the Viessmann device */

  // What extraProfiles.js needs to know about the device
  extraContext() {
    return {
      heatingCircuitId: this._heatingCircuitId,
      roomId: this._roomId,
      features: this._features,
      constraints: this._constraints,
      commandMetadata: this._commands,
      operatingModes: this._operatingModes,
      language: this.homeyLanguage(),
    };
  }

  homeyLanguage() {
    try {
      return this.homey?.i18n?.getLanguage?.() || 'en';
    } catch (error) {
      return 'en';
    }
  }

  // Roles to check a feature's `requireRole` against (as the ViCare device does)
  getRoles() {
    return effectiveRoles(this._roles, inferRoles(this._features));
  }

  // Adds the capabilities the stored features give (never removes one) and sets their options
  async setUpCapabilities() {
    const context = this.extraContext();
    const options = profiles.optionsFor(this.kind, context);
    for (const name of profiles.capabilitiesFor(this.kind, context)) {
      try {
        if (!this.hasCapability(name)) await this.addCapability(name);
        const current = this.getCapabilityOptions(name) || {};
        if (JSON.stringify(current) !== JSON.stringify(options[name])) await this.setCapabilityOptions(name, options[name]);
      } catch (error) {
        this.error(`Could not set up ${name}:`, error);
      }
    }
  }

  // A listener per writable capability; a value that equals the current one sends nothing
  registerListeners() {
    for (const name of this.getCapabilities()) {
      if (this._listeners.includes(name) || !profiles.writableCapability(this.kind, this.extraContext(), name)) continue;
      this.registerCapabilityListener(name, async (value) => {
        if (sameValue(value, this.getCapabilityValue(name))) return;
        await this.writeCapability(name, value);
      });
      this._listeners.push(name);
    }
  }

  /* The shared poll (driver.js) */

  /** @returns {any} the ViCare driver (driver.js) */
  pollHost() {
    return this.homey.drivers.getDriver(POLL_DRIVER);
  }

  // Key of the Viessmann device's poller
  getPollingKey() {
    return pollingKey({ installationId: this._installationId, gatewaySerial: this._gatewaySerial, deviceId: this._deviceId });
  }

  // Shares the poll of the Viessmann device; tries again later when the poll driver is not ready
  async joinPoll() {
    try {
      await this.pollHost().follow(this.getPollingKey(), this);
    } catch (error) {
      this.error('Could not join the poll, trying again:', error);
      if (!this._uninitialized) {
        this._joinTimer = this.homey.setTimeout(() => {
          this._joinTimer = null;
          if (!this._uninitialized) this.joinPoll().catch((retryError) => this.error('Could not join the poll:', retryError));
        }, JOIN_RETRY);
      }
    }
  }

  async stopUpdates() {
    this._uninitialized = true;
    if (this._joinTimer) this.homey.clearTimeout(this._joinTimer);
    this._joinTimer = null;
    try {
      await this.pollHost().unfollow(this.getPollingKey(), this);
    } catch (error) {
      this.error('Could not leave the poll:', error);
    }
  }

  // The feature paths a poll needs for this device (driver.js adds them to the request)
  pollPaths() {
    return profiles.pollPaths(this.kind, this.extraContext());
  }

  // Rooms are read slowly; heating circuits and hot water follow the automatic interval
  pollInterval() {
    return this.kind === 'room' ? ROOM_POLL_INTERVAL : undefined;
  }

  // The request when this device polls for its Viessmann device (no ViCare device for it)
  async getFeatures({ useFilter = false, extraPaths = [] } = {}) {
    const paths = extraPaths.length > 0 ? extraPaths : this.pollPaths();
    return this.oAuth2Client.getFeatures({
      installationId: this._installationId,
      gatewaySerial: this._gatewaySerial,
      deviceId: this._deviceId,
      filter: useFilter ? [...new Set(paths)].join(',') : undefined,
    });
  }

  recordPollError(error) {
    this.getMonitor().onPollError(error);
  }

  getMonitor() {
    if (!this._monitor) this._monitor = new ExtraDeviceMonitor(this);
    return this._monitor;
  }

  /*
    A poll response of the Viessmann device: shows the values of this device's part, adds values
    whose sensor is reported for the first time, and checks the writes. A response without any
    of the device's features changes nothing (returns false). Never throws.
  */
  async onSharedFeatures(rawResponse) {
    if (this._uninitialized) return false;
    try {
      const response = profiles.responseFor(this.kind, this.extraContext(), rawResponse);
      if (!response) return false;
      this._commands = featureMapper.updatedCommands(response, this._commands);
      recordFeatures(this, response);
      await this.addNewPaths(response);

      const readings = this.kind === 'room' ? new Map() : this.readCapabilityValues(response);
      for (const [name, reading] of readings) {
        if (reading.value !== undefined) this._readings.set(name, reading);
        else if (reading.gone) this._readings.delete(name);
      }
      for (const [name, { value, gone }] of profiles.valuesFor(this.kind, this.extraContext(), response, readings)) {
        if (!this.hasCapability(name)) continue;
        if (value !== undefined) await this.showValue(name, value);
        else if (gone && this.getCapabilityValue(name) !== null) await this.showValue(name, null);
      }
      await this.rememberHotWaterMode();
      await this.getMonitor().onResponse(response);
      if (!this.getAvailable()) await this.setAvailable();
      await /** @type {any} */ (this).setLastSeenAt();
      return true;
    } catch (error) {
      this.error('Could not apply a poll:', error);
      try {
        await this.setUnavailable(error instanceof Error ? error.message : String(error));
      } catch (unavailableError) {
        this.error('Could not mark the device as unavailable:', unavailableError);
      }
      return true;
    }
  }

  // A value whose sensor is reported for the first time (e.g. a room sensor connected later)
  async addNewPaths(response) {
    const found = profiles.newPaths(this.kind, this.extraContext(), response);
    if (found.length === 0) return;
    this._features = [...this._features, ...found];
    await this.setStoreValue('features', this._features);
    await this.setUpCapabilities();
    this.registerListeners();
  }

  // Heat switches hot water back to the mode it had before it was switched off
  async rememberHotWaterMode() {
    if (this.kind !== 'hotWater') return;
    const mode = this._readings.get('thermostat_mode.hotWater')?.value;
    if (typeof mode === 'string' && mode !== profiles.HOT_WATER_OFF && mode !== this.getStoreValue('lastHotWaterMode')) {
      await this.setStoreValue('lastHotWaterMode', mode);
    }
  }

  // Shows a value on one of the device's own capabilities; a failure is logged
  async showValue(name, value) {
    try {
      if (!this.hasCapability(name) || this.getCapabilityValue(name) === value) return;
      await this.setCapabilityValue(name, value);
    } catch (error) {
      this.error(`Failed to set capability ${name}:`, error);
    }
  }

  /* Writes: the same path as the ViCare device's (capabilityWrites.js) */

  // Writes a value of the device through the configured capability it shows
  async writeCapability(name, value) {
    const context = this.extraContext();
    const capability = profiles.writableCapability(this.kind, context, name);
    if (!capability) throw new Error(`${name} cannot be changed`);
    let sourceValue = value;
    if (capability.toSource) {
      try {
        sourceValue = capability.toSource(value, {
          current: this._readings.get(capability.source || '')?.value,
          lastOnMode: this.getStoreValue('lastHotWaterMode'),
          context,
        });
      } catch (error) {
        throw userErrorFrom(this, error);
      }
      // The Viessmann device already has a fitting value
      if (sourceValue === null) {
        await this.showValue(name, value);
        return true;
      }
    }
    return capabilityWrites.writeCapability(this, /** @type {string} */ (capability.source), sourceValue);
  }

  /*
    The parts of a device capabilityWrites.js and commands.js use. They speak of the configured
    capabilities (config/); the device shows them on its own (extraProfiles.js → shownFrom).
  */

  deviceContext() {
    return {
      features: this._features,
      operatingModes: this._operatingModes,
      commandMetadata: this._commands,
      language: this.homeyLanguage(),
      currentValue: (capabilityName) => this._readings.get(capabilityName)?.value,
    };
  }

  readCapabilityValues(response) {
    return featureMapper.readValues(response, this.getRoles(), { language: this.homeyLanguage(), features: this._features });
  }

  // A written value of a configured capability: remembered, and shown where the device shows it
  async setCapabilityValueIfPossible(capabilityName, value) {
    this._readings.set(capabilityName, { value, gone: false });
    for (const shown of profiles.shownFrom(this.kind, this.extraContext(), capabilityName, value)) {
      await this.showValue(shown.name, shown.value);
    }
  }

  executeCommand(path, capability, value, options = {}) {
    return capabilityWrites.executeCommand(this, path, capability, value, options);
  }

  showWrittenValues(values) {
    return capabilityWrites.showWrittenValues(this, values);
  }

  checkOperatingMode(path, value) {
    capabilityWrites.checkOperatingMode(this, path, value);
  }

}

module.exports = { ExtraDevice, ExtraDeviceMonitor, POLL_DRIVER };
