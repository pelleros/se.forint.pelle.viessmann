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

// The one driver: it pairs devices, registers the Flow cards and polls every device. This class
// holds the pollers and the trigger cards and wires them to the Homey SDK; the logic is in
//   pollPlan.js           how often a device is polled and what a poll asks for
//   lib/DevicePoller.js   the polling loop: no overlap, backoff, Retry-After
//   lib/apiError.js       how long a poll waits after an error (retryDelay)
//   lib/errorMessages.js  what a device says when its polls fail (pollErrorMessage)
//   pairSession.js        the pairing views and the entries of the device list
//   deviceMetadata.js     what a device stores from its features
//   flowHandlers.js       how the condition and action cards run

const { OAuth2Driver } = require('homey-oauth2app');
const DevicePoller = require('../../lib/DevicePoller');
const { FEATURES, PATHS } = require('./config');
const { FLOW_CONDITIONS, FLOW_ACTIONS, FLOW_TRIGGERS } = require('./flowCards');
const { registerFlowCards } = require('./flowHandlers');
const { readDeviceMetadata } = require('./deviceMetadata');
const { pollErrorMessage, translate } = require('../../lib/errorMessages');
const { retryDelay } = require('../../lib/apiError');
const {
  PairSession, deviceName, checkInstallations, summarizeInstallations, heatingDevices, featureReadError, pairedDevice, pairingError,
} = require('./pairSession');
const {
  pollInterval, plannedCallsPerDay, isExtendedPoll, pollingKey,
} = require('./pollPlan');
const { matchesEventCode } = require('./eventLog');
const { maskId, maskDeviceKey } = require('../../lib/logPrivacy');

