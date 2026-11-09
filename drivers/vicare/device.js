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
const {
  FEATURES, PATHS, getCapability, getAllCapabilities, getCapabilityOptions,
} = require('./config');

module.exports = class ViessmannDevice extends OAuth2Device {

  static FEATURES = FEATURES;
  static PATHS = PATHS;

  async onOAuth2Init() {
    await this.checkUpgradeSpecifics();
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

    const deviceKey = `${this._installationId}-${this._gatewaySerial}-${this._deviceId}`;
    await this.driver._startPolling(this, deviceKey);
  }

  async onInit() {
    await super.onInit();
    if (process.env.DEBUG) {
      this.log('[ViessmannDevice::onInit] called');
    }
  }

  async initializeCapabilities() {
    // Remove capabilities that are no longer in config or don't match device roles
    for (const existingCap of this.getCapabilities()) {
      let shouldKeep = false;
      for (const path of Object.values(PATHS)) {
        try {
          const capabilities = getAllCapabilities(path);
          if (capabilities.some((cap) => cap.capabilityName === existingCap) && this.hasRequiredRole(path)) {
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
      if (!this.hasRequiredRole(path) || !this._features.includes(path)) continue;

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
        await this.setCapabilityOptions(capability.capabilityName, options);
      }
    }
  }

  async initializeOperatingModes() {
    // Not that bad if this fails, we can just use the default operating modes
    try {
      const { capabilityName } = getCapability(PATHS.HEATING_CIRCUIT_0_MODE);
      const operatingModesCapOpt = { ...this.getCapabilityOptions(capabilityName) };
      // Clone per-device options: config defaults must not be shared or mutated.
      if (this._operatingModes?.length) {
        operatingModesCapOpt.values = this._operatingModes.map((mode) => ({ ...mode }));
      }
      await this.setCapabilityOptions(capabilityName, operatingModesCapOpt);
    } catch (err) {
      if (process.env.DEBUG) {
        this.log('Error initializing operating modes:', err);
      }
    }
  }

  async registerCapabilityListeners() {
    for (const path of Object.values(PATHS)) {
      try {
        const capabilities = getAllCapabilities(path);

        for (const capability of capabilities) {
          // Skip if no command is defined or listener already exists
          if (!capability.command || this._listeners.includes(path)) continue;

          this.registerCapabilityListenerIfPossible(
            capability.capabilityName,
            async (value) => {
              if (process.env.DEBUG) {
                this.log(`${capability.capabilityName}:`, value);
              }

              await this.executeCommand(path, capability, value);
            },
          );

          this._listeners.push(path);
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
      this.log('Error executing command:', error.message);
      const wrapped = new Error(`Error executing command: ${error.message}`, { cause: error });
      wrapped.status = error.status;
      wrapped.retryAfterMs = error.retryAfterMs;
      throw wrapped;
    }
    // Uppdate capability value 
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
      const metadata = await this.driver._getEnabledFeaturesAndOpModes(
        this.oAuth2Client,
        this.getStoreValue('installationId'),
        this.getStoreValue('gatewaySerial'),
        this.getStoreValue('deviceId'),
        this.getSetting?.('heatingCircuit') || 'auto',
      );
      for (const [key, value] of Object.entries(metadata)) {
        await this.setStoreValue(key, value);
      }
    }
    if (this.storeVersionBefore('1.0.9')) {
      await this.setStoreValue('version', '1.0.9');
    }
  }

  async onFeaturesUpdated(response, extendedResponse) {
    response = normalizeCircuitFeatures(response, this._heatingCircuitId);
    try {
      const commands = { ...this._commands };
      for (const feature of response.data) {
        if (!feature.isEnabled) commands[feature.feature] = {};
        else if (feature.commands) commands[feature.feature] = feature.commands;
      }
      this._commands = commands;
      if (process.env.DEBUG) {
        this.log('Starting feature update processing...', 'extendedResponse:', extendedResponse);
      }
      if (extendedResponse) {
        // get all enabled features from the response
        const enabledFeatures = [];
        for (const feature of response.data) {
          if (feature.isEnabled && feature.properties?.status?.value !== 'notConnected') {
            enabledFeatures.push(feature.feature);
          }
        }
        // find features in the response that are not in the device store
        const newFeatures = enabledFeatures.filter((feature) => !this._features.includes(feature));
        if (newFeatures.length > 0) {
          this.log('New features found:', newFeatures);
          // add new features to this._features
          this._features = [...this._features, ...newFeatures];
          // update the store
          await this.setStoreValue('features', this._features);
          // Initialize capabilities and listeners
          await this.initializeCapabilities();
          await this.registerCapabilityListeners();
        }
      }

      for (const feature of response.data) {
        if (!feature.isEnabled || !feature.properties || feature.properties?.status?.value === 'notConnected') {
          if (process.env.DEBUG && !extendedResponse) {
            this.log(`Skipping disabled/empty feature: ${feature.feature}`);
          }
          continue;
        }

        const featureConfig = FEATURES[feature.feature];
        if (!featureConfig) {
          if (process.env.DEBUG && !extendedResponse) {
            this.log(`Skipping unknown feature: ${feature.feature}`);
          }
          continue;
        }

        // Check if device has required role for this feature
        if (featureConfig.requireRole && !this._roles.includes(featureConfig.requireRole)) {
          if (process.env.DEBUG && !extendedResponse) {
            this.log(`Skipping feature due to missing role: ${feature.feature}, required role: ${featureConfig.requireRole}`);
          }
          continue;
        }

        if (process.env.DEBUG && !extendedResponse) {
          // this.log(`Processing feature: ${feature.feature}`);
        }

        // Helper function to safely get nested property values
        const getValue = (obj, path) => {
          // if error, return undefined
          try {
            return path.split('.').reduce((acc, part) => acc && acc[part], obj);
          } catch (error) {
            if (process.env.DEBUG) {
              this.log(`Error getting value for path: ${path}, error:`, error);
            }
            return undefined;
          }
        };

        // Update all capabilities associated with this feature
        for (const capability of featureConfig.capabilities) {
          const value = getValue(feature.properties, capability.propertyPath);
          if (value !== undefined) {
            if (process.env.DEBUG) {
              // this.log(`Setting capability: ${capability.capabilityName} = ${value} (from ${capability.propertyPath})`);
            }
            await this.setCapabilityValueIfPossible(capability.capabilityName, value);
          } else if (process.env.DEBUG) {
            this.log(`No value found for capability: ${capability.capabilityName}, path: ${capability.propertyPath}`);
          }
        }
      }

      if (process.env.DEBUG) {
        this.log('Feature update processing completed');
      }

      this.setAvailable();
    } catch (error) {
      this.error('Error processing features update:', error);
      this.setUnavailable(error);
    }
  }

  hasRequiredRole(featurePath) {
    const feature = FEATURES[featurePath];
    return !feature.requireRole || this._roles.includes(feature.requireRole);
  }

  getConfigCapabilityByName(capabilityName) {
    for (const feature of Object.values(FEATURES)) {
      const capability = feature.capabilities.find((cap) => cap.capabilityName === capabilityName);
      if (capability) return { ...capability, requireRole: feature.requireRole };
    }
    return null;
  }

  async setCapabilityValueIfPossible(capabilityName, value) {
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

  registerCapabilityListenerIfPossible(capabilityName, listener) {
    if (this.hasCapability(capabilityName)) {
      this.registerCapabilityListener(capabilityName, listener);
    } else {
      this.log(`Capability ${capabilityName} not found, skipping listener registration`);
    }
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

  async onSettings({ newSettings, changedKeys }) {
    if (!changedKeys.includes('heatingCircuit')) return;
    const selectedCircuit = String(newSettings.heatingCircuit).trim();
    if (selectedCircuit !== 'auto' && !/^\d+$/.test(selectedCircuit)) {
      throw new Error('Enter auto or an enabled heating circuit number');
    }
    const metadata = await this.driver._getEnabledFeaturesAndOpModes(
      this.oAuth2Client, this._installationId, this._gatewaySerial, this._deviceId, selectedCircuit,
    );
    const deviceKey = `${this._installationId}-${this._gatewaySerial}-${this._deviceId}`;
    await this.driver._stopPolling(deviceKey);
    const previous = {
      heatingCircuitId: this._heatingCircuitId,
      features: this._features,
      constraints: this._constraints,
      operatingModes: this._operatingModes,
      commandMetadata: this._commands,
    };
    try {
      await this.applyCircuitMetadata(metadata);
    } catch (error) {
      await this.applyCircuitMetadata(previous);
      throw error;
    } finally {
      await this.driver._startPolling(this, deviceKey);
    }
  }

  async applyCircuitMetadata(metadata) {
    for (const [key, value] of Object.entries(metadata)) await this.setStoreValue(key, value);
    this._heatingCircuitId = metadata.heatingCircuitId;
    this._features = metadata.features;
    this._constraints = metadata.constraints;
    this._operatingModes = metadata.operatingModes;
    this._commands = metadata.commandMetadata;
    this._listeners = [];
    await this.initializeCapabilities();
    await this.updateCapabilityOptions();
    await this.initializeOperatingModes();
    await this.registerCapabilityListeners();
  }

  async onOAuth2Uninit() {
    // Stop polling for this device
    const deviceKey = `${this._installationId}-${this._gatewaySerial}-${this._deviceId}`;
    await this.driver._stopPolling(deviceKey);
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
