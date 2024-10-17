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

  static TARGET_TEMP_HOT_WATER = 'heating.dhw.temperature.main';
  static ONE_TIME_CHARGE_HOT_WATER = 'heating.dhw.oneTimeCharge';
  static TEMP_HOT_WATER = 'heating.dhw.sensors.temperature.hotWaterStorage';
  static TEMP_OUTSIDE = 'heating.sensors.temperature.outside';
  static TARGET_TEMP_HEATING = 'heating.circuits.0.operating.programs.normal';
  static MAIN_OPERATING_MODE = 'heating.circuits.0.operating.modes.active';
  static DHW_OPERATING_MODE = 'heating.dhw.operating.modes.active';

  async onInit() {
    this.log('ViessmannDevice::onInit');
    // Register Capabilities
    this.registerCapabilityListener('target_temperature.dhw', async (value) => {
      if (process.env.DEBUG) {
        this.log('target_temperature.dhw:', value);
      }
      await this.setDhwTemp(value);
    });
    this.registerCapabilityListener('target_temperature.heating', async (value) => {
      if (process.env.DEBUG) {
        this.log('target_temperature.heating:', value);
      }
      await this.setHeatingTemp(value);
    });
    super.onInit();
  }

  async onOAuth2Init() {
    const { installationId, gatewaySerial, deviceId } = this.getData();
    this._installationId = installationId;
    this._gatewaySerial = gatewaySerial;
    this._deviceId = deviceId;

    this._sync = this._sync.bind(this);

    this._sync();
    this._syncInterval = setInterval(this._sync, POLL_INTERVAL);
  }

  async onOAuth2Deleted() {
    // clean up
    if (this._syncInterval) {
      clearInterval(this._syncInterval);
      this._syncInterval = null;
    }
  }

  /*
    Debug function to log the current DHW mode
  */
  async logDHWMode() {
    const response = await this.oAuth2Client.getFeature({
      installationId: this._installationId,
      gatewaySerial: this._gatewaySerial,
      deviceId: this._deviceId,
      featureName: ViessmannDevice.DHW_OPERATING_MODE,
    });
    this.log('[ViessmannDevice::logDHWMode] DHW mode:', response.data.properties.value.value);
  }

  /*
    Hot Water methods
  */
  async getHotWaterTemp() {
    return this.oAuth2Client.getHotWaterTemp({
      installationId: this._installationId,
      gatewaySerial: this._gatewaySerial,
      deviceId: this._deviceId,
    });
  }

  async setDhwTemp(value) {
    return this.oAuth2Client.setDhwTemp({
      installationId: this._installationId,
      gatewaySerial: this._gatewaySerial,
      deviceId: this._deviceId,
      value,
    });
  }

  async setHeatingTemp(value) {
    return this.oAuth2Client.setHeatingTemp({
      installationId: this._installationId,
      gatewaySerial: this._gatewaySerial,
      deviceId: this._deviceId,
      value,
    });
  }

  async getDhwPower() {
    return this.oAuth2Client.getDhwPower({
      installationId: this._installationId,
      gatewaySerial: this._gatewaySerial,
      deviceId: this._deviceId,
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
    return this.oAuth2Client.getFeatures({
      installationId: this._installationId,
      gatewaySerial: this._gatewaySerial,
      deviceId: this._deviceId,
    });
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

        const hwTemp = response.data.find((item) => item.feature === ViessmannDevice.TEMP_HOT_WATER);
        this.setCapabilityValue('measure_temperature.dhw', hwTemp.properties.value.value);
        
        const hwTargetTemp = response.data.find((item) => item.feature === ViessmannDevice.TARGET_TEMP_HOT_WATER);
        this.setCapabilityValue('target_temperature.dhw', hwTargetTemp.properties.value.value);

        const heatingTargetTemp = response.data.find((item) => item.feature === ViessmannDevice.TARGET_TEMP_HEATING);
        this.setCapabilityValue('target_temperature.heating', heatingTargetTemp.properties.temperature.value);

        const outsideTemp = response.data.find((item) => item.feature === ViessmannDevice.TEMP_OUTSIDE);
        this.setCapabilityValue('measure_temperature.outside', outsideTemp.properties.value.value);
      })
      .catch((err) => {
        this.error(err);
        this.setUnavailable(err);
      });
  }

};
