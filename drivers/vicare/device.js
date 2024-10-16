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

  static TEMP_HOT_WATER = 'heating.dhw.sensors.temperature.hotWaterStorage';
  static TEMP_OUTSIDE = 'heating.sensors.temperature.outside';
  static POWER_CONSUMPTION_HEATING = 'heating.power.consumption.heating';
  static POWER_CONSUMPTION_DHW = 'heating.power.consumption.dhw';

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
    Hot Water methods
  */
  async getHotWaterTemp() {
    return this.oAuth2Client.getHotWaterTemp({
      installationId: this._installationId,
      gatewaySerial: this._gatewaySerial,
      deviceId: this._deviceId,
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
    this.getFeatures()
      .then((response) => {
        this.setAvailable();

        if (process.env.DEBUG) {
          // write response to log
          this.log('device._sync::res:', JSON.stringify(response, null, 3));
        }

        const hwTemp = response.data.find((item) => item.feature === ViessmannDevice.TEMP_HOT_WATER);
        this.setCapabilityValue('measure_temperature.hotwater', hwTemp.properties.value.value);

        const outsideTemp = response.data.find((item) => item.feature === ViessmannDevice.TEMP_OUTSIDE);
        this.setCapabilityValue('measure_temperature.outside', outsideTemp.properties.value.value);
      })
      .catch((err) => {
        this.error(err);
        this.setUnavailable(err);
      });
  }

};
