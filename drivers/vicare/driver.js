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
const DevicePoller = require('../../lib/DevicePoller');
const { FEATURES, PATHS } = require('./config');
const { detectHeatingCircuit, normalizeCircuitFeatures } = require('./heatingCircuit');
const { FLOW_CONDITIONS, FLOW_ACTIONS, FLOW_TRIGGERS } = require('./flowCards');

module.exports = class ViessmannDriver extends OAuth2Driver {

  static FEATURES = FEATURES;
  static PATHS = PATHS;

  MIN_POLL_INTERVAL = 2 * 60 * 1000;
  _devicePollers = new Map();
  _triggerCards = new Map();

  async onOAuth2Init() {
    try {
      this.log('Starting onOAuth2Init');

      // Registrera alla triggers frÃƒÂ¥n flowCards.js
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
    // Registrera alla triggers frÃƒÂ¥n FLOW_TRIGGERS
    for (const [, trigger] of Object.entries(FLOW_TRIGGERS)) {
      const triggerCard = this.homey.flow.getDeviceTriggerCard(trigger.id);
      this._triggerCards.set(trigger.capability, triggerCard);
    }
  }

  // HjÃƒÂ¤lpmetod fÃƒÂ¶r att hÃƒÂ¤mta trigger card baserat pÃƒÂ¥ capability
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

          // Hitta path och capability frÃƒÂ¥n FEATURES
          for (const [path, feature] of Object.entries(FEATURES)) {
            const capability = feature.capabilities?.find((cap) => cap.capabilityName === action.capability);
            if (capability) {
              // AnvÃƒÂ¤nd executeCommand med path och capability
              const value = actionArgs[Object.keys(actionArgs)[0]]; // HÃƒÂ¤mta vÃƒÂ¤rdet frÃƒÂ¥n fÃƒÂ¶rsta argumentet
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
    return this.MIN_POLL_INTERVAL * Math.max(1, deviceCount);
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
      await this._startPolling(device, deviceKey);
    }));
  }

  async _startPolling(device, deviceKey) {
    const existing = this._devicePollers.get(deviceKey);
    if (existing) {
      existing.schedule();
      return;
    }
    const poller = new DevicePoller({
      homey: this.homey,
      getInterval: () => this._calculatePollInterval(),
      poll: async (isStopped) => {
        const extendedRequest = Math.random() < 0.03;
        const features = await device.getFeatures({ useFilter: !extendedRequest });
        if (!isStopped()) await device.onFeaturesUpdated(features, extendedRequest);
      },
      onError: async (error, consecutiveErrors) => {
        this.error(`Error polling device ${deviceKey}:`, error);
        if (error.status === 401) await device.setUnavailable('Authentication failed; repair the device to sign in again');
        else if (consecutiveErrors >= 3) await device.setUnavailable(error.message || 'Multiple communication errors');
      },
    });
    this._devicePollers.set(deviceKey, poller);
    await poller.start();
  }

  async _stopPolling(deviceKey) {
    const poller = this._devicePollers.get(deviceKey);
    this._devicePollers.delete(deviceKey);
    if (poller) await poller.stop();
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

              const {
                features, constraints, operatingModes, heatingCircuitId, commandMetadata,
              } = await this._getEnabledFeaturesAndOpModes(oAuth2Client, gateway.installationId, gateway.serial, device.id);

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
                  heatingCircuitId,
                  commandMetadata,
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

  async _getEnabledFeaturesAndOpModes(oAuth2Client, installationId, gatewaySerial, deviceId, selectedCircuit = 'auto') {
    const rawResponse = await oAuth2Client.getFeatures({
      installationId,
      gatewaySerial,
      deviceId,
    });

    const heatingCircuitId = detectHeatingCircuit(rawResponse.data, selectedCircuit);
    const response = normalizeCircuitFeatures(rawResponse, heatingCircuitId);
    const features = [];
    const constraints = {};
    const commandMetadata = {};

    for (const feature of response.data) {
      if (feature.isEnabled && feature.properties?.status?.value !== 'notConnected') {
        features.push(feature.feature);

        // Save constraints separately
        if (feature.commands) {
          commandMetadata[feature.feature] = feature.commands;
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
      heatingCircuitId,
      commandMetadata,
    };
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
