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
const { CAPABILITIES } = require('./config');

module.exports = class ViessmannDriver extends OAuth2Driver {

  static CAPABILITIES = CAPABILITIES;

  async onOAuth2Init() {
    if (process.env.DEBUG) {
      this.log('[ViessmannDriver::onOAuth2Init] called');
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
    const result = await oAuth2Client.getInstallations();
    this.homey.settings.set('installations.json', JSON.stringify(result, null, 3));
    this.log('[ViessmannDriver::onPairListDevices] Installations:', JSON.stringify(result, null, 3));

    // loop result and save the first device with "deviceType": "heating". TODO: Add support for multiple devices
    for (const installation of result.data) {
      for (const gateway of installation.gateways) {
        for (const device of gateway.devices) {
          if (device.deviceType === 'heating') {
            if (process.env.DEBUG) {
              this.log('[ViessmannDriver::onPairListDevices] installationId:', gateway.installationId);
              this.log('[ViessmannDriver::onPairListDevices] gatewaySerial:', gateway.serial);
              this.log('[ViessmannDriver::onPairListDevices] deviceId:', device.id);
            }

            const response = await oAuth2Client.getFeatures({ installationId: gateway.installationId, gatewaySerial: gateway.serial, deviceId: device.id });
            // this.log('[ViessmannDriver::onPairListDevices] Features:', JSON.stringify(response, null, 3));
            // used in the app settings page for troubleshooting
            this.homey.settings.set('features.json', JSON.stringify(response, null, 3));

            const mainOpMode = response.data.find((item) => item.feature === CAPABILITIES.HEATING_MODE.featureName);
            const operatingModes = [];
            try {
              if (mainOpMode && mainOpMode.isEnabled) {
                const formatString = (str) => {
                  return str.replace(/([A-Z])/g, ' $1')
                    .replace(/^./, (char) => char.toUpperCase())
                    .replace(/Dhw/g, 'DHW')
                    .trim();
                };
                // loop through the array mainOpMode.commands.setMode.params.mode.constraints.enum and log the formatstring
                for (const mode of mainOpMode.commands.setMode.params.mode.constraints.enum) {
                  const formattedMode = formatString(mode);
                  this.log('Formatted Heating Modes:', formattedMode);
                  // push the formattedMode and corresponding mode to the modes array
                  operatingModes.push({ id: mode, title: { en: formattedMode } });
                }
              }
            } catch (error) {
              this.error('Error when parsing operating modes', error);
              throw error;
            }

            return [{
              name: 'Viessmann',
              data: {
                id: `${gateway.installationId}-${gateway.serial}-${device.id}`,
              },
              store: {
                installationId: gateway.installationId,
                gatewaySerial: gateway.serial,
                deviceId: device.id,
                roles: device.roles,
                operatingModes,
              },
            }];
          }
        }
      }
    }
    return null;
  }

};
