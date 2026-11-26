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

// One Viessmann device on Homey. This class holds the device's state (ids, stored metadata,
// roles, settings being saved) and wires the Homey SDK's lifecycle to the modules that do the
// work; the driver (driver.js) polls it and hands every response to onFeaturesUpdated:
//
//   capabilitySetup.js   which capabilities the device has, their options, modes and listeners
//   featureUpdates.js    a features response: values, triggers, availability
//   deviceMetadata.js    the stored features, limits, modes and command metadata, and how they grow
//   capabilityWrites.js  writing a capability value (commands.js sends every command)
//   deviceSettings.js    what changing a device setting does (interval, optional groups, circuit)
//   deviceMonitor.js     the rest of a poll: computed values, status, event log, health
//   migrations.js        store migrations, run on every start
//
// Other modules reach the device through the methods below, so a method stays here, as a
// one-line delegation that returns the module's promise, when another module or a test calls it.

const { OAuth2Device } = require('homey-oauth2app');
const { inferRoles, effectiveRoles } = require('./roles');
const { FEATURES, PATHS, getCapability } = require('./config');
const { featureMapper } = require('./featureMapper');
const { maskId } = require('../../lib/logPrivacy');
const capabilitySetup = require('./capabilitySetup');
const capabilityWrites = require('./capabilityWrites');
const deviceMetadata = require('./deviceMetadata');
const deviceSettings = require('./deviceSettings');
const { applyFeaturesResponse, showValue } = require('./featureUpdates');
const { runMigrations, versionBefore } = require('./migrations');
const { DeviceMonitor } = require('./deviceMonitor');
const { enabledGroups } = require('./optionalGroups');
const { pollFilter, pollingKey } = require('./pollPlan');
const { boostsOf } = require('./boost');

