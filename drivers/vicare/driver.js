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

const {
  isAuthenticationFailure, apiErrorState, API_STATES, REPAIR_MESSAGE,
} = require('../../lib/apiError');
const { apiStateMessage } = require('../../lib/errorMessages');

// Least time between polls while one of these states lasts. Viessmann refusing access (HTTP 402)
// is often a temporary fault on its side that is fixed within hours; a gateway is often back
// within minutes, and a successful poll clears the state.
const STATE_RETRY_DELAYS = {
  [API_STATES.PACKAGE_NOT_PAID]: 60 * 60 * 1000,
  [API_STATES.GATEWAY_OFFLINE]: 5 * 60 * 1000,
};

// The installation list reports the gateway or the device as offline
const reportedOffline = (gateway, device) => [gateway?.aggregatedStatus, device?.status]
  .some((status) => typeof status === 'string' && status.toLowerCase() === 'offline');

// What pairing found, for the log: counts, device types and models, no ids or personal data.
// (The installations response contains serials, installation ids and the address.)
function summarizeInstallations(response) {
  const installations = Array.isArray(response?.data) ? response.data : [];
  const gateways = installations.flatMap((installation) => installation.gateways || []);
  const devices = gateways.flatMap((gateway) => gateway.devices || []);
  const describe = (items, describeItem) => (items.length > 0 ? `: ${items.map(describeItem).join(', ')}` : '');
  const gatewayType = (gateway) => gateway.gatewayType || 'unknown type';
  const deviceType = (device) => [device.deviceType, device.modelId].filter(Boolean).join(' ') || 'unknown type';
  return `${installations.length} installation(s), ${gateways.length} gateway(s)${describe(gateways, gatewayType)}, `
    + `${devices.length} device(s)${describe(devices, deviceType)}`;
}

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
        // get features with extended response every 30th poll (statistically)
        const extendedRequest = Math.random() < 0.03;
        const features = await device.getFeatures({ useFilter: !extendedRequest });
        // The device was deleted or its polling restarted while the request was running
        if (isStopped()) return;
        if (!device.getAvailable()) {
          await this._setDeviceAvailability(device, deviceKey, true);
        }
        await device.onFeaturesUpdated(features, extendedRequest);
      },
      retryDelay: (error) => Math.max(error?.retryAfterMs || 0, STATE_RETRY_DELAYS[apiErrorState(error)] || 0),
      onError: async (error, consecutiveErrors, { nextPollAt } = {}) => {
        this.error(`Error polling device ${deviceKey}:`, error);
        // Say right away what the user should know: Viessmann refuses access, the quota
        // is used up (when its reset is known), the gateway is offline, or only a new login
        // helps. Everything else is retried with backoff.
        const stateMessage = apiStateMessage(this.homey, error, {
          retryAt: Number.isFinite(error?.retryAfterMs) ? nextPollAt : undefined,
        });
        if (stateMessage) {
          await this._setDeviceAvailability(device, deviceKey, false, stateMessage);
        } else if (isAuthenticationFailure(error)) {
          await this._setDeviceAvailability(device, deviceKey, false, REPAIR_MESSAGE);
        } else if (consecutiveErrors >= 3) {
          // API errors carry a safe, redacted message; network errors can contain request URLs
          const message = error?.status && error.message ? error.message : 'Multiple communication errors';
          await this._setDeviceAvailability(device, deviceKey, false, message);
        }
      },
    });
    // Registered before the first poll, so that _stopPolling (e.g. when the device is
    // deleted) also stops a poll that is still in progress
    this._devicePollers.set(deviceKey, poller);
    this.log(`Performing initial poll for device: ${deviceKey}`);
    await poller.start();
  }

  async _stopPolling(deviceKey) {
    const poller = this._devicePollers.get(deviceKey);
    if (!poller) return;
    this.log(`Stopping polling for device: ${deviceKey}`);
    this._devicePollers.delete(deviceKey);
    await poller.stop();
  }

  // Keeps the poller (and its backoff and Retry-After state) while it is paused
  async _pausePolling(deviceKey) {
    await this._devicePollers.get(deviceKey)?.pause();
  }

  // Returns false when the device has no poller
  _resumePolling(deviceKey) {
    const poller = this._devicePollers.get(deviceKey);
    poller?.resume();
    return Boolean(poller);
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

      this.log('[ViessmannDriver::onPairListDevices] Found', summarizeInstallations(result));

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

              let metadata;
              try {
                metadata = await this._getEnabledFeaturesAndOpModes(oAuth2Client, gateway.installationId, gateway.serial, device.id);
              } catch (error) {
                // Without a clearer cause, the installation list may already say why
                if (!apiErrorState(error) && reportedOffline(gateway, device)) {
                  throw Object.assign(new Error(`Gateway offline: ${error?.message}`, { cause: error }), { apiReason: 'GATEWAY_OFFLINE' });
                }
                throw error;
              }
              const {
                features, constraints, operatingModes, heatingCircuitId, commandMetadata,
              } = metadata;

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
      throw this._pairingError(error);
    }
  }

  // The error to show while adding a device: a translated message for a known API state
  _pairingError(error) {
    const retryAt = Number.isFinite(error?.retryAfterMs) ? Date.now() + error.retryAfterMs : undefined;
    const message = apiStateMessage(this.homey, error, { retryAt, pairing: true });
    return message ? new Error(message, { cause: error }) : error;
  }

  async _getEnabledFeaturesAndOpModes(oAuth2Client, installationId, gatewaySerial, deviceId, selectedCircuit = 'auto') {
    const rawResponse = await oAuth2Client.getFeatures({
      installationId,
      gatewaySerial,
      deviceId,
    });
    return this._readDeviceMetadata(rawResponse, selectedCircuit);
  }

  // What a device stores from an unfiltered features response, for the selected circuit
  _readDeviceMetadata(rawResponse, selectedCircuit = 'auto') {
    const heatingCircuitId = detectHeatingCircuit(rawResponse.data, selectedCircuit);
    const response = normalizeCircuitFeatures(rawResponse, heatingCircuitId);
    const features = [];
    const constraints = {};
    const commandMetadata = {};

    for (const feature of response.data) {
      if (feature.isEnabled && feature.properties?.status?.value !== 'notConnected') {
        features.push(feature.feature);

        // Save constraints separately
        if (feature.commands && typeof feature.commands === 'object') {
          commandMetadata[feature.feature] = feature.commands;
          constraints[feature.feature] = {};
          Object.values(feature.commands).forEach((command) => {
            Object.entries(command?.params || {}).forEach(([paramName, param]) => {
              if (param?.constraints) {
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
