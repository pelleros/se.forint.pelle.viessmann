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

const { OAuth2Driver } = require('homey-oauth2app');

module.exports = class ViessmannDriver extends OAuth2Driver {

  async onOAuth2Init() {
    if (process.env.DEBUG) {
      this.log('onOAuth2Init');
    }
    // Register Flow Cards etc.
  }

  async onPairListDevices({ oAuth2Client }) {
    if (process.env.DEBUG) {
      this.log('onPairListDevices');
    }
    const installations = await oAuth2Client.getInstallations();
    const gateways = await oAuth2Client.getGatewaySerial();
    if (process.env.DEBUG) {
      this.log('gatewaySerial:', gateways.data[0].serial);
    }
    const devices = await oAuth2Client.getDeviceId({ installationId: installations.data[0].id, gatewaySerial: gateways.data[0].serial });
    if (process.env.DEBUG) {
      //this.log('onPairListDevices::installations:', JSON.stringify(devices, null, 3));
      this.log('deviceId', devices.data[0].id);
    }
    return [{
      name: 'Viessmann',
      data: {
        installationId: installations.data[0].id,
        gatewaySerial: gateways.data[0].serial,
        deviceId: devices.data[0].id,
      },
    }];
  }

};