module.exports = class ViessmannDevice extends OAuth2Device {

  static FEATURES = FEATURES;
  static PATHS = PATHS;

  async onOAuth2Init() {
    // The polling key is known before the first await, so that onOAuth2Deleted and
    // onOAuth2Uninit can stop polling at any moment (pairings before 1.0.4 keep it in data)
    this._uninitialized = false;
    const data = this.getStoreValue('installationId') ? {} : this.getData();
    this._installationId = this.getStoreValue('installationId') ?? data.installationId;
    this._gatewaySerial = this.getStoreValue('gatewaySerial') ?? data.gatewaySerial;
    this._deviceId = this.getStoreValue('deviceId') ?? data.deviceId;

    await this.checkUpgradeSpecifics();
    if (this._uninitialized) return;
    this._installationId = this.getStoreValue('installationId');
    this._gatewaySerial = this.getStoreValue('gatewaySerial');
    this._deviceId = this.getStoreValue('deviceId');
    this._roles = this.getStoreValue('roles');
    this._features = this.getStoreValue('features');
    this._constraints = this.getStoreValue('constraints');
    this._operatingModes = this.getStoreValue('operatingModes');
    this._heatingCircuitId = this.getStoreValue('heatingCircuitId');
    this._commands = this.getStoreValue('commandMetadata');

    if (process.env.DEBUG) {
      // Ids masked, and counts instead of the stored lists (see lib/logPrivacy.js)
      this.log(
        'ViessmannDevice::onOAuth2Init installationId:', maskId(this._installationId),
        'gatewaySerial:', maskId(this._gatewaySerial),
        'deviceId:', this._deviceId,
        'roles:', this._roles,
        'features:', Array.isArray(this._features) ? this._features.length : this._features,
        'operatingModes:', Array.isArray(this._operatingModes) ? this._operatingModes.map((mode) => mode.id) : this._operatingModes,
        'version:', this.getStoreValue('version'),
      );
    }

    this._listeners = [];

    await this.initializeCapabilities();
    await this.updateCapabilityOptions();
    await this.initializeOperatingModes();
    await this.registerCapabilityListeners();
    this.getMonitor().registerListeners();

    this.onFeaturesUpdated = this.onFeaturesUpdated.bind(this);

    // Deleted or unloaded while initialising: never start a poller that nothing would stop
    if (this._uninitialized) return;
    // Temporary changes from Flows that still have to be undone (boost.js)
    boostsOf(this).resume();
    await this.driver._startPolling(this, this.getPollingKey());
    this.getMonitor().scheduleEventLog();
  }

  async onInit() {
    await super.onInit();
    if (process.env.DEBUG) {
      this.log('[ViessmannDevice::onInit] called');
    }
  }

  async onOAuth2Uninit() {
    await this.stopUpdates();
  }

  async onOAuth2Deleted() {
    // Stop polling right away: a poll that runs after deletion fails with device_not_found
    await this.stopUpdates();
  }

  // Stops polling, the event log and the timers of temporary changes (the store keeps those)
  async stopUpdates() {
    this._uninitialized = true;
    this._monitor?.stopEventLog();
    this._boosts?.stop();
    await this.driver._stopPolling(this.getPollingKey());
  }

  // Store migrations, see migrations.js
  async checkUpgradeSpecifics() {
    const ran = await runMigrations(this);
    if (ran.length > 0) this.log('Store migrations run:', ran.join(', '));
  }

  storeVersionBefore(targetVersion) {
    return versionBefore(this.getStoreValue('version'), targetVersion);
  }

  /* The device's state, as the modules read it */

  /*
    Roles to check `requireRole` against: the stored roles or, when they contain no role tag
    that FEATURES uses (newer models), roles inferred from the stored features and from
    responses (see roles.js).
  */
  getRoles() {
    return effectiveRoles(this._roles, [...inferRoles(this._features), ...(this._responseRoles || [])]);
  }

  // The optional groups of values that are turned on (optionalGroups.js)
  getEnabledGroups() {
    return this._enabledGroups || enabledGroups((key) => this.getSetting?.(key));
  }

  /*
    What derived capabilities and the options need to know about the device: its stored
    features, operating modes and command metadata, Homey's language and its current values.
  */
  deviceContext() {
    return {
      features: Array.isArray(this._features) ? this._features : [],
      operatingModes: Array.isArray(this._operatingModes) ? this._operatingModes : [],
      commandMetadata: this._commands,
      language: this.homeyLanguage(),
      currentValue: (capabilityName) => (this.hasCapability(capabilityName) ? this.getCapabilityValue(capabilityName) : undefined),
    };
  }

  homeyLanguage() {
    try {
      return this.homey?.i18n?.getLanguage?.() || 'en';
    } catch (error) {
      return 'en';
    }
  }

  // The update interval and event log settings (pollSettings during a change, before Homey saves it)
  getPollSetting(key) {
    return this._pollSettings?.[key] ?? this.getSetting?.(key);
  }

  // Key of this device's poller in the driver
  getPollingKey() {
    return pollingKey({ installationId: this._installationId, gatewaySerial: this._gatewaySerial, deviceId: this._deviceId });
  }

  // What the device does with a poll beyond copying values: see deviceMonitor.js
  getMonitor() {
    if (!this._monitor) this._monitor = new DeviceMonitor(this);
    return this._monitor;
  }

  /* Capabilities (capabilitySetup.js) */

  initializeCapabilities() {
    return capabilitySetup.initializeCapabilities(this);
  }

  // Options from the config and the API's limits, for the feature path the device has
  updateCapabilityOptions() {
    return capabilitySetup.updateCapabilityOptions(this);
  }

  initializeOperatingModes() {
    return capabilitySetup.initializeOperatingModes(this);
  }

  registerCapabilityListeners() {
    return capabilitySetup.registerCapabilityListeners(this);
  }

  /* Stored metadata (deviceMetadata.js) */

  // Re-reads the features from the API and stores the merged metadata (the 1.0.15 migration)
  refreshStoredMetadata() {
    return deviceMetadata.refreshStoredMetadata(this);
  }

  // Freshly read metadata merged with the stored metadata: the feature list only grows
  mergeRefreshedMetadata(metadata) {
    return deviceMetadata.mergeWithStored(this, metadata);
  }

  // Stores metadata and sets the device up for it again (circuit change, maintenance action)
  applyCircuitMetadata(metadata) {
    return deviceMetadata.applyMetadata(this, metadata);
  }

  /* Features responses (featureUpdates.js) */

  onFeaturesUpdated(rawResponse, extendedResponse, options = {}) {
    return applyFeaturesResponse(this, rawResponse, extendedResponse, options);
  }

  /*
    Reads every capability's value from a (circuit-normalized) features response, for the
    capabilities this device's roles allow (see FeatureMapper.readValues). Returns
    capabilityName => { value, gone }.
  */
  readCapabilityValues(response) {
    return featureMapper.readValues(response, this.getRoles(), { language: this.homeyLanguage(), features: this._features });
  }

  // `trigger: false` updates the value without firing its trigger cards
  setCapabilityValueIfPossible(capabilityName, value, options = {}) {
    return showValue(this, capabilityName, value, options);
  }

  // A failed poll, for the health on the settings page
  recordPollError(error) {
    this.getMonitor().onPollError(error);
  }

  /* Writes (capabilityWrites.js) */

  // Writes a capability value, from a capability listener or a Flow action
  writeCapability(capabilityName, value) {
    return capabilityWrites.writeCapability(this, capabilityName, value);
  }

  // Writes a configured capability on `path` and shows the value. `restoring`: undoing a
  // temporary change (boost.js), which the account's write allowance never refuses
  executeCommand(path, capability, value, options = {}) {
    return capabilityWrites.executeCommand(this, path, capability, value, options);
  }

  // Shows written values at once, with the derived capabilities that follow from them
  showWrittenValues(values) {
    return capabilityWrites.showWrittenValues(this, values);
  }

  // set-operating-mode offers modes a circuit may not have: refuse those before sending
  checkOperatingMode(path, value) {
    capabilityWrites.checkOperatingMode(this, path, value);
  }

  /* Settings (deviceSettings.js) */

  onSettings(event) {
    return deviceSettings.applySettings(this, event);
  }

  // Adds or removes the capabilities of the optional groups (optionalGroups.js)
  applyEnabledGroups(groups) {
    return deviceSettings.applyEnabledGroups(this, groups);
  }

  /* The Viessmann API */

  async getGatewayFeatures() {
    return this.oAuth2Client.getGatewayFeatures({
      installationId: this._installationId,
      gatewaySerial: this._gatewaySerial,
      deviceId: this._deviceId,
    });
  }

  // All features, or (`useFilter`) only the paths the app polls, on the device's heating circuit
  async getFeatures({ useFilter = false } = {}) {
    return this.oAuth2Client.getFeatures({
      installationId: this._installationId,
      gatewaySerial: this._gatewaySerial,
      deviceId: this._deviceId,
      filter: useFilter ? pollFilter(this._heatingCircuitId) : undefined,
    });
  }

  // Polls again after a pause (circuit change, maintenance action), or starts polling
  resumePolling() {
    if (this._uninitialized) return;
    const key = this.getPollingKey();
    if (!this.driver._resumePolling(key)) {
      this.driver._startPolling(this, key).catch((error) => this.error('Could not start polling:', error));
    }
  }

  /*
    Get the compressor status
  */
  async isCompressorRunning() {
    const { capabilityName } = getCapability(PATHS.COMPRESSOR);
    return this.getCapabilityValue(capabilityName);
  }

};