module.exports = class ViessmannDriver extends OAuth2Driver {

  static FEATURES = FEATURES;
  static PATHS = PATHS;

  _devicePollers = new Map();
  _triggerCards = new Map();
  // Triggers the app fires for events (flowCards.js `event: true`), by card id
  _eventTriggerCards = new Map();
  // Trigger cards with a kind (flowHandlers.js), per capability
  _valueTriggers = new Map();

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

  /* Flow cards */

  async _registerTriggerCards() {
    // Register all triggers from FLOW_TRIGGERS
    for (const [, trigger] of Object.entries(FLOW_TRIGGERS)) {
      const triggerCard = this.homey.flow.getDeviceTriggerCard(trigger.id);
      if (trigger.event) {
        this._eventTriggerCards.set(trigger.id, triggerCard);
        // A card with a code argument fires only for that code
        if (trigger.id === 'event-code-logged' && typeof triggerCard.registerRunListener === 'function') {
          triggerCard.registerRunListener(async (args, state) => matchesEventCode(args, state));
        }
      } else if (trigger.kind) {
        this._valueTriggers.set(trigger.capability, [...this.getValueTriggers(trigger.capability), { card: triggerCard, mapping: trigger }]);
      } else {
        this._triggerCards.set(trigger.capability, triggerCard);
      }
    }
  }

  // Fires an event trigger (see flowCards.js) for a device
  async triggerEvent(id, device, tokens = {}, state = {}) {
    const card = this._eventTriggerCards.get(id);
    if (!card) throw new Error(`No event trigger card: ${id}`);
    await card.trigger(device, tokens, state);
  }

  // The trigger cards with a kind for a capability, as { card, mapping }
  getValueTriggers(capabilityName) {
    return this._valueTriggers.get(capabilityName) || [];
  }

  // Helper to get the trigger card for a capability
  getTriggerCard(capabilityName) {
    const triggerCard = this._triggerCards.get(capabilityName);
    if (!triggerCard) {
      throw new Error(`No trigger card found for capability: ${capabilityName}`);
    }
    return triggerCard;
  }

  // The run listeners of the condition and action cards (flowHandlers.js)
  _registerFlowCards() {
    this.log('Starting to register flow cards');
    registerFlowCards(this, { conditions: Object.values(FLOW_CONDITIONS), actions: Object.values(FLOW_ACTIONS) });
    this.log('Finished registering flow cards');
  }

  /* Polling */

  // A device's poll interval: its setting, or automatic (see pollPlan.js)
  _calculatePollInterval(device) {
    return pollInterval(device?.getPollSetting?.('pollInterval'), this.getDevices().length);
  }

  // The API calls a day the devices of a Viessmann login plan; `changed` holds the settings of a
  // device whose change is being saved
  plannedCallsPerDay(sessionId, changed = {}) {
    const settings = this.getDevices()
      .filter((device) => device.getStoreValue?.('OAuth2SessionId') === sessionId)
      .map((device) => (device === changed.device ? changed.settings : {
        pollInterval: device.getPollSetting?.('pollInterval'), eventLog: device.getPollSetting?.('eventLog'),
      }));
    return plannedCallsPerDay(settings, this.getDevices().length);
  }

  async _updateAllPollingIntervals() {
    const newInterval = this._calculatePollInterval();
    const devices = this.getDevices();

    if (process.env.DEBUG) {
      this.log(`Updating polling interval for ${devices.length} devices to ${newInterval / 1000} seconds`);
    }

    await Promise.all(devices.map(async (device) => {
      await this._startPolling(device, pollingKey(device.getStore()));
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
      getInterval: () => this._calculatePollInterval(device),
      poll: async (isStopped) => {
        const extendedRequest = isExtendedPoll();
        const features = await device.getFeatures({ useFilter: !extendedRequest });
        // The device was deleted or its polling restarted while the request was running
        if (isStopped()) return;
        if (!device.getAvailable()) {
          await this._setDeviceAvailability(device, deviceKey, true);
        }
        await device.onFeaturesUpdated(features, extendedRequest);
      },
      retryDelay,
      onError: async (error, consecutiveErrors, { nextPollAt } = {}) => {
        this.error(`Error polling device ${maskDeviceKey(deviceKey)}:`, error);
        device.recordPollError?.(error);
        const message = pollErrorMessage(this.homey, error, consecutiveErrors, { nextPollAt });
        if (message) await this._setDeviceAvailability(device, deviceKey, false, message);
      },
    });
    // Registered before the first poll, so that _stopPolling (e.g. when the device is
    // deleted) also stops a poll that is still in progress
    this._devicePollers.set(deviceKey, poller);
    this.log(`Performing initial poll for device: ${maskDeviceKey(deviceKey)}`);
    await poller.start();
  }

  async _stopPolling(deviceKey) {
    const poller = this._devicePollers.get(deviceKey);
    if (!poller) return;
    this.log(`Stopping polling for device: ${maskDeviceKey(deviceKey)}`);
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
      this.error(`Could not mark device ${maskDeviceKey(deviceKey)} as ${available ? 'available' : 'unavailable'}:`, error);
    }
  }

  /* Pairing */

  async onPairListDevices({ oAuth2Client }) {
    // The pairing check and the report use the client of this pairing (see pairSession.js)
    this._pairSession?.captureClient(oAuth2Client);
    try {
      if (process.env.DEBUG) {
        this.log('Starting onPairListDevices');
      }

      if (!oAuth2Client) {
        throw new Error('No OAuth2Client provided');
      }

      const result = await oAuth2Client.getInstallations();

      this.log('[ViessmannDriver::onPairListDevices] Found', summarizeInstallations(result));
      checkInstallations(result, (key, tags) => translate(this.homey, key, tags));

      const devices = [];
      const { version } = this.homey.manifest;

      for (const { gateway, device } of heatingDevices(result)) {
        if (process.env.DEBUG) {
          this.log('[ViessmannDriver::onPairListDevices] installationId:', maskId(gateway.installationId));
          this.log('[ViessmannDriver::onPairListDevices] gatewaySerial:', maskId(gateway.serial));
          this.log('[ViessmannDriver::onPairListDevices] deviceId:', device.id);
        }

        let metadata;
        try {
          metadata = await this._getEnabledFeaturesAndOpModes(oAuth2Client, gateway.installationId, gateway.serial, device.id);
        } catch (error) {
          throw featureReadError(error, gateway, device);
        }
        const name = deviceName(device, devices.map((paired) => paired.name), (key) => translate(this.homey, key));
        devices.push(pairedDevice(gateway, device, metadata, { name, version }));
      }

      return devices;
    } catch (error) {
      this.error('Error in onPairListDevices:', error);
      throw pairingError(this.homey, error);
    }
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
    return readDeviceMetadata(rawResponse, selectedCircuit);
  }

  // The SDK's pairing with the views around it (Client ID, check, report): see pairSession.js
  async onPair(socket) {
    try {
      const result = await new PairSession(this, socket).attach(() => super.onPair(socket));
      this.log('Pairing process completed');

      // When a new device is added, start polling for it
      this.once('device_add', (device) => {
        this.log('New device added, starting polling');
        this._startPolling(device, pollingKey(device.getStore())).catch((error) => this.error('Could not start polling:', error));
      });

      return result;
    } catch (error) {
      this.error('Error in onPair:', error);
      throw error;
    }
  }

};
