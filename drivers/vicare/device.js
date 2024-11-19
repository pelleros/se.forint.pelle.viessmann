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
    const capabilities = this.getCapabilities();
    for (const capability of capabilities) {
      const capabilityOptions = getCapabilityOptions(capability);
      await this.setCapabilityOptions(capability, capabilityOptions);
    }
  }

  async initializeOperatingModes() {
    // Not that bad if this fails, we can just use the default operating modes
    try {
      const { capabilityName } = getCapability(PATHS.HEATING_MODE);
      const operatingModesCapOpt = this.getCapabilityOptions(capabilityName);
      const capabilityOperatingModes = operatingModesCapOpt.values;

      for (const opMode of capabilityOperatingModes) {
        if (!this._operatingModes.some((mode) => mode.id === opMode.id)) {
          capabilityOperatingModes.splice(capabilityOperatingModes.indexOf(opMode), 1);
          if (process.env.DEBUG) {
            this.log('[ViessmannDevice::onInit] Removed operating mode:', opMode);
          }
        }
      }

      for (const opMode of this._operatingModes) {
        if (!capabilityOperatingModes.some((mode) => mode.id === opMode.id)) {
          capabilityOperatingModes.push(opMode);
          if (process.env.DEBUG) {
            this.log('[ViessmannDevice::onInit] Added operating mode:', opMode);
          }
        }
      }
      operatingModesCapOpt.values = capabilityOperatingModes;
      await this.setCapabilityOptions(capabilityName, operatingModesCapOpt);
    } catch (err) {
      if (process.env.DEBUG) {
        this.log('Error initializing operating modes:', err);
      }
    }
  }

  async registerCapabilityListeners() {
    // Gå igenom alla features
    for (const path of Object.values(PATHS)) {
      try {
        const capabilities = getAllCapabilities(path);

        for (const capability of capabilities) {
          // Skippa om inget command är definierat eller om lyssnaren redan finns
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

      if (command?.useValueAsCommand) {
        const mappedValue = capability.valueMapping?.[value] || value;
        await this.oAuth2Client.executeCommand({
          installationId: this._installationId,
          gatewaySerial: this._gatewaySerial,
          deviceId: this._deviceId,
          feature: path,
          command: mappedValue,
          body: {},
        });
      } else {
        const parameters = {};
        for (const [, apiParam] of Object.entries(command.parameterMapping)) {
          parameters[apiParam] = value;
        }

        await this.oAuth2Client.executeCommand({
          installationId: this._installationId,
          gatewaySerial: this._gatewaySerial,
          deviceId: this._deviceId,
          feature: path,
          command: command.name,
          body: parameters,
        });
      }
    } catch (error) {
      this.log('Error executing command:', error);
      // throw error with message
      throw new Error('Error executing command', error);
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
      this.setStoreValue('installationId', installationId);
      this.setStoreValue('gatewaySerial', gatewaySerial);
      this.setStoreValue('deviceId', deviceId);
      if (!roles) {
        // 1.0.2 => 1.0.4
        this.setStoreValue('roles', ['type:heating', 'type:heatpump', 'type:dhw']);
        this.setStoreValue('operatingModes', [
          { id: 'dhw', title: { en: 'Hot water' } },
          { id: 'dhwAndHeating', title: { en: 'Hot water and Heating' } },
          { id: 'standby', title: { en: 'Standby' } },
        ]);
      } else {
        // 1.0.3 => 1.0.4
        this.setStoreValue('roles', roles);
        this.setStoreValue('operatingModes', operatingModes);
      }
    }
    // started to store version in 1.0.9
    if (this.storeVersionBefore('1.0.9')) {
      this.log('Upgrading to 1.0.9');
      // add features and operating modes
      const installationId = this.getStoreValue('installationId');
      const gatewaySerial = this.getStoreValue('gatewaySerial');
      const deviceId = this.getStoreValue('deviceId');
      const { features, constraints, operatingModes } = await this.driver._getEnabledFeaturesAndOpModes(this.oAuth2Client, installationId, gatewaySerial, deviceId);
      if (process.env.DEBUG) {
        this.log('Features:', features);
        this.log('Constraints:', constraints);
        this.log('Operating modes:', operatingModes);
      }
      this.setStoreValue('features', features);
      this.setStoreValue('constraints', constraints);
      this.setStoreValue('operatingModes', operatingModes);
      await this.updateCapabilityOptions();
      this.setStoreValue('version', '1.0.9');
    }
  }

  async onFeaturesUpdated(response, extendedResponse) {
    try {
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
          this.setStore('features', this._features);
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

        // Jämför med originalvärdet innan value mapping
        const currentValue = this.getCapabilityValue(capabilityName);
        if (currentValue !== value) {
          // Applicera value mapping efter jämförelsen
          let processedValue = value;
          if (capability.valueMapping && value in capability.valueMapping) {
            processedValue = capability.valueMapping[value];
          }

          await this.setCapabilityValue(capabilityName, processedValue);

          // Använd _triggerCards för att trigga flow card
          try {
            const triggerCard = this.driver.getTriggerCard(capabilityName);
            if (triggerCard) {
              await triggerCard.trigger(this, { mode: value }, {});
            }
          } catch (error) {
            // Ignorera om inget trigger card finns
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

  async getFeatures(useFilter) {
    // Use PATHS directly for feature filtering
    const featuresFilter = useFilter ? Object.values(PATHS).join(',') : undefined;

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

  async onOAuth2Uninit() {
    // Stop polling for this device
    const deviceKey = `${this._installationId}-${this._gatewaySerial}-${this._deviceId}`;
    this.driver._stopPolling(deviceKey);
  }

  // Method to handle dynamic feature paths based on installation
  /* // Method not used, we probably want to handle the ids in a different way (have it as a device setting)
  updateFeaturePaths(compressorId, heatingCircuitsId, burnerId) {
    // Instead of modifying FEATURES directly, we create installation-specific paths
    this._installationPaths = {
      ...PATHS,
      COMPRESSOR: `heating.compressors.${compressorId}`,
      COMPRESSOR_STATS: `heating.compressors.${compressorId}.statistics`,
      BURNER: `heating.burners.${burnerId}`,
      BURNER_STATS: `heating.burners.${burnerId}.statistics`,
      BURNER_MODULATION: `heating.burners.${burnerId}.modulation`,
      HEATING_MODE: `heating.circuits.${heatingCircuitsId}.operating.modes.active`,
      HEATING_TARGET: `heating.circuits.${heatingCircuitsId}.operating.programs.normal`,
    };
  }
  */

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
