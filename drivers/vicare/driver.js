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

// ViessmannOAuth2Client.onHandleNotOK throws 'Unauthorized - check credentials' for HTTP 401
const isAuthenticationError = (error) => error?.status === 401
  || /unauthorized/i.test(typeof error?.message === 'string' ? error.message : '');

module.exports = class ViessmannDriver extends OAuth2Driver {

  static FEATURES = FEATURES;
  static PATHS = PATHS;

  MIN_POLL_INTERVAL = 2 * 60 * 1000;
  _devicePollers = new Map();
  _triggerCards = new Map();

  async onOAuth2Init() {
    try {
      this.log('Starting onOAuth2Init');

      // Register all triggers from flowCards.js
      await this._registerTriggerCards();

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

  async _registerTriggerCards() {
    // Register all triggers from FLOW_TRIGGERS
    for (const [, trigger] of Object.entries(FLOW_TRIGGERS)) {
      const triggerCard = this.homey.flow.getDeviceTriggerCard(trigger.id);
      this._triggerCards.set(trigger.capability, triggerCard);
    }
  }

  // Helper to get the trigger card for a capability
  getTriggerCard(capabilityName) {
    const triggerCard = this._triggerCards.get(capabilityName);
    if (!triggerCard) {
      throw new Error(`No trigger card found for capability: ${capabilityName}`);
    }
    return triggerCard;
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

          // Find the path and capability in FEATURES
          for (const [path, feature] of Object.entries(FEATURES)) {
            const capability = feature.capabilities?.find((cap) => cap.capabilityName === action.capability);
            if (capability) {
              // Use executeCommand with the path and capability
              const value = actionArgs[Object.keys(actionArgs)[0]]; // Get the value from the first argument
              return device.executeCommand(path, capability, value);
            }
          }

          throw new Error(`No matching capability found for action: ${action.id}`);
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

      // Registered before the first poll, so that _stopPolling (e.g. when the device is
      // deleted) also stops a poll that is still in progress
      const poller = { timer: null };
      this._devicePollers.set(deviceKey, poller);
      const isActive = () => this._devicePollers.get(deviceKey) === poller;

      // Create reusable async polling function
      const doPoll = async () => {
        // The device was deleted or its polling restarted since this poll was scheduled
        if (!isActive()) return;
        try {
          // get features with extended response every 30th poll (statisticaly)
          const extendedRequest = Math.random() < 0.03;
          // device.getFeatures(useFilter) takes a boolean: false requests all features
          const features = await device.getFeatures(!extendedRequest);
          if (!isActive()) return;

          consecutiveErrors = 0;
          if (!device.getAvailable()) {
            await this._setDeviceAvailability(device, deviceKey, true);
          }

          // Update device with new features
          await device.onFeaturesUpdated(features, extendedRequest);
        } catch (error) {
          if (!isActive()) return;
          consecutiveErrors++;
          this.error(`Error polling device ${deviceKey}:`, error);

          if (device.getAvailable()) {
            if (consecutiveErrors >= 3) {
              await this._setDeviceAvailability(device, deviceKey, false, 'Multiple communication errors');
            } else if (isAuthenticationError(error)) {
              await this._setDeviceAvailability(device, deviceKey, false, 'Authentication failed');
            }
          }
        }
      };
      // The timer ignores the returned promise, so a rejection would be unhandled and crash the app
      const safePoll = () => doPoll().catch((error) => {
        this.error(`Unexpected error polling device ${deviceKey}:`, error);
      });

      // Perform initial poll immediately
      this.log(`Performing initial poll for device: ${deviceKey}`);
      await safePoll();

      // Polling was stopped (e.g. the device was deleted) during the initial poll
      if (!isActive()) return;

      // Start interval polling
      poller.timer = this.homey.setInterval(safePoll, pollInterval);

      if (process.env.DEBUG) {
        this.log(`Started polling for ${deviceKey} with interval ${pollInterval / 1000} seconds`);
      }
    } catch (error) {
      this.error(`Error setting up polling for device ${deviceKey}:`, error);
      throw error;
    }
  }

  _stopPolling(deviceKey) {
    const poller = this._devicePollers.get(deviceKey);
    if (poller) {
      this.log(`Stopping polling for device: ${deviceKey}`);
      if (poller.timer) {
        this.homey.clearInterval(poller.timer);
      }
      this._devicePollers.delete(deviceKey);
    }
  }

  // setAvailable/setUnavailable reject (e.g. with 'device_not_found') when the device was
  // deleted meanwhile; log that instead of letting the rejection escape the poll timer
  async _setDeviceAvailability(device, deviceKey, available, message) {
    try {
      if (available) {
        await device.setAvailable();
      } else {
        await device.setUnavailable(message);
      }
    } catch (error) {
      this.error(`Could not mark device ${deviceKey} as ${available ? 'available' : 'unavailable'}:`, error);
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
      const { version } = this.homey.manifest;

      for (const installation of result.data) {
        for (const gateway of installation.gateways) {
          for (const device of gateway.devices) {
            if (device.deviceType === 'heating') {
              if (process.env.DEBUG) {
                this.log('[ViessmannDriver::onPairListDevices] installationId:', gateway.installationId);
                this.log('[ViessmannDriver::onPairListDevices] gatewaySerial:', gateway.serial);
                this.log('[ViessmannDriver::onPairListDevices] deviceId:', device.id);
              }

              const { features, constraints, operatingModes } = await this._getEnabledFeaturesAndOpModes(oAuth2Client, gateway.installationId, gateway.serial, device.id);

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
                  features,
                  constraints,
                  operatingModes,
                  version,
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

  async _getEnabledFeaturesAndOpModes(oAuth2Client, installationId, gatewaySerial, deviceId) {
    const response = await oAuth2Client.getFeatures({
      installationId,
      gatewaySerial,
      deviceId,
    });

    const features = [];
    const constraints = {};

    for (const feature of response.data) {
      if (feature.isEnabled && feature.properties?.status?.value !== 'notConnected') {
        features.push(feature.feature);

        // Save constraints separately
        if (feature.commands) {
          constraints[feature.feature] = {};
          Object.values(feature.commands).forEach((command) => {
            Object.entries(command.params || {}).forEach(([paramName, param]) => {
              if (param.constraints) {
                constraints[feature.feature][paramName] = param.constraints;
              }
            });
          });
        }
      }
    }

    // Get operating modes
    const operatingModes = [];
    try {
      const mainOpMode = response.data.find((item) => item.feature === PATHS.HEATING_CIRCUIT_0_MODE);

      if (mainOpMode?.isEnabled) {
        const formatString = (str) => {
          return str.replace(/([A-Z])/g, ' $1')
            .replace(/^./, (char) => char.toUpperCase())
            .replace(/Dhw/g, 'DHW')
            .trim();
        };

        for (const mode of mainOpMode.commands.setMode.params.mode.constraints.enum) {
          operatingModes.push({
            id: mode,
            title: { en: formatString(mode) },
          });
        }
      }
    } catch (err) {
      // not critical, just log
      if (process.env.DEBUG) {
        this.log('Error parsing operating modes:', err);
      }
    }
    return {
      features,
      constraints,
      operatingModes,
    };
  }

  async onPair(socket) {
    try {
      // Check if clientId is set
      const clientId = await this.homey.settings.get('clientId');
      if (!clientId || clientId.trim() === '') {
        throw new Error(this.homey.__('pair.no_client_id'));
      }

      // Call the parent onPair with the socket
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
