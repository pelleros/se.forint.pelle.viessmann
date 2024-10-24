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
    const { installationId, gatewaySerial, deviceId } = this.getData();
    this._installationId = installationId;
    this._gatewaySerial = gatewaySerial;
    this._deviceId = deviceId;

    // this.log('ViessmannDevice::onOAuth2Init oAuth2Client:', this.oAuth2Client);

    // Register Capabilities
    this.registerCapabilityListener(CAPABILITIES.HOT_WATER_TARGET_TEMP.capabilityName, async (value) => {
      if (process.env.DEBUG) {
        this.log('target_temperature.hotWater:', value);
      }
      await this.setDhwTemp(value);
    });
    this.registerCapabilityListener(CAPABILITIES.HEATING_TARGET_TEMP.capabilityName, async (value) => {
      if (process.env.DEBUG) {
        this.log('target_temperature.heating:', value);
      }
      await this.setHeatingTemp(value);
    });
    this.registerCapabilityListener(CAPABILITIES.HEATING_MODE.capabilityName, async (value) => {
      if (process.env.DEBUG) {
        this.log('thermostat_mode.heating:', value);
      }
      await this.setMainOperatingMode(value);
    });
    this.registerCapabilityListener(CAPABILITIES.HOT_WATER_ONE_TIME_CHARGE.capabilityName, async (value) => {
      if (process.env.DEBUG) {
        this.log('thermostat_mode.hotWaterOneTimeCharge:', value);
      }
      await this.setDhwOneTimeCharge(value);
    });

    // here we could get the installation specific ids by calling the currently not used function 
    // getInstallationSpecificIds defined below (not fully implemented for all ids).
    // await this.getInstallationSpecificIds(installationId, gatewaySerial, deviceId);

    // start the sync
    this._sync = this._sync.bind(this);
    this._sync();
    this._syncInterval = this.homey.setInterval(this._sync, POLL_INTERVAL);
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
      this.log('[ViessmannDevice::getFeatures] featuresFilter:', featuresFilter);
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
    // check the compressor status set in the capability measure_something_active.compressor
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
          this.setCapabilityValue(CAPABILITIES.HOT_WATER_TEMP_MEASURE.capabilityName, hwTemp.properties.value.value);
        }

        const hwTargetTemp = response.data.find((item) => item.feature === CAPABILITIES.HOT_WATER_TARGET_TEMP.featureName);
        if (hwTargetTemp && hwTargetTemp.isEnabled) {
          this.setCapabilityValue(CAPABILITIES.HOT_WATER_TARGET_TEMP.capabilityName, hwTargetTemp.properties.value.value);
        }

        const heatingTargetTemp = response.data.find((item) => item.feature === CAPABILITIES.HEATING_TARGET_TEMP.featureName);
        if (heatingTargetTemp && heatingTargetTemp.isEnabled) {
          this.setCapabilityValue(CAPABILITIES.HEATING_TARGET_TEMP.capabilityName, heatingTargetTemp.properties.temperature.value);
        }

        const outsideTemp = response.data.find((item) => item.feature === CAPABILITIES.OUTSIDE_TEMP_MEASURE.featureName);
        if (outsideTemp && outsideTemp.isEnabled) {
          this.setCapabilityValue(CAPABILITIES.OUTSIDE_TEMP_MEASURE.capabilityName, outsideTemp.properties.value.value);
        }

        const mainOpMode = response.data.find((item) => item.feature === CAPABILITIES.HEATING_MODE.featureName);
        if (mainOpMode && mainOpMode.isEnabled) {
          this.setCapabilityValue(CAPABILITIES.HEATING_MODE.capabilityName, mainOpMode.properties.value.value);
        }

        const dhwOneTimeCharge = response.data.find((item) => item.feature === CAPABILITIES.HOT_WATER_ONE_TIME_CHARGE.featureName);
        if (dhwOneTimeCharge && dhwOneTimeCharge.isEnabled) {
          this.setCapabilityValue(CAPABILITIES.HOT_WATER_ONE_TIME_CHARGE.capabilityName, dhwOneTimeCharge.properties.active.value ? 'activate' : 'deactivate')
            .catch((err) => {
              this.error(err);
            });
        }

        // compressor status
        const compressorActive = response.data.find((item) => item.feature === CAPABILITIES.COMPRESSOR_ACTIVE_MEASURE.featureName);
        if (compressorActive && compressorActive.isEnabled) {
          if (process.env.DEBUG) {
            this.log('compressorActive.properties.active.value', compressorActive.properties.active.value);
          }
          this.setCapabilityValue(CAPABILITIES.COMPRESSOR_ACTIVE_MEASURE.capabilityName, compressorActive.properties.active.value);
        }

        const compressorStat = response.data.find((item) => item.feature === CAPABILITIES.COMPRESSOR_STARTS_MEASURE.featureName);
        if (compressorStat && compressorStat.isEnabled) {
          this.setCapabilityValue(CAPABILITIES.COMPRESSOR_HOURS_MEASURE.capabilityName, compressorStat.properties.hours.value);
          this.setCapabilityValue(CAPABILITIES.COMPRESSOR_STARTS_MEASURE.capabilityName, compressorStat.properties.starts.value);
        }

        // burner status
        /*
        const burnerActive = response.data.find((item) => item.feature === CAPABILITIES.BURNER_ACTIVE_MEASURE.featureName);
        if (burnerActive && burnerActive.isEnabled) {
          if (process.env.DEBUG) {
            this.log('burnerActive', burnerActive);
          }
          this.setCapabilityValue(CAPABILITIES.BURNER_ACTIVE_MEASURE.capabilityName, (burnerActive.properties.active.value === 1));
        }
        const burnerStat = response.data.find((item) => item.feature === CAPABILITIES.BURNER_HOURS_MEASURE.featureName);
        if (burnerStat && burnerStat.isEnabled) {
          this.setCapabilityValue(CAPABILITIES.BURNER_HOURS_MEASURE.capabilityName, burnerStat.properties.hours.value);
          this.setCapabilityValue(CAPABILITIES.BURNER_STARTS_MEASURE.capabilityName, burnerStat.properties.starts.value);
        }
        const burnerModulation = response.data.find((item) => item.feature === CAPABILITIES.BURNER_MODULATION_MEASURE.featureName);
        if (burnerModulation && burnerModulation.isEnabled) {
          this.setCapabilityValue(CAPABILITIES.BURNER_MODULATION_MEASURE.capabilityName, burnerModulation.properties.value.value);
        }
        */
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
