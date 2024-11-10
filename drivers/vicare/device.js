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
  FEATURES, PATHS, getCapability, getAllCapabilities,
} = require('./config');

module.exports = class ViessmannDevice extends OAuth2Device {

  static FEATURES = FEATURES;
  static PATHS = PATHS;

  async onOAuth2Init() {
    this.checkUpgradeSpecifics();
    this._installationId = this.getStoreValue('installationId');
    this._gatewaySerial = this.getStoreValue('gatewaySerial');
    this._deviceId = this.getStoreValue('deviceId');
    this._roles = this.getStoreValue('roles');
    this._operatingModes = this.getStoreValue('operatingModes');

    if (process.env.DEBUG) {
      this.log(
        'ViessmannDevice::onOAuth2Init installationId:', this._installationId,
        'gatewaySerial:', this._gatewaySerial,
        'deviceId:', this._deviceId,
        'roles:', this._roles,
        'operatingModes:', this._operatingModes,
      );
    }

    await this.initializeCapabilities();
    await this.initializeOperatingModes();
    await this.registerCapabilityListeners();

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
            shouldKeep = true;
            break;
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

    // Add configured capabilities if device has required role
    for (const path of Object.values(PATHS)) {
      if (!this.hasRequiredRole(path)) continue;

      try {
        const capabilities = getAllCapabilities(path);
        for (const capability of capabilities) {
          if (!this.hasCapability(capability.capabilityName)) {
            await this.addCapability(capability.capabilityName);
            this.log(`Added capability: ${capability.capabilityName}`);
          }
        }
      } catch (err) {
        this.error(`Error handling capability for ${path}:`, err);
      }
    }
  }

  async initializeOperatingModes() {
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
  }

  async registerCapabilityListeners() {
    this.registerCapabilityListenerIfPossible(
      getCapability(PATHS.HOT_WATER_TARGET).capabilityName,
      async (value) => {
        if (process.env.DEBUG) {
          this.log('target_temperature.hotWater:', value);
        }
        await this.setDhwTemp(value);
      },
    );

    this.registerCapabilityListenerIfPossible(
      getCapability(PATHS.HEATING_TARGET).capabilityName,
      async (value) => {
        if (process.env.DEBUG) {
          this.log('target_temperature.heating:', value);
        }
        await this.setHeatingTemp(value);
      },
    );

    this.registerCapabilityListenerIfPossible(
      getCapability(PATHS.HEATING_MODE).capabilityName,
      async (value) => {
        if (process.env.DEBUG) {
          this.log('thermostat_mode.heating:', value);
        }
        await this.setMainOperatingMode(value);

        // Trigger flow card with device and token
        try {
          const tokens = { mode: value };
          const state = {};
          await this.driver._heatingModeChangedTrigger.trigger(this, tokens, state);
          this.log('Flow card triggered with mode:', value);
        } catch (error) {
          this.error('Failed to trigger flow card:', error);
        }
      },
    );

    this.registerCapabilityListenerIfPossible(
      getCapability(PATHS.HOT_WATER_CHARGE).capabilityName,
      async (value) => {
        if (process.env.DEBUG) {
          this.log('thermostat_mode.hotWaterOneTimeCharge:', value);
        }
        await this.setDhwOneTimeCharge(value);
      },
    );

    this.onFeaturesUpdated = this.onFeaturesUpdated.bind(this);
  }

  checkUpgradeSpecifics() {
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
  }

  async onFeaturesUpdated(response) {
    try {
      if (process.env.DEBUG) {
        this.log('Starting feature update processing...');
      }

      for (const feature of response.data) {
        if (!feature.isEnabled || !feature.properties) {
          if (process.env.DEBUG) {
            this.log(`Skipping disabled/empty feature: ${feature.feature}`);
          }
          continue;
        }

        const featureConfig = FEATURES[feature.feature];
        if (!featureConfig) {
          if (process.env.DEBUG) {
            this.log(`Skipping unknown feature: ${feature.feature}`);
          }
          continue;
        }

        // Check if device has required role for this feature
        if (featureConfig.requireRole && !this._roles.includes(featureConfig.requireRole)) {
          if (process.env.DEBUG) {
            this.log(`Skipping feature due to missing role: ${feature.feature}, required role: ${featureConfig.requireRole}`);
          }
          continue;
        }

        if (process.env.DEBUG) {
          this.log(`Processing feature: ${feature.feature}`);
        }

        // Helper function to safely get nested property values
        const getValue = (obj, path) => {
          return path.split('.').reduce((acc, part) => acc && acc[part], obj);
        };

        // Update all capabilities associated with this feature
        for (const capability of featureConfig.capabilities) {
          const value = getValue(feature.properties, capability.propertyPath);
          if (value !== undefined) {
            if (process.env.DEBUG) {
              this.log(`Setting capability: ${capability.capabilityName} = ${value} (from ${capability.propertyPath})`);
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

        // Apply value mapping if defined
        let processedValue = value;
        if (capability.valueMapping && value in capability.valueMapping) {
          processedValue = capability.valueMapping[value];
        }

        await this.setCapabilityValue(capabilityName, processedValue);
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

  /*
    Set the hot water temperature
  */
  async setDhwTemp(value) {
    await this.oAuth2Client.setDhwTemp({
      installationId: this._installationId,
      gatewaySerial: this._gatewaySerial,
      deviceId: this._deviceId,
      value,
    });

    // Uppdatera capability
    const { capabilityName } = getCapability(PATHS.HOT_WATER_TARGET);
    await this.setCapabilityValue(capabilityName, value);
    return true;
  }

  /*
    Set the main/normal heating temperature
  */
  async setHeatingTemp(value) {
    await this.oAuth2Client.setHeatingTemp({
      installationId: this._installationId,
      gatewaySerial: this._gatewaySerial,
      deviceId: this._deviceId,
      value,
    });

    // Uppdatera capability
    const { capabilityName } = getCapability(PATHS.HEATING_TARGET);
    await this.setCapabilityValue(capabilityName, value);
    return true;
  }

  /*
    Set the operating mode of the heating system
  */
  async setMainOperatingMode(value) {
    await this.oAuth2Client.setMainOperatingMode({
      installationId: this._installationId,
      gatewaySerial: this._gatewaySerial,
      deviceId: this._deviceId,
      value,
    });

    // Uppdatera capability
    const { capabilityName } = getCapability(PATHS.HEATING_MODE);
    await this.setCapabilityValue(capabilityName, value);
    return true;
  }

  /*
    Set the operating mode of the heating system
  */
  async setDhwOneTimeCharge(value) {
    await this.oAuth2Client.setDhwOneTimeCharge({
      installationId: this._installationId,
      gatewaySerial: this._gatewaySerial,
      deviceId: this._deviceId,
      value,
    });

    // Uppdatera capability
    const { capabilityName } = getCapability(PATHS.HOT_WATER_CHARGE);
    await this.setCapabilityValue(capabilityName, value);
    return true;
  }

  async getGatewayFeatures() {
    return this.oAuth2Client.getGatewayFeatures({
      installationId: this._installationId,
      gatewaySerial: this._gatewaySerial,
      deviceId: this._deviceId,
    });
  }

  async getFeatures() {
    // Use PATHS directly for feature filtering
    const featuresFilter = Object.values(PATHS).join(',');

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

  async startDhwOneTimeCharge() {
    return this.setDhwOneTimeCharge(true);
  }

  async stopDhwOneTimeCharge() {
    return this.setDhwOneTimeCharge(false);
  }

};
