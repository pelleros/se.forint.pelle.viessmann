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
    const hotWaterCard = this.homey.flow.getActionCard('set-hot-water-thermostat');
    hotWaterCard.registerRunListener(async (args) => {
      const { temperature } = args;
      await args.device.setDhwTemp(temperature);
    });
    const heaterThermostatCard = this.homey.flow.getActionCard('set-heating-thermostat');
    heaterThermostatCard.registerRunListener(async (args) => {
      const { temperature } = args;
      await args.device.setHeatingTemp(temperature);
    });
    const hotWaterOneTimeChargeCard = this.homey.flow.getActionCard('do-one-time-hot-water-charge');
    hotWaterOneTimeChargeCard.registerRunListener(async (args) => {
      await args.device.setDhwOneTimeCharge(args.active);
    });
    const operatingModeCard = this.homey.flow.getActionCard('set-operating-mode');
    operatingModeCard.registerRunListener(async (args) => {
      const { mode } = args;
      if (process.env.DEBUG) {
        this.log('set-operating-mode:', mode);
      }
      await args.device.setMainOperatingMode(mode);
    });
    const compressorRunningConditionCard = this.homey.flow.getConditionCard('compressor-is-running');
    compressorRunningConditionCard.registerRunListener(async (args) => {
      return args.device.isCompressorRunning();
    });
  }

  async onPairListDevices({ oAuth2Client }) {
    if (process.env.DEBUG) {
      this.log('onPairListDevices');
    }
    const installationId = (await oAuth2Client.getInstallations()).data[0].id;
    const gatewaySerial = (await oAuth2Client.getGateways()).data[0].serial;
    if (process.env.DEBUG) {
      this.log('gatewaySerial:', gatewaySerial);
    }

    const deviceId = (await oAuth2Client.getDevices({ installationId, gatewaySerial })).data[0].id;

    return [{
      name: 'Viessmann',
      data: {
        installationId,
        gatewaySerial,
        deviceId,
      },
    }];
  }

};
