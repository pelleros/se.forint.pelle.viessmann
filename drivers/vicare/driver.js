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
const { FEATURES, PATHS } = require('./config');
const { FLOW_CONDITIONS, FLOW_ACTIONS, FLOW_TRIGGERS } = require('./flowCards');

module.exports = class ViessmannDriver extends OAuth2Driver {

  static FEATURES = FEATURES;
  static PATHS = PATHS;

  MIN_POLL_INTERVAL = 2 * 60 * 1000;
  _devicePollers = new Map();

  async onOAuth2Init() {
    try {
      this.log('Starting onOAuth2Init');

      // Get device trigger card reference
      this._heatingModeChangedTrigger = this.homey.flow.getDeviceTriggerCard(FLOW_TRIGGERS.HEATING_MODE_CHANGED.id);

      // Register Flow Cards
      this.log('Registering flow cards');
      this._registerFlowCards();
      this.log('Flow cards registered');

      this.log('onOAuth2Init completed');
    } catch (error) {
      this.error('Error in onOAuth2Init:', error);
      throw error;
    }
  }

  _registerFlowCards() {
    this.log('Starting to register flow cards');

    // Register conditions
    Object.values(FLOW_CONDITIONS).forEach((condition) => {
      this.log(`Registering condition: ${condition.id}`);
      try {
        const flowCard = this.homey.flow.getConditionCard(condition.id);
        flowCard.registerRunListener(async (args, state) => {
          const { device } = args;
          return device.getCapabilityValue(condition.capability);
        });
      } catch (error) {
        this.error(`Failed to register condition ${condition.id}:`, error);
      }
    });

    // Register actions
    Object.values(FLOW_ACTIONS).forEach((action) => {
      this.log(`Registering action: ${action.id}`);
      try {
        const flowCard = this.homey.flow.getActionCard(action.id);
        flowCard.registerRunListener(async (args, state) => {
          const { device, ...actionArgs } = args;
          return device[action.method](...Object.values(actionArgs));
        });
      } catch (error) {
        this.error(`Failed to register action ${action.id}:`, error);
      }
    });

    this.log('Finished registering flow cards');
  }

  _calculatePollInterval() {
    const deviceCount = this.getDevices().length;
    return this.MIN_POLL_INTERVAL * deviceCount;
  }

  async _updateAllPollingIntervals() {
    const newInterval = this._calculatePollInterval();
    const devices = this.getDevices();

    if (process.env.DEBUG) {
      this.log(`Updating polling interval for ${devices.length} devices to ${newInterval / 1000} seconds`);
    }

    await Promise.all(devices.map(async (device) => {
      const { installationId, gatewaySerial, deviceId } = device.getStore();
      const deviceKey = `${installationId}-${gatewaySerial}-${deviceId}`;
      await this._startPolling(device, deviceKey, newInterval);
    }));
  }

  async _startPolling(device, deviceKey, interval = null) {
    try {
      this.log(`Setting up polling for device: ${deviceKey}`);
      let consecutiveErrors = 0;
      const pollInterval = interval || this._calculatePollInterval();

      // Stop any existing polling
      this._stopPolling(deviceKey);

      // Create reusable async polling function
      const doPoll = async () => {
        try {
          // Use device's getFeatures method instead of direct API call
          const features = await device.getFeatures();

          consecutiveErrors = 0;
          if (!device.getAvailable()) {
            device.setAvailable();
          }

          // Update device with new features
          await device.onFeaturesUpdated(features);
        } catch (error) {
          consecutiveErrors++;
          this.error(`Error polling device ${deviceKey}:`, error);

          if (device.getAvailable()) {
            if (consecutiveErrors >= 3) {
              device.setUnavailable('Multiple communication errors');
            } else if (error.message.includes('unauthorized')) {
              device.setUnavailable('Authentication failed');
            }
          }
        }
      };

      // Perform initial poll immediately
      this.log(`Performing initial poll for device: ${deviceKey}`);
      await doPoll();

      // Start interval polling
      const timer = this.homey.setInterval(doPoll, pollInterval);
      this._devicePollers.set(deviceKey, timer);

      if (process.env.DEBUG) {
        this.log(`Started polling for ${deviceKey} with interval ${pollInterval / 1000} seconds`);
      }
    } catch (error) {
      this.error(`Error setting up polling for device ${deviceKey}:`, error);
      throw error;
    }
  }

  _stopPolling(deviceKey) {
    const existingTimer = this._devicePollers.get(deviceKey);
    if (existingTimer) {
      this.log(`Stopping polling for device: ${deviceKey}`);
      this.homey.clearInterval(existingTimer);
      this._devicePollers.delete(deviceKey);
    }
  }

  async onPairListDevices({ oAuth2Client }) {
    try {
      if (process.env.DEBUG) {
        this.log('Starting onPairListDevices');
      }

      if (!oAuth2Client) {
        throw new Error('No OAuth2Client provided');
      }

      const result = await oAuth2Client.getInstallations();

      this.log('[ViessmannDriver::onPairListDevices] Installations:', JSON.stringify(result, null, 3));

      const devices = [];

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

              const mainOpMode = response.data.find((item) => item.feature === PATHS.HEATING_MODE);
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

              devices.push({
                name: `Viessmann (${gateway.installationId})`,
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
              });
            }
          }
        }
      }

      return devices;
    } catch (error) {
      this.error('Error in onPairListDevices:', error);
      throw error;
    }
  }

  async onPair(socket) {
    try {
      // Check if clientId is set
      const clientId = await this.homey.settings.get('clientId');
      if (!clientId || clientId.trim() === '') {
        throw new Error(this.homey.__('pair.no_client_id'));
      }

      // Anropa parent onPair med socket
      const result = await super.onPair(socket);
      this.log('Pairing process completed');

      // When a new device is added, start polling for it
      this.once('device_add', async (device) => {
        this.log('New device added, starting polling');
        const { installationId, gatewaySerial, deviceId } = device.getStore();
        const deviceKey = `${installationId}-${gatewaySerial}-${deviceId}`;
        await this._startPolling(device, deviceKey);
      });

      return result;
    } catch (error) {
      this.error('Error in onPair:', error);
      throw error;
    }
  }

};
