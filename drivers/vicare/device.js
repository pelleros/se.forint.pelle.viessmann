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

const POLL_INTERVAL = 1000 * 60 * 2; // 2 min

module.exports = class ViessmannDevice extends OAuth2Device {

  static FEATURES = {
    TARGET_TEMP_HOT_WATER: 'heating.dhw.temperature.main',
    ONE_TIME_CHARGE_HOT_WATER: 'heating.dhw.oneTimeCharge',
    TEMP_HOT_WATER: 'heating.dhw.sensors.temperature.hotWaterStorage',
    TEMP_OUTSIDE: 'heating.sensors.temperature.outside',
  }

  async onInit() {
    this.log('ViessmannDevice::onInit');
    // Register Capabilities
    this.registerCapabilityListener('target_temperature.hotWater', async (value) => {
      if (process.env.DEBUG) {
        this.log('target_temperature.hotWater:', value);
      }
      await this.setDhwTemp(value);
    });
    this.registerCapabilityListener('target_temperature.heating', async (value) => {
      if (process.env.DEBUG) {
        this.log('target_temperature.heating:', value);
      }
      await this.setHeatingTemp(value);
    });
    this.registerCapabilityListener('thermostat_mode.heating', async (value) => {
      if (process.env.DEBUG) {
        this.log('thermostat_mode.heating:', value);
      }
      await this.setMainOperatingMode(value);
    });
    this.registerCapabilityListener('thermostat_mode.hotWaterOneTimeCharge', async (value) => {
      if (process.env.DEBUG) {
        this.log('thermostat_mode.hotWaterOneTimeCharge:', value);
      }
      await this.setDhwOneTimeCharge(value);
    });
    super.onInit();
  }

  async onOAuth2Init() {
    const { installationId, gatewaySerial, deviceId } = this.getData();
    this._installationId = installationId;
    this._gatewaySerial = gatewaySerial;
    this._deviceId = deviceId;

    // Get heating id and compressor id
    // currently only taking the first heating circuit and the first compressor 
    // (could be multiple in the returned array).
    const compressorResponse = await this.oAuth2Client.getFeature({
      installationId, gatewaySerial, deviceId, featureName: 'heating.compressors',
    });
    this._compressorId = compressorResponse.data.properties.enabled.value[0];

    // Use compressorId in static strings
    ViessmannDevice.FEATURES.COMPRESSOR_ACTIVE = `heating.compressors.${this._compressorId}`;
    ViessmannDevice.FEATURES.COMPRESSOR_STATISTICS = `heating.compressors.${this._compressorId}.statistics`;

    const heatingCircuitsResponse = await this.oAuth2Client.getFeature({
      installationId, gatewaySerial, deviceId, featureName: 'heating.circuits',
    });
    this._heatingCircuitsId = heatingCircuitsResponse.data.properties.enabled.value[0];

    // Use heatingCircuitsId in static strings
    ViessmannDevice.FEATURES.TARGET_TEMP_HEATING = `heating.circuits.${this._heatingCircuitsId}.operating.programs.normal`;
    ViessmannDevice.FEATURES.MAIN_OPERATING_MODE = `heating.circuits.${this._heatingCircuitsId}.operating.modes.active`;

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
      heatingCircuitsId: this._heatingCircuitsId,
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
      heatingCircuitsId: this._heatingCircuitsId,
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
    const featuresFilter = Object.values(ViessmannDevice.FEATURES).join(',');
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
    return this.getCapabilityValue('measure_something_active.compressor');
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

        const hwTemp = response.data.find((item) => item.feature === ViessmannDevice.FEATURES.TEMP_HOT_WATER);
        if (hwTemp) {
          this.setCapabilityValue('measure_temperature.hotWater', hwTemp.properties.value.value);
        }

        const hwTargetTemp = response.data.find((item) => item.feature === ViessmannDevice.FEATURES.TARGET_TEMP_HOT_WATER);
        if (hwTargetTemp) {
          this.setCapabilityValue('target_temperature.hotWater', hwTargetTemp.properties.value.value);
        }

        const heatingTargetTemp = response.data.find((item) => item.feature === ViessmannDevice.FEATURES.TARGET_TEMP_HEATING);
        if (heatingTargetTemp) {
          this.setCapabilityValue('target_temperature.heating', heatingTargetTemp.properties.temperature.value);
        }

        const outsideTemp = response.data.find((item) => item.feature === ViessmannDevice.FEATURES.TEMP_OUTSIDE);
        if (outsideTemp) {
          this.setCapabilityValue('measure_temperature.outside', outsideTemp.properties.value.value);
        }

        const mainOpMode = response.data.find((item) => item.feature === ViessmannDevice.FEATURES.MAIN_OPERATING_MODE);
        if (mainOpMode) {
          this.setCapabilityValue('thermostat_mode.heating', mainOpMode.properties.value.value);
        }

        const dhwOneTimeCharge = response.data.find((item) => item.feature === ViessmannDevice.FEATURES.ONE_TIME_CHARGE_HOT_WATER);
        if (dhwOneTimeCharge) {
          this.setCapabilityValue('thermostat_mode.hotWaterOneTimeCharge', dhwOneTimeCharge.properties.active.value ? 'activate' : 'deactivate')
            .catch((err) => {
              this.error(err);
            });
        }

        const compressorActive = response.data.find((item) => item.feature === ViessmannDevice.FEATURES.COMPRESSOR_ACTIVE);
        if (compressorActive) {
          if (process.env.DEBUG) {
            this.log('compressorActive.properties.active.value', compressorActive.properties.active.value);
          }
          this.setCapabilityValue('measure_something_active.compressor', compressorActive.properties.active.value);
        }

        const compressorStat = response.data.find((item) => item.feature === ViessmannDevice.FEATURES.COMPRESSOR_STATISTICS);
        if (compressorStat) {
          this.setCapabilityValue('measure_something_number.compressorHours', compressorStat.properties.hours.value);
          this.setCapabilityValue('measure_something_number.compressorStarts', compressorStat.properties.starts.value);
        }
      })
      .catch((err) => {
        this.error(err);
        this.setUnavailable(err);
      });
  }

};
