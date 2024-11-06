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
const { CAPABILITIES } = require('./config');

const POLL_INTERVAL = 1000 * 60 * 2; // 2 min

module.exports = class ViessmannDevice extends OAuth2Device {

  static CAPABILITIES = CAPABILITIES;

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

  async onInit() {
    await super.onInit();
    if (process.env.DEBUG) {
      this.log('[ViessmannDevice::onInit] called');
    }
    // check that only the capabilities as defined in config.js has been added to the device
    for (const previouslyAddedCap of this.getCapabilities()) {
      // cap is the capabilityName of the capability, use this to get the capability object from CAPABILITIES
      const configCapObj = this.getConfigCapabilityByName(previouslyAddedCap);
      if (!configCapObj
        || (!this.hasRequiredRole(configCapObj))) { // also check if requireRole is set and if the role is not in the roles array
        if (this.hasCapability(previouslyAddedCap)) {
          try {
            await this.removeCapability(previouslyAddedCap);
            if (process.env.DEBUG) {
              this.log('[ViessmannDevice::onInit] removed cap:', previouslyAddedCap);
            }
          } catch (err) {
            this.log('Error removing capability:', err);
          }
        }
      }
    }

    // check all capabilities as defined in config.js and check if added to the device
    for (const capInConfig of Object.values(CAPABILITIES)) {
      if (!this.hasCapability(capInConfig.capabilityName)) {
        // also check if cap.requireRole is set and if the role is not in the roles array
        if (capInConfig?.requireRole && !this._roles.some((role) => role.includes(capInConfig.requireRole))) {
          continue;
        }
        if (!this.hasCapability(capInConfig.capabilityName)) {
          try {
            await this.addCapability(capInConfig.capabilityName);
            if (process.env.DEBUG) {
              this.log('[ViessmannDevice::onInit] added cap:', capInConfig);
            }
          } catch (err) {
            this.log('Error adding capability:', err);
          }
        }
      }
    }

    // clean up operating modes 
    // operating modes
    const operatingModesCapOpt = this.getCapabilityOptions(CAPABILITIES.HEATING_MODE.capabilityName);
    const capabilityOperatingModes = operatingModesCapOpt.values;
    // make sure all operatingModes in this._operatingModes 
    // if not remove the property from the array
    // also check if all properties of this._operatingModes (again id as key) are in operatingModes and add them if not
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
    await this.setCapabilityOptions(CAPABILITIES.HEATING_MODE.capabilityName, operatingModesCapOpt);

    // Register Capability Listeners
    this.registerCapabilityListenerIfPossible(CAPABILITIES.HOT_WATER_TARGET_TEMP.capabilityName, async (value) => {
      if (process.env.DEBUG) {
        this.log('target_temperature.hotWater:', value);
      }
      await this.setDhwTemp(value);
    });
    this.registerCapabilityListenerIfPossible(CAPABILITIES.HEATING_TARGET_TEMP.capabilityName, async (value) => {
      if (process.env.DEBUG) {
        this.log('target_temperature.heating:', value);
      }
      await this.setHeatingTemp(value);
    });
    this.registerCapabilityListenerIfPossible(CAPABILITIES.HEATING_MODE.capabilityName, async (value) => {
      if (process.env.DEBUG) {
        this.log('thermostat_mode.heating:', value);
      }
      await this.setMainOperatingMode(value);
    });
    this.registerCapabilityListenerIfPossible(CAPABILITIES.HOT_WATER_ONE_TIME_CHARGE.capabilityName, async (value) => {
      if (process.env.DEBUG) {
        this.log('thermostat_mode.hotWaterOneTimeCharge:', value);
      }
      await this.setDhwOneTimeCharge(value);
    });

    // TODO: here we could get the installation specific ids by calling the currently not used function 
    // getInstallationSpecificIds defined below (not fully implemented for all ids).
    // await this.getInstallationSpecificIds(installationId, gatewaySerial, deviceId);

    // start the _sync at POLL_INTERVAL
    this._sync = this._sync.bind(this);
    this._syncInterval = this.homey.setInterval(() => this._sync(), POLL_INTERVAL);
    this._sync();
  }

  hasRequiredRole(configCapObj) {
    return !configCapObj.requireRole || this._roles.some((role) => role.includes(configCapObj.requireRole));
  }

  getConfigCapabilityByName(cap) {
    return Object.values(CAPABILITIES).find((c) => c.capabilityName === cap);
  }

  setCapabilityValueIfPossible(capabilityName, value) {
    if (this.hasCapability(capabilityName)) {
      this.setCapabilityValue(capabilityName, value);
    }
  }

  registerCapabilityListenerIfPossible(capabilityName, listener) {
    if (this.hasCapability(capabilityName)) {
      this.registerCapabilityListener(capabilityName, listener);
    }
  }

  /*
    Set the hot water temperature
  */
  async setDhwTemp(value) {
    return this.oAuth2Client.setDhwTemp({
      installationId: this._installationId,
      gatewaySerial: this._gatewaySerial,
      deviceId: this._deviceId,
      value,
    });
  }

  /*
    Set the main/normal heating temperature
  */
  async setHeatingTemp(value) {
    return this.oAuth2Client.setHeatingTemp({
      installationId: this._installationId,
      gatewaySerial: this._gatewaySerial,
      deviceId: this._deviceId,
      value,
    });
  }

  /*
    Set the operating mode of the heating system
  */
  async setMainOperatingMode(value) {
    return this.oAuth2Client.setMainOperatingMode({
      installationId: this._installationId,
      gatewaySerial: this._gatewaySerial,
      deviceId: this._deviceId,
      value,
    });
  }

  /*
    Set the operating mode of the heating system
  */
  async setDhwOneTimeCharge(value) {
    return this.oAuth2Client.setDhwOneTimeCharge({
      installationId: this._installationId,
      gatewaySerial: this._gatewaySerial,
      deviceId: this._deviceId,
      value,
    });
  }

  async getGatewayFeatures() {
    return this.oAuth2Client.getGatewayFeatures({
      installationId: this._installationId,
      gatewaySerial: this._gatewaySerial,
      deviceId: this._deviceId,
    });
  }

  async getFeatures() {
    const featuresFilter = Object.values(CAPABILITIES).map((cap) => cap.featureName).join(',');
    if (process.env.DEBUG) {
      // this.log('[ViessmannDevice::getFeatures] featuresFilter:', featuresFilter);
    }
    const response = await this.oAuth2Client.getFeatures({
      installationId: this._installationId,
      gatewaySerial: this._gatewaySerial,
      deviceId: this._deviceId,
      filter: featuresFilter,
    });
    if (process.env.DEBUG) {
      // this.log('[ViessmannDevice::getFeatures] response:', JSON.stringify(response, null, 3));
    }
    return response;
  }

  /*
    Get the compressor status
  */
  async isCompressorRunning() {
    // check the compressor status set in the capability
    // keep down nof calls to the viessmann api
    return this.getCapabilityValue(CAPABILITIES.COMPRESSOR_ACTIVE_MEASURE.capabilityName);
  }

  _sync() {
    if (process.env.DEBUG) {
      this.log('ViessmannDevice::_sync called');
    }

    this.getFeatures()
      .then((response) => {
        this.setAvailable();

        if (process.env.DEBUG) {
          // write response to log
          // this.log('device._sync::res:', JSON.stringify(response, null, 3));
        }

        const hwTemp = response.data.find((item) => item.feature === CAPABILITIES.HOT_WATER_TEMP_MEASURE.featureName);
        if (hwTemp && hwTemp.isEnabled) {
          this.setCapabilityValueIfPossible(CAPABILITIES.HOT_WATER_TEMP_MEASURE.capabilityName, hwTemp.properties.value.value);
        }

        const hwTargetTemp = response.data.find((item) => item.feature === CAPABILITIES.HOT_WATER_TARGET_TEMP.featureName);
        if (hwTargetTemp && hwTargetTemp.isEnabled) {
          this.setCapabilityValueIfPossible(CAPABILITIES.HOT_WATER_TARGET_TEMP.capabilityName, hwTargetTemp.properties.value.value);
        }

        const heatingTargetTemp = response.data.find((item) => item.feature === CAPABILITIES.HEATING_TARGET_TEMP.featureName);
        if (heatingTargetTemp && heatingTargetTemp.isEnabled) {
          this.setCapabilityValueIfPossible(CAPABILITIES.HEATING_TARGET_TEMP.capabilityName, heatingTargetTemp.properties.temperature.value);
        }

        const outsideTemp = response.data.find((item) => item.feature === CAPABILITIES.OUTSIDE_TEMP_MEASURE.featureName);
        if (outsideTemp && outsideTemp.isEnabled) {
          this.setCapabilityValueIfPossible(CAPABILITIES.OUTSIDE_TEMP_MEASURE.capabilityName, outsideTemp.properties.value.value);
        }

        const mainOpMode = response.data.find((item) => item.feature === CAPABILITIES.HEATING_MODE.featureName);
        if (mainOpMode && mainOpMode.isEnabled) {
          this.setCapabilityValueIfPossible(CAPABILITIES.HEATING_MODE.capabilityName, mainOpMode.properties.value.value);
        }

        const dhwOneTimeCharge = response.data.find((item) => item.feature === CAPABILITIES.HOT_WATER_ONE_TIME_CHARGE.featureName);
        if (dhwOneTimeCharge && dhwOneTimeCharge.isEnabled) {
          this.setCapabilityValueIfPossible(CAPABILITIES.HOT_WATER_ONE_TIME_CHARGE.capabilityName, dhwOneTimeCharge.properties.active.value ? 'activate' : 'deactivate');
        }

        // compressor status
        const compressorActive = response.data.find((item) => item.feature === CAPABILITIES.COMPRESSOR_ACTIVE_MEASURE.featureName);
        if (compressorActive && compressorActive.isEnabled) {
          this.setCapabilityValueIfPossible(CAPABILITIES.COMPRESSOR_ACTIVE_MEASURE.capabilityName, compressorActive.properties.active.value);
        }

        const compressorStat = response.data.find((item) => item.feature === CAPABILITIES.COMPRESSOR_STARTS_MEASURE.featureName);
        if (compressorStat && compressorStat.isEnabled) {
          this.setCapabilityValueIfPossible(CAPABILITIES.COMPRESSOR_HOURS_MEASURE.capabilityName, compressorStat.properties.hours.value);
          this.setCapabilityValueIfPossible(CAPABILITIES.COMPRESSOR_STARTS_MEASURE.capabilityName, compressorStat.properties.starts.value);
        }

        // burner status
        const burnerActive = response.data.find((item) => item.feature === CAPABILITIES.BURNER_ACTIVE_MEASURE.featureName);
        if (burnerActive && burnerActive.isEnabled) {
          if (process.env.DEBUG) {
            this.log('burnerActive', burnerActive);
          }
          this.setCapabilityValueIfPossible(CAPABILITIES.BURNER_ACTIVE_MEASURE.capabilityName, (burnerActive.properties.active.value === 1));
        }
        const burnerStat = response.data.find((item) => item.feature === CAPABILITIES.BURNER_HOURS_MEASURE.featureName);
        if (burnerStat && burnerStat.isEnabled) {
          this.setCapabilityValueIfPossible(CAPABILITIES.BURNER_HOURS_MEASURE.capabilityName, burnerStat.properties.hours.value);
          this.setCapabilityValueIfPossible(CAPABILITIES.BURNER_STARTS_MEASURE.capabilityName, burnerStat.properties.starts.value);
        }
        const burnerModulation = response.data.find((item) => item.feature === CAPABILITIES.BURNER_MODULATION_MEASURE.featureName);
        if (burnerModulation && burnerModulation.isEnabled) {
          this.setCapabilityValueIfPossible(CAPABILITIES.BURNER_MODULATION_MEASURE.capabilityName, burnerModulation.properties.value.value);
        }
      })
      .catch((err) => {
        this.error(err);
        this.setUnavailable(err);
      });
  }

  /*
   * Get heating id, compressor id, burner id
   * currently only taking the first id of each type 
   * (could be multiple in the returned array).
   * // currently not used as not fully implemented for all ids (ex burners).
  async getInstallationSpecificIds(installationId, gatewaySerial, deviceId) {
    try {
      const compressorResponse = await this.oAuth2Client.getFeature({
        installationId, gatewaySerial, deviceId, featureName: 'heating.compressors',
      });
      this._compressorId = compressorResponse.data.properties.enabled.value[0];
    } catch (err) {
      this.log('Error getting compressors:', err);
    }
    // Use compressorId in feature strings
    // Compressorid could be 'undefined' if no compressor was found. This is ok since
    // in sync method the featureName will simply not be found and no value will be set.   
    CAPABILITIES.COMPRESSOR_ACTIVE_MEASURE.featureName = `heating.compressors.${this._compressorId}`;
    CAPABILITIES.COMPRESSOR_STARTS_MEASURE.featureName = `heating.compressors.${this._compressorId}.statistics`;
    CAPABILITIES.COMPRESSOR_HOURS_MEASURE.featureName = `heating.compressors.${this._compressorId}.statistics`;

    try {
      const heatingCircuitsResponse = await this.oAuth2Client.getFeature({
        installationId, gatewaySerial, deviceId, featureName: 'heating.circuits',
      });
      this._heatingCircuitsId = heatingCircuitsResponse.data.properties.enabled.value[0];
    } catch (err) {
      this.log('Error getting heating circuits:', err);
    }
    // Use heatingCircuitsId in feature strings
    // heatingCircuitsId could be 'undefined' if no heating circuit was found. This is ok since
    // in sync method the featureName will simply not be found and no value will be set.
    CAPABILITIES.HEATING_TARGET_TEMP.featureName = `heating.circuits.${this._heatingCircuitsId}.operating.programs.normal`;
    CAPABILITIES.HEATING_MODE.featureName = `heating.circuits.${this._heatingCircuitsId}.operating.modes.active`;

    // Get heating id and compressor id
    // currently only taking the first heating circuit and the first compressor 
    // (could be multiple in the returned array).
    try {
      const compressorResponse = await this.oAuth2Client.getFeature({
        installationId, gatewaySerial, deviceId, featureName: 'heating.compressors',
      });
      this._compressorId = compressorResponse.data.properties.enabled.value[0];
    } catch (err) {
      this.log('Error getting compressors:', err);
    }
    // Use compressorId in feature strings
    // Compressorid could be 'undefined' if no compressor was found. This is ok since
    // in sync method the featureName will simply not be found and no value will be set.   
    CAPABILITIES.COMPRESSOR_ACTIVE_MEASURE.featureName = `heating.compressors.${this._compressorId}`;
    CAPABILITIES.COMPRESSOR_STARTS_MEASURE.featureName = `heating.compressors.${this._compressorId}.statistics`;
    CAPABILITIES.COMPRESSOR_HOURS_MEASURE.featureName = `heating.compressors.${this._compressorId}.statistics`;
  }
  */

};
