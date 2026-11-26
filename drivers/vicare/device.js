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
const { FEATURES, PATHS, getCapability } = require('./config');
const { MODE_TITLES } = require('./config/thermostat');
const { featureMapper, mergeOperatingModes } = require('./featureMapper');
const { maskId } = require('../../lib/logPrivacy');
const WriteLimiter = require('../../lib/writeLimiter');
const { runMigrations, versionBefore } = require('./migrations');

/**
 * A date from a Flow card (Homey's date argument gives DD-MM-YYYY; YYYY-MM-DD is accepted too)
 * as the API wants it, YYYY-MM-DD, or null when it is no real date.
 * @param {unknown} text
 * @returns {string | null}
 */
function apiDate(text) {
  const match = String(text ?? '').trim().match(/^(\d{2})-(\d{2})-(\d{4})$|^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [year, month, day] = match[1] ? [match[3], match[2], match[1]] : [match[4], match[5], match[6]];
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCDate() === Number(day) && date.getUTCMonth() === Number(month) - 1 ? `${year}-${month}-${day}` : null;
}

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
      if (!featureMapper.isProduced(existingCap, this._features, keepAllowed)) {
        await this.removeCapability(existingCap);
        this.log(`Removed capability: ${existingCap}`);
      }
    }

    // Add configured capabilities if device has required role and feature is enabled, with the
    // API's temperature limits as min/max/step
    for (const { path, capability: { capabilityName } } of featureMapper.capabilitiesFor(this._features, roles)) {
      if (this.hasCapability(capabilityName)) continue;
      try {
        await this.setCapabilityOptions(capabilityName, featureMapper.optionsFor(capabilityName, path, this._constraints, this.deviceContext()));
        await this.addCapability(capabilityName);
      } catch (err) {
        this.error(`Error handling capability ${capabilityName} for ${path}:`, err);
      }
    }
  }

  // Options from the config and the API's limits, for the feature path the device has (newer
  // devices name some programs differently)
  async updateCapabilityOptions() {
    const context = this.deviceContext();
    for (const capabilityName of this.getCapabilities()) {
      const derived = featureMapper.derivedByName(capabilityName);
      const path = derived ? derived.sources[0] : featureMapper.commandTarget(capabilityName, this._features)?.path;
      if (!path) continue;
      try {
        await this.setCapabilityOptions(capabilityName, featureMapper.optionsFor(capabilityName, path, this._constraints, context));
      } catch (error) {
        this.error(`Could not update the options of ${capabilityName}:`, error);
      }
    }
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

  async initializeOperatingModes() {
    // Not that bad if this fails, we can just use the default operating modes
    try {
      // Translated titles for the modes the app knows
      const deviceModes = (Array.isArray(this._operatingModes) ? this._operatingModes : [])
        .map((mode) => (MODE_TITLES[mode?.id] ? { id: mode.id, title: MODE_TITLES[mode.id] } : mode));
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

    for (const capabilityName of featureMapper.writableCapabilities()) {
      if (this._listeners.includes(capabilityName)) continue;
      try {
        const registered = this.registerCapabilityListenerIfPossible(capabilityName, async (value) => {
          if (process.env.DEBUG) {
            this.log(`${capabilityName}:`, value);
          }
          // A write that does not change the value (e.g. a Matter bridge or voice assistant
          // repeating the current set point) sends nothing to Viessmann
          if (value === this.getCapabilityValue(capabilityName)) return;
          await this.writeCapability(capabilityName, value);
        });

        // Only remember capabilities that really got a listener, so a capability
        // added later (e.g. by feature discovery) gets one on the next run
        if (registered) {
          this._listeners.push(capabilityName);
        }
      } catch (err) {
        this.error(`Error setting up listener for ${capabilityName}:`, err);
      }
    }
  }

  /*
    Writes a capability value to the device, from a capability listener or a Flow action: through
    the capability's command on the feature path the device has, or, for a derived capability
    (e.g. the standard thermostat mode or the program picker), through the commands it needs.
  */
  async writeCapability(capabilityName, value) {
    const derived = featureMapper.derivedByName(capabilityName);
    if (derived?.write) return this.writeDerived(derived, value);
    const target = featureMapper.commandTarget(capabilityName, this._features);
    if (!target?.capability.command) throw new Error(`${capabilityName} cannot be changed`);
    return this.executeCommand(target.path, target.capability, value);
  }

  async writeDerived(derived, value) {
    let plan;
    try {
      plan = derived.write(value, this.deviceContext());
    } catch (error) {
      throw new Error(this.userMessage(error), { cause: error });
    }
    for (const { path, command, parameters } of plan.commands) {
      // A newer write of the same command replaced this one
      if (!await this.sendCommand(path, command, parameters)) return true;
    }
    for (const [capabilityName, newValue] of Object.entries(plan.values)) {
      await this.setCapabilityValueIfPossible(capabilityName, newValue);
    }
    return true;
  }

  async executeCommand(path, capability, value) {
    const { command } = capability;
    const commandName = command.useValueAsCommand
      ? (capability.valueMapping?.[value] || value) : command.name;
    const parameters = {};
    if (!command.useValueAsCommand) {
      for (const apiParam of Object.values(command.parameterMapping)) parameters[apiParam] = value;
    }
    // Update the capability value, and the others that show the same property (the heating set
    // point and the standard thermostat's), unless a newer write of the same command replaced it
    if (await this.sendCommand(path, commandName, parameters)) {
      const siblings = (FEATURES[path]?.capabilities || [])
        .filter((other) => other.capabilityName === capability.capabilityName || (other.propertyPath === capability.propertyPath
          && !other.valueMapping && !capability.valueMapping));
      for (const { capabilityName } of siblings.length > 0 ? siblings : [capability]) {
        await this.setCapabilityValueIfPossible(capabilityName, value);
      }
    }
    return true;
  }

  /*
    Sends one command after checking it against the command metadata, at most once per 10
    seconds per command (a newer one waiting replaces an older one) and at most 30 per hour
    (lib/writeLimiter.js). Resolves false when a newer write replaced it.
  */
  async sendCommand(path, commandName, parameters) {
    try {
      if (path === PATHS.HEATING_CIRCUIT_0_MODE && this._operatingModes?.length
        && !this._operatingModes.some((mode) => mode.id === parameters.mode)) {
        throw new Error(`Operating mode "${parameters.mode}" is not supported by this heating circuit`);
      }
      validateCommand(this._commands, path, commandName, parameters);
      return await this.writeLimiter().run(`${path} ${commandName}`, async () => {
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
      });
    } catch (error) {
      this.error('Error executing command:', error);
      // Keep the API's reason (status, Viessmann error type/message) visible to the user
      const reason = this.userMessage(error);
      const wrapped = new Error(`Error executing command: ${reason}`, { cause: error });
      wrapped.status = error?.status;
      wrapped.retryAfterMs = error?.retryAfterMs;
      throw wrapped;
    }
  }

  writeLimiter() {
    if (!this._writeLimiter) {
      // Homey's timers, which Homey clears when the app stops
      const { homey } = this;
      this._writeLimiter = new WriteLimiter(homey?.setTimeout ? {
        setTimeout: (callback, ms) => homey.setTimeout(callback, ms),
        clearTimeout: (timer) => homey.clearTimeout(timer),
      } : {});
    }
    return this._writeLimiter;
  }

  // The message of an error in the user's language when it has a code with a translation
  // (locales/*.json → commands), else its own message
  userMessage(error) {
    const fallback = error instanceof Error ? error.message : String(error);
    if (!error?.code) return fallback;
    const translated = this.homey?.__?.(`commands.${error.code}`);
    return typeof translated === 'string' && !translated.startsWith('commands.') ? translated : fallback;
  }

  // Schedules the holiday program from one date to another (Flow action)
  async startHoliday({ start, end }) {
    const from = apiDate(start);
    const to = apiDate(end);
    if (!from || !to) throw new Error(this.userMessage(Object.assign(new Error('Enter the dates as DD-MM-YYYY'), { code: 'holiday_invalid_date' })));
    const sameDayAllowed = this._commands?.[PATHS.HOLIDAY]?.schedule?.params?.end?.constraints?.sameDayAllowed;
    if (to < from || (to === from && sameDayAllowed === false)) {
      throw new Error(this.userMessage(Object.assign(new Error('The holiday must end after it starts'), { code: 'holiday_end_before_start' })));
    }
    await this.sendCommand(PATHS.HOLIDAY, 'schedule', { start: from, end: to });
    return true;
  }

  // Ends (or cancels) the holiday program (Flow action)
  async endHoliday() {
    if (await this.sendCommand(PATHS.HOLIDAY, 'unschedule', {})) {
      await this.setCapabilityValueIfPossible('measure_holiday_active', false);
    }
    return true;
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
    return featureMapper.readValues(response, this.getRoles(), { language: this.homeyLanguage(), features: this._features });
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

        // Compare what the capability would show (after value mapping) with what it shows
        const currentValue = this.getCapabilityValue(capabilityName);
        const displayValue = featureMapper.displayValue(capabilityName, value);
        if (currentValue !== displayValue) {
          await this.setCapabilityValue(capabilityName, displayValue);
          if (!trigger) return;

          await this.fireTriggers(capabilityName, displayValue);
        }
      }
    } catch (error) {
      this.error(`Failed to set capability ${capabilityName}:`, error);
    }
  }

  // Fires the trigger cards of a capability that changed (see flowCards.js)
  async fireTriggers(capabilityName, value) {
    if (typeof this.driver?.triggerCapabilityChange !== 'function') {
      // A driver without trigger groups: its one trigger card per capability, if any
      try {
        const triggerCard = this.driver.getTriggerCard(capabilityName);
        if (triggerCard) await triggerCard.trigger(this, { mode: value }, {});
      } catch (error) {
        // No trigger card for this capability
      }
      return;
    }
    try {
      await this.driver.triggerCapabilityChange(this, capabilityName, value);
    } catch (error) {
      this.error(`Could not fire the trigger of ${capabilityName}:`, error);
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
    this._writeLimiter?.stop();
    await this.driver._stopPolling(this.getPollingKey());
  }

  async onOAuth2Deleted() {
    // Stop polling right away: a poll that runs after deletion fails with device_not_found
    this._uninitialized = true;
    this._writeLimiter?.stop();
    await this.driver._stopPolling(this.getPollingKey());
  }

  storeVersionBefore(targetVersion) {
    return versionBefore(this.getStoreValue('version'), targetVersion);
  }

};
