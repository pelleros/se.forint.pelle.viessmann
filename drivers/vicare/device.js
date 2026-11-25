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
const validateCommand = require('../../lib/commandValidation');
const { resolveCircuitPath, normalizeCircuitFeatures } = require('./heatingCircuit');
const { inferRoles, hasRoleTags, effectiveRoles } = require('./roles');
const {
  FEATURES, PATHS, getCapability, getAllCapabilities, getCapabilityOptions,
} = require('./config');

// Reads a dot path such as 'value.value' from a feature's properties
// A property value a capability can take: a string, a boolean, a finite number or null.
// Anything else (objects, NaN, ...) counts as no value, so the capability keeps its last value.
const getPropertyValue = (properties, propertyPath) => {
  const value = propertyPath.split('.')
    .reduce((current, part) => (current == null ? undefined : current[part]), properties);
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  return Number.isFinite(value) ? value : undefined;
};

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
      this.log(
        'ViessmannDevice::onOAuth2Init installationId:', this._installationId,
        'gatewaySerial:', this._gatewaySerial,
        'deviceId:', this._deviceId,
        'roles:', this._roles,
        'features:', this._features,
        'constraints:', this._constraints,
        'operatingModes:', this._operatingModes,
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
    // Inferred roles (see roles.js) only ever add capabilities: without role tags of its own,
    // a device keeps every capability whose feature is stored
    const keepAllowed = (path) => !hasRoleTags(this._roles) || this.hasRequiredRole(path, roles);

    // Remove capabilities that are no longer in config or don't match device roles
    for (const existingCap of this.getCapabilities()) {
      let shouldKeep = false;
      for (const path of Object.values(PATHS)) {
        try {
          const capabilities = getAllCapabilities(path);
          if (capabilities.some((cap) => cap.capabilityName === existingCap) && keepAllowed(path)) {
            if (this._features.includes(path)) {
              shouldKeep = true;
              break;
            }
          }
        } catch (err) {
          continue;
        }
      }

      if (!shouldKeep) {
        await this.removeCapability(existingCap);
        this.log(`Removed capability: ${existingCap}`);
      }
    }

    // Add configured capabilities if device has required role and feature is enabled
    for (const path of Object.values(PATHS)) {
      if (!this.hasRequiredRole(path, roles) || !this._features.includes(path)) continue;

      try {
        const capabilities = getAllCapabilities(path);
        for (const capability of capabilities) {
          if (!this.hasCapability(capability.capabilityName)) {
            // Set capability options
            let capabilityOptions = getCapabilityOptions(capability.capabilityName);

            // Update with constraints if they exist
            if (this._constraints && this._constraints[path]) {
              // For temperature/targetTemperature constraints
              const tempConstraints = this._constraints[path].temperature || this._constraints[path].targetTemperature;
              if (tempConstraints) {
                capabilityOptions = {
                  ...capabilityOptions,
                  min: tempConstraints.min,
                  max: tempConstraints.max,
                  step: tempConstraints.stepping || capabilityOptions.step || 1,
                };
              }
            }

            await this.setCapabilityOptions(capability.capabilityName, capabilityOptions);
            await this.addCapability(capability.capabilityName);
          }
        }
      } catch (err) {
        this.error(`Error handling capability for ${path}:`, err);
      }
    }
  }

  async updateCapabilityOptions() {
    for (const [path, feature] of Object.entries(FEATURES)) {
      for (const capability of feature.capabilities) {
        if (!this.hasCapability(capability.capabilityName)) continue;
        const options = { ...getCapabilityOptions(capability.capabilityName) };
        const constraints = this._constraints?.[path];
        const temperature = constraints?.temperature || constraints?.targetTemperature;
        if (temperature) Object.assign(options, { min: temperature.min, max: temperature.max, step: temperature.stepping || options.step || 1 });
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
      const supportedIds = new Set(deviceModes.map((mode) => mode.id));
      const values = currentModes.filter((mode) => supportedIds.has(mode.id));
      const presentIds = new Set(values.map((mode) => mode.id));
      for (const mode of deviceModes) {
        if (!presentIds.has(mode.id)) {
          values.push(mode);
          presentIds.add(mode.id);
        }
      }

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
        const capabilities = getAllCapabilities(path);

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
    try {
      const { command } = capability;
      if (path === PATHS.HEATING_CIRCUIT_0_MODE && this._operatingModes?.length
        && !this._operatingModes.some((mode) => mode.id === value)) {
        throw new Error(`Operating mode "${value}" is not supported by this heating circuit`);
      }

      const commandName = command.useValueAsCommand
        ? (capability.valueMapping?.[value] || value) : command.name;
      const parameters = {};
      if (!command.useValueAsCommand) {
        for (const apiParam of Object.values(command.parameterMapping)) parameters[apiParam] = value;
      }
      validateCommand(this._commands, path, commandName, parameters);
      const result = await this.oAuth2Client.executeCommand({
        installationId: this._installationId,
        gatewaySerial: this._gatewaySerial,
        deviceId: this._deviceId,
        feature: resolveCircuitPath(path, this._heatingCircuitId),
        command: commandName,
        body: parameters,
      });
      if (result?.data?.success === false) {
        throw new Error(`Viessmann rejected command: ${result.data.reason || result.data.message || 'Unknown reason'}`);
      }
    } catch (error) {
      this.error('Error executing command:', error);
      // Keep the API's reason (status, Viessmann error type/message) visible to the user
      const reason = error instanceof Error ? error.message : String(error);
      const wrapped = new Error(`Error executing command: ${reason}`, { cause: error });
      wrapped.status = error?.status;
      wrapped.retryAfterMs = error?.retryAfterMs;
      throw wrapped;
    }
    // Update capability value
    await this.setCapabilityValueIfPossible(capability.capabilityName, value);
    return true;
  }

  async checkUpgradeSpecifics() {
    if (!this.getStoreValue('installationId')) {
      // 1.0.2 & 1.0.3 => 1.0.4, add roles and operatingModes and store them
      const {
        installationId, gatewaySerial, deviceId, roles, operatingModes,
      } = this.getData();
      await this.setStoreValue('installationId', installationId);
      await this.setStoreValue('gatewaySerial', gatewaySerial);
      await this.setStoreValue('deviceId', deviceId);
      if (!roles) {
        // 1.0.2 => 1.0.4
        await this.setStoreValue('roles', ['type:heating', 'type:heatpump', 'type:dhw']);
        await this.setStoreValue('operatingModes', [
          { id: 'dhw', title: { en: 'Hot water' } },
          { id: 'dhwAndHeating', title: { en: 'Hot water and Heating' } },
          { id: 'standby', title: { en: 'Standby' } },
        ]);
      } else {
        // 1.0.3 => 1.0.4
        await this.setStoreValue('roles', roles);
        await this.setStoreValue('operatingModes', operatingModes);
      }
    }
    // Refresh older pairings once so circuit discovery does not require re-pairing.
    if (this.getStoreValue('heatingCircuitId') == null || !this.getStoreValue('commandMetadata')) {
      await this.refreshStoredMetadata();
    }
    if (this.storeVersionBefore('1.0.9')) {
      await this.setStoreValue('version', '1.0.9');
    }
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
      const commands = { ...this._commands };
      for (const feature of response.data) {
        if (!feature.isEnabled) commands[feature.feature] = {};
        else if (feature.commands && typeof feature.commands === 'object') commands[feature.feature] = feature.commands;
      }
      this._commands = commands;
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
    } catch (error) {
      this.error('Error processing features update:', error);
      await this.setAvailabilitySafely(false, error);
    }
  }

  /*
    Reads every capability's value from a (circuit-normalized) features response. A capability
    can be fed by more than one feature path: paths with `fallbackFor` are read only when the
    other paths give no value. Returns capabilityName => { value, gone }: `value` is undefined
    when no path gives one, and `gone` is true when none of the paths is reported as an enabled,
    connected feature (a response without any mapped feature clears nothing).
  */
  readCapabilityValues(response) {
    const reported = new Map(response.data.map((feature) => [feature.feature, feature]));
    const absenceCounts = response.data.some((feature) => FEATURES[feature.feature]);
    const roles = this.getRoles();
    const roleAllows = ({ requireRole }) => !requireRole || roles.includes(requireRole);
    const entries = Object.entries(FEATURES)
      .filter(([, featureConfig]) => roleAllows(featureConfig))
      .sort(([, a], [, b]) => Number(Boolean(a.fallbackFor)) - Number(Boolean(b.fallbackFor)));

    const readings = new Map();
    for (const [path, featureConfig] of entries) {
      const feature = reported.get(path);
      const connected = Boolean(feature?.isEnabled && feature.properties
        && feature.properties.status?.value !== 'notConnected');
      for (const { capabilityName, propertyPath } of featureConfig.capabilities) {
        const reading = readings.get(capabilityName) || { value: undefined, gone: true };
        readings.set(capabilityName, reading);
        if (reading.value !== undefined) continue;
        if (connected) {
          reading.value = getPropertyValue(feature.properties, propertyPath);
          reading.gone = false;
          if (reading.value === undefined && process.env.DEBUG) {
            this.log(`No value found for capability: ${capabilityName}, path: ${propertyPath}`);
          }
        } else if (!feature && !absenceCounts) {
          reading.gone = false;
        }
      }
    }
    return readings;
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
      const newFeatures = [];
      for (const feature of response?.data || []) {
        if (
          feature.isEnabled
          && feature.properties?.status?.value !== 'notConnected'
          && !knownFeatures.includes(feature.feature)
          && !newFeatures.includes(feature.feature)
        ) {
          newFeatures.push(feature.feature);
        }
      }
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
    const feature = FEATURES[featurePath];
    return !feature?.requireRole || roles.includes(feature.requireRole);
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
    for (const feature of Object.values(FEATURES)) {
      const capability = feature.capabilities.find((cap) => cap.capabilityName === capabilityName);
      if (capability) return { ...capability, requireRole: feature.requireRole };
    }
    return null;
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

        // Compare with original value before value mapping
        const currentValue = this.getCapabilityValue(capabilityName);
        if (currentValue !== value) {
          let processedValue = value;
          if (capability.valueMapping && value in capability.valueMapping) {
            processedValue = capability.valueMapping[value];
          }

          await this.setCapabilityValue(capabilityName, processedValue);
          if (!trigger) return;

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
    if (!changedKeys.includes('heatingCircuit')) return;
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
    await this.driver._stopPolling(this.getPollingKey());
  }

  async onOAuth2Deleted() {
    // Stop polling right away: a poll that runs after deletion fails with device_not_found
    this._uninitialized = true;
    await this.driver._stopPolling(this.getPollingKey());
  }

  storeVersionBefore(targetVersion) {
    const currentVersion = this.getStoreValue('version');
    const parts1 = (currentVersion || '0.0.0').split('.').map(Number);
    const parts2 = targetVersion.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
      if (parts1[i] > parts2[i]) return false;
      if (parts1[i] < parts2[i]) return true;
    }
    return false;
  }

};
