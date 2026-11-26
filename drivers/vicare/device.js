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

const { OAuth2Device } = require('homey-oauth2app');
const { resolveCircuitPath, normalizeCircuitFeatures } = require('./heatingCircuit');
const { inferRoles, hasRoleTags, effectiveRoles } = require('./roles');
const { FEATURES, PATHS, getCapability } = require('./config');
const { featureMapper, mergeOperatingModes } = require('./featureMapper');
const { maskId } = require('../../lib/logPrivacy');
const { runMigrations, versionBefore } = require('./migrations');
const { isGroupSetting, enabledGroups } = require('./optionalGroups');
const { fireValueTriggers } = require('./flowHandlers');
const { recordFeatures } = require('./featureCards');
const { boostsOf } = require('./boost');
const { capabilityCommand, sendFeatureCommand } = require('./commands');

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

    this.onFeaturesUpdated = this.onFeaturesUpdated.bind(this);

    // Deleted or unloaded while initialising: never start a poller that nothing would stop
    if (this._uninitialized) return;
    // Temporary changes from Flows that still have to be undone (boost.js)
    boostsOf(this).resume();
    await this.driver._startPolling(this, this.getPollingKey());
  }

  async onInit() {
    await super.onInit();
    if (process.env.DEBUG) {
      this.log('[ViessmannDevice::onInit] called');
    }
  }

  async initializeCapabilities() {
    // Without a stored feature list (pairings older than 1.0.9 whose refresh failed) every
    // capability would look obsolete; leave them alone until the refresh succeeds
    if (!Array.isArray(this._features)) {
      this.error('No stored feature list, capabilities are left unchanged');
      return;
    }

    const roles = this.getRoles();
    const groups = this.getEnabledGroups();
    // Inferred roles (see roles.js) only ever add capabilities: without role tags of its own,
    // a device keeps every capability whose feature is stored. Capabilities of an optional
    // group that is turned off are removed (optionalGroups.js)
    const keepAllowed = (path) => featureMapper.isInEnabledGroup(path, groups)
      && (!hasRoleTags(this._roles) || this.hasRequiredRole(path, roles));

    // Remove capabilities that are no longer in config or don't match device roles
    for (const existingCap of this.getCapabilities()) {
      if (!featureMapper.isProduced(existingCap, this._features, keepAllowed)) {
        await this.removeCapability(existingCap);
        this.log(`Removed capability: ${existingCap}`);
      }
    }

    // Add configured capabilities if device has required role and feature is enabled, with the
    // API's temperature limits as min/max/step
    for (const { path, capability: { capabilityName } } of featureMapper.capabilitiesFor(this._features, roles, groups)) {
      if (this.hasCapability(capabilityName)) continue;
      try {
        await this.setCapabilityOptions(capabilityName, featureMapper.optionsFor(capabilityName, path, this._constraints));
        await this.addCapability(capabilityName);
      } catch (err) {
        this.error(`Error handling capability ${capabilityName} for ${path}:`, err);
      }
    }
  }

  async updateCapabilityOptions() {
    for (const [path, feature] of Object.entries(FEATURES)) {
      for (const capability of feature.capabilities) {
        if (!this.hasCapability(capability.capabilityName)) continue;
        const options = featureMapper.optionsFor(capability.capabilityName, path, this._constraints);
        try {
          await this.setCapabilityOptions(capability.capabilityName, options);
        } catch (error) {
          this.error(`Could not update the options of ${capability.capabilityName}:`, error);
        }
      }
    }
  }

  async initializeOperatingModes() {
    // Not that bad if this fails, we can just use the default operating modes
    try {
      const deviceModes = Array.isArray(this._operatingModes) ? this._operatingModes : [];
      // Without known device modes, keep whatever the capability offers today
      if (deviceModes.length === 0) return;

      const { capabilityName } = getCapability(PATHS.HEATING_CIRCUIT_0_MODE);
      if (!this.hasCapability(capabilityName)) return;

      const capabilityOptions = this.getCapabilityOptions(capabilityName) || {};
      const currentModes = Array.isArray(capabilityOptions.values) ? capabilityOptions.values : [];

      // Existing values the device supports (in their current order), then device modes not yet present
      const values = mergeOperatingModes(currentModes, deviceModes);

      if (process.env.DEBUG) {
        this.log('[ViessmannDevice::initializeOperatingModes] Operating modes:', values.map((mode) => mode.id));
      }
      await this.setCapabilityOptions(capabilityName, { ...capabilityOptions, values });
    } catch (err) {
      if (process.env.DEBUG) {
        this.log('Error initializing operating modes:', err);
      }
    }
  }

  async registerCapabilityListeners() {
    if (!Array.isArray(this._listeners)) this._listeners = [];

    for (const path of Object.values(PATHS)) {
      try {
        const capabilities = FEATURES[path]?.capabilities || [];

        for (const capability of capabilities) {
          // Skip if no command is defined or listener already exists
          if (!capability.command || this._listeners.includes(capability.capabilityName)) continue;

          const registered = this.registerCapabilityListenerIfPossible(
            capability.capabilityName,
            async (value) => {
              if (process.env.DEBUG) {
                this.log(`${capability.capabilityName}:`, value);
              }

              await this.executeCommand(path, capability, value);
            },
          );

          // Only remember capabilities that really got a listener, so a capability
          // added later (e.g. by feature discovery) gets one on the next run
          if (registered) {
            this._listeners.push(capability.capabilityName);
          }
        }
      } catch (err) {
        this.error(`Error setting up listener for ${path}:`, err);
      }
    }
  }

  async executeCommand(path, capability, value) {
    const { command, parameters } = capabilityCommand(capability, value);
    await sendFeatureCommand(this, path, command, parameters, { check: () => this.checkOperatingMode(path, value) });
    await this.setCapabilityValueIfPossible(capability.capabilityName, value);
    return true;
  }

  // set-operating-mode offers modes a circuit may not have: refuse those before sending
  checkOperatingMode(path, value) {
    if (path === PATHS.HEATING_CIRCUIT_0_MODE && this._operatingModes?.length
      && !this._operatingModes.some((mode) => mode.id === value)) {
      throw new Error(`Operating mode "${value}" is not supported by this heating circuit`);
    }
  }

  // Store migrations, see migrations.js
  async checkUpgradeSpecifics() {
    const ran = await runMigrations(this);
    if (ran.length > 0) this.log('Store migrations run:', ran.join(', '));
  }

  /*
    Re-reads the device's features from the API and stores what pairing stores today
    (heating circuit, constraints, operating modes, command metadata). The stored feature
    list becomes the union of the old and the fresh list, so a sensor that is disabled or
    notConnected at this moment keeps its capability. The refresh is not needed to run the
    device: a failure is logged and the refresh is retried on the next start.
  */
  async refreshStoredMetadata() {
    try {
      const metadata = await this.driver._getEnabledFeaturesAndOpModes(
        this.oAuth2Client,
        this.getStoreValue('installationId'),
        this.getStoreValue('gatewaySerial'),
        this.getStoreValue('deviceId'),
        this.getSetting?.('heatingCircuit') || 'auto',
      );
      const merged = this.mergeRefreshedMetadata(metadata);
      // heatingCircuitId and commandMetadata go last: until both are stored, the next start
      // runs the refresh again
      for (const key of ['features', 'constraints', 'operatingModes', 'commandMetadata', 'heatingCircuitId']) {
        if (merged[key] !== undefined) await this.setStoreValue(key, merged[key]);
      }
    } catch (error) {
      this.error('Could not refresh the device metadata, retrying on the next start:', error);
    }
  }

  /*
    Combines freshly read metadata with what the device has stored. The feature list only
    grows. Constraints are merged per feature, and stored operating modes are kept when the
    API reports none right now. Everything else comes from the fresh metadata.
  */
  mergeRefreshedMetadata(metadata) {
    const storedFeatures = this.getStoreValue('features');
    const features = Array.isArray(storedFeatures) ? [...storedFeatures] : [];
    for (const feature of Array.isArray(metadata?.features) ? metadata.features : []) {
      if (!features.includes(feature)) features.push(feature);
    }
    const storedModes = this.getStoreValue('operatingModes');
    return {
      ...metadata,
      features,
      constraints: { ...this.getStoreValue('constraints'), ...metadata?.constraints },
      operatingModes: metadata?.operatingModes?.length ? metadata.operatingModes : storedModes,
    };
  }

  async onFeaturesUpdated(rawResponse, extendedResponse, { triggers = true } = {}) {
    try {
      // Not a features response at all. Single odd entries or values in one are skipped below.
      if (!Array.isArray(rawResponse?.data)) throw new Error('Invalid features response: no feature list');
      const response = normalizeCircuitFeatures(rawResponse, this._heatingCircuitId);
      this._commands = featureMapper.updatedCommands(response, this._commands);
      // For the Flow cards that read any feature (featureCards.js)
      recordFeatures(this, response, { complete: Boolean(extendedResponse) });
      if (process.env.DEBUG) {
        this.log('Starting feature update processing...', 'extendedResponse:', extendedResponse);
      }
      if (extendedResponse) {
        await this.addNewFeatures(response);
      }
      await this.addInferredRoles(response.data);

      for (const [capabilityName, reading] of this.readCapabilityValues(response)) {
        if (reading.value !== undefined) {
          await this.setCapabilityValueIfPossible(capabilityName, reading.value, { trigger: triggers });
        } else if (reading.gone && this.hasCapability(capabilityName) && this.getCapabilityValue(capabilityName) !== null) {
          // The last value would stay on screen and in Insights for good; the capability stays
          this.log(`${capabilityName} is no longer reported, clearing its value`);
          await this.setCapabilityValueIfPossible(capabilityName, null, { trigger: false });
        }
      }

      if (process.env.DEBUG) {
        this.log('Feature update processing completed');
      }

      await this.setAvailabilitySafely(true);
      await this.markSeen();
    } catch (error) {
      this.error('Error processing features update:', error);
      await this.setAvailabilitySafely(false, error);
    }
  }

  /*
    Reads every capability's value from a (circuit-normalized) features response, for the
    capabilities this device's roles allow (see FeatureMapper.readValues). Returns
    capabilityName => { value, gone }.
  */
  readCapabilityValues(response) {
    return featureMapper.readValues(response, this.getRoles());
  }

  // Homey shows when the device was last heard from: after every successful update (a poll, or
  // the read when the heating circuit changes)
  async markSeen() {
    try {
      await this.setLastSeenAt();
    } catch (error) {
      this.error('Could not set the last seen time:', error);
    }
  }

  // setAvailable/setUnavailable reject (e.g. with 'device_not_found') when the device was
  // deleted meanwhile; log that instead of letting the rejection go unhandled
  async setAvailabilitySafely(available, message) {
    try {
      if (available) {
        await this.setAvailable();
      } else {
        await this.setUnavailable(message);
      }
    } catch (error) {
      this.error(`Could not mark device as ${available ? 'available' : 'unavailable'}:`, error);
    }
  }

  /*
    Store features that an extended (unfiltered) poll reports as enabled but the device
    does not know yet, then add their capabilities and listeners. The stored list only
    ever grows: a feature that is missing or notConnected in one response is kept.
    Failures are logged and retried on the next extended poll; they must not make the
    device unavailable.
  */
  async addNewFeatures(response) {
    try {
      const knownFeatures = Array.isArray(this._features) ? this._features : [];
      const newFeatures = featureMapper.newFeatures(response, knownFeatures);
      if (newFeatures.length === 0) return;

      this.log('New features found:', newFeatures);
      const features = [...knownFeatures, ...newFeatures];
      await this.setStoreValue('features', features);
      this._features = features;

      await this.initializeCapabilities();
      await this.registerCapabilityListeners();
    } catch (error) {
      this.error('Error adding new features:', error);
    }
  }

  /*
    Roles to check `requireRole` against: the stored roles or, when they contain no role tag
    that FEATURES uses (newer models), roles inferred from the stored features and from
    responses (see roles.js).
  */
  getRoles() {
    return effectiveRoles(this._roles, [...inferRoles(this._features), ...(this._responseRoles || [])]);
  }

  hasRequiredRole(featurePath, roles = this.getRoles()) {
    return featureMapper.hasRequiredRole(featurePath, roles);
  }

  // The optional groups of values that are turned on (optionalGroups.js)
  getEnabledGroups() {
    return this._enabledGroups || enabledGroups((key) => this.getSetting?.(key));
  }

  /*
    A response can show a role that the stored features do not (e.g. `heating.compressors`
    listing a compressor): remember it and add the capabilities it allows. Like addNewFeatures,
    a failure is logged and must not make the device unavailable.
  */
  async addInferredRoles(featureData) {
    try {
      if (hasRoleTags(this._roles)) return;
      const known = this.getRoles();
      const learned = inferRoles([], featureData).filter((role) => !known.includes(role));
      if (learned.length === 0) return;
      this.log('Roles inferred from the features:', learned);
      this._responseRoles = [...(this._responseRoles || []), ...learned];
      await this.initializeCapabilities();
      await this.registerCapabilityListeners();
    } catch (error) {
      this.error('Error adding capabilities for inferred roles:', error);
    }
  }

  getConfigCapabilityByName(capabilityName) {
    return featureMapper.capabilityByName(capabilityName);
  }

  // `trigger: false` updates the value without firing its trigger card
  async setCapabilityValueIfPossible(capabilityName, value, { trigger = true } = {}) {
    try {
      if (this.hasCapability(capabilityName)) {
        const capability = this.getConfigCapabilityByName(capabilityName);
        if (!capability) {
          this.error(`No configuration found for capability: ${capabilityName}`);
          return;
        }

        // Compare with the value the capability shows (after value mapping)
        const currentValue = this.getCapabilityValue(capabilityName);
        const displayed = featureMapper.displayValue(capabilityName, value);
        if (currentValue !== displayed) {
          await this.setCapabilityValue(capabilityName, displayed);
          if (!trigger) return;
          await fireValueTriggers(this, capabilityName, displayed, currentValue);

          try {
            const triggerCard = this.driver.getTriggerCard(capabilityName);
            if (triggerCard) {
              await triggerCard.trigger(this, { mode: value }, {});
            }
          } catch (error) {
            // Ignore if no trigger card exists
          }
        }
      }
    } catch (error) {
      this.error(`Failed to set capability ${capabilityName}:`, error);
    }
  }

  // Returns true when the listener was registered
  registerCapabilityListenerIfPossible(capabilityName, listener) {
    if (this.hasCapability(capabilityName)) {
      this.registerCapabilityListener(capabilityName, listener);
      return true;
    }
    this.log(`Capability ${capabilityName} not found, skipping listener registration`);
    return false;
  }

  async getGatewayFeatures() {
    return this.oAuth2Client.getGatewayFeatures({
      installationId: this._installationId,
      gatewaySerial: this._gatewaySerial,
      deviceId: this._deviceId,
    });
  }

  async getFeatures({ useFilter = false } = {}) {
    const featuresFilter = useFilter
      ? Object.values(PATHS).map((path) => resolveCircuitPath(path, this._heatingCircuitId)).join(',')
      : undefined;

    return this.oAuth2Client.getFeatures({
      installationId: this._installationId,
      gatewaySerial: this._gatewaySerial,
      deviceId: this._deviceId,
      filter: featuresFilter,
    });
  }

  /*
    Get the compressor status
  */
  async isCompressorRunning() {
    const { capabilityName } = getCapability(PATHS.COMPRESSOR);
    return this.getCapabilityValue(capabilityName);
  }

  // Key of this device's poller in the driver
  getPollingKey() {
    return `${this._installationId}-${this._gatewaySerial}-${this._deviceId}`;
  }

  async onSettings({ newSettings, changedKeys }) {
    if (changedKeys.includes('heatingCircuit')) await this.changeHeatingCircuit(newSettings);
    if (changedKeys.some(isGroupSetting)) await this.applyEnabledGroups(enabledGroups(newSettings));
  }

  // Adds or removes the capabilities of the optional groups (optionalGroups.js)
  async applyEnabledGroups(groups) {
    this._enabledGroups = groups;
    await this.initializeCapabilities();
    await this.updateCapabilityOptions();
    await this.registerCapabilityListeners();
  }

  async changeHeatingCircuit(newSettings) {
    const selectedCircuit = String(newSettings.heatingCircuit).trim();
    if (selectedCircuit !== 'auto' && !/^\d+$/.test(selectedCircuit)) {
      throw new Error(`Unknown heating circuit setting: ${selectedCircuit}`);
    }
    // One unfiltered read gives both the new circuit's metadata and its current values
    const response = await this.getFeatures();
    let fresh;
    try {
      fresh = this.driver._readDeviceMetadata(response, selectedCircuit);
    } catch (error) {
      // Homey shows the message and keeps the previous value; nothing has changed yet
      if (error.code === 'heating_circuit_not_available') throw new Error(this.circuitNotAvailableMessage(error));
      throw error;
    }
    const metadata = this.mergeRefreshedMetadata(fresh);
    // Pausing (not replacing) the poller keeps its backoff and Retry-After; a poll still in
    // progress for the old circuit is dropped
    await this.driver._pausePolling(this.getPollingKey());
    const previous = {
      heatingCircuitId: this._heatingCircuitId,
      // The feature list only grows, also when the switch is rolled back
      features: metadata.features,
      constraints: this._constraints,
      operatingModes: this._operatingModes,
      commandMetadata: this._commands,
    };
    const circuitChanged = metadata.heatingCircuitId !== previous.heatingCircuitId;
    try {
      await this.applyCircuitMetadata(metadata);
      if (circuitChanged) await this.clearValuesNotReportedBy(fresh.features);
      // Show the new circuit's values now, without waiting for (or adding) a poll. A different
      // mode on the new circuit is not a mode change, so heating-mode-changed does not fire.
      await this.onFeaturesUpdated(response, false, { triggers: !circuitChanged });
    } catch (error) {
      await this.applyCircuitMetadata(previous);
      throw error;
    } finally {
      this.resumePolling();
    }
  }

  /*
    After switching circuits, per-circuit capabilities whose feature the new circuit does not
    report would keep showing the old circuit's values. Their values become unknown (null);
    the capabilities themselves stay.
  */
  async clearValuesNotReportedBy(reportedFeatures = []) {
    for (const [path, feature] of Object.entries(FEATURES)) {
      if (!path.startsWith('heating.circuits.0.') || reportedFeatures.includes(path)) continue;
      for (const { capabilityName } of feature.capabilities) {
        if (this.hasCapability(capabilityName) && this.getCapabilityValue(capabilityName) !== null) {
          try {
            await this.setCapabilityValue(capabilityName, null);
          } catch (error) {
            this.error(`Could not clear ${capabilityName}:`, error);
          }
        }
      }
    }
  }

  resumePolling() {
    if (this._uninitialized) return;
    const key = this.getPollingKey();
    if (!this.driver._resumePolling(key)) {
      this.driver._startPolling(this, key).catch((error) => this.error('Could not start polling:', error));
    }
  }

  // The error for a heating circuit the installation does not have, in the user's language
  circuitNotAvailableMessage({ circuit, available, message }) {
    const tags = { circuit, available: available.length > 0 ? available.join(', ') : '–' };
    const translated = this.homey?.__?.('device_settings.heating_circuit_not_available', tags);
    return typeof translated === 'string' && !translated.startsWith('device_settings.') ? translated : message;
  }

  async applyCircuitMetadata(metadata) {
    for (const [key, value] of Object.entries(metadata)) await this.setStoreValue(key, value);
    this._heatingCircuitId = metadata.heatingCircuitId;
    this._features = metadata.features;
    this._constraints = metadata.constraints;
    this._operatingModes = metadata.operatingModes;
    this._commands = metadata.commandMetadata;
    await this.initializeCapabilities();
    await this.updateCapabilityOptions();
    await this.initializeOperatingModes();
    await this.registerCapabilityListeners();
  }

  async onOAuth2Uninit() {
    // Stop polling for this device
    this._uninitialized = true;
    this._boosts?.stop();
    await this.driver._stopPolling(this.getPollingKey());
  }

  async onOAuth2Deleted() {
    // Stop polling right away: a poll that runs after deletion fails with device_not_found
    this._uninitialized = true;
    this._boosts?.stop();
    await this.driver._stopPolling(this.getPollingKey());
  }

  storeVersionBefore(targetVersion) {
    return versionBefore(this.getStoreValue('version'), targetVersion);
  }

};
