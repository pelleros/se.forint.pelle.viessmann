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

// @ts-check

'use strict';

// The driver of a kind of extra device (heating circuit, hot water, room; see extraProfiles.js),
// each its own entry in Homey's "Add device", so that adding the ViCare device stays as it is.
// Pairing: a view that says who needs the device (`intro`), the Client ID when none is saved,
// the Viessmann login (skipped when the app already has one: the devices share it) and the
// device list (extraPairing.js), which lists only what the account has. Polling is the ViCare
// driver's (driver.js), which each device joins. A kind with Flow cards of its own (flowCards.js
// → EXTRA_FLOW_CARDS: the heating circuit's operating mode and program) has them registered here,
// with the ViCare driver's handlers (flowHandlers.js).

const { OAuth2Driver } = require('homey-oauth2app');
const { translate } = require('../../lib/errorMessages');
const {
  PairSession, summarizeInstallations, featureReadError, pairingError,
} = require('./pairSession');
const { sourceDevices, extraEntries, withUniqueNames } = require('./extraPairing');
const { POLL_DRIVER } = require('./extraDevice');
const { EXTRA_FLOW_CARDS } = require('./flowCards');
const { registerFlowCards, valueTriggerCards } = require('./flowHandlers');

class ExtraDriver extends OAuth2Driver {

  // 'circuit', 'hotWater' or 'room' (extraProfiles.js)
  static KIND = undefined;

  /** @returns {import('./extraProfiles').ExtraKind} */
  get kind() {
    return /** @type {any} */ (this.constructor).KIND;
  }

  /** @type {any} the pairing session while its device list runs (pairSession.js) */
  _pairSession = undefined;

  /** @type {(key: string, tags?: Record<string, unknown>) => string} */
  t = (key, tags) => translate(this.homey, key, tags);

  /** @type {Map<string, { card: any, mapping: any }[]>} trigger cards with a kind, per capability */
  _valueTriggers = new Map();

  // The kind's own Flow cards; a card that cannot be registered is logged, the others work
  async onOAuth2Init() {
    const cards = EXTRA_FLOW_CARDS[this.kind];
    if (!cards) return;
    try {
      this._valueTriggers = valueTriggerCards(this.homey, Object.values(cards.triggers));
    } catch (error) {
      this.error('Could not register the trigger cards:', error);
    }
    registerFlowCards(this, { conditions: Object.values(cards.conditions), actions: Object.values(cards.actions) });
  }

  // The trigger cards with a kind for a capability, as { card, mapping } (flowHandlers.js)
  getValueTriggers(capabilityName) {
    return this._valueTriggers.get(capabilityName) || [];
  }

  /** @returns {any} the ViCare driver (driver.js) */
  pollHost() {
    return this.homey.drivers.getDriver(POLL_DRIVER);
  }

  // The API calls a day the account's devices plan, for the write allowance (writeQuota.js)
  plannedCallsPerDay(sessionId) {
    return this.pollHost().plannedCallsPerDay(sessionId);
  }

  // The intro view's texts: who needs this device and what it shares with the ViCare device
  introTexts() {
    const key = `pair.extra.${this.kind}`;
    return {
      title: this.t(`${key}.title`),
      paragraphs: [this.t(`${key}.who`), this.t(`${key}.shared`)],
      next: this.t('pair.extra.next'),
    };
  }

  /**
   * @param {any} socket
   * @returns {Promise<any>}
   */
  async onPair(socket) {
    try {
      const result = await new PairSession(this, socket).attach(() => super.onPair(socket));
      socket.setHandler('extra_intro', async () => this.introTexts());
      return result;
    } catch (error) {
      this.error('Error in onPair:', error);
      throw error;
    }
  }

  async onPairListDevices({ oAuth2Client }) {
    this._pairSession?.captureClient(oAuth2Client);
    try {
      if (!oAuth2Client) throw new Error('No OAuth2Client provided');
      const installations = await oAuth2Client.getInstallations();
      this.log('[ExtraDriver::onPairListDevices] Found', summarizeInstallations(installations));
      if (!Array.isArray(installations?.data) || installations.data.length === 0) throw new Error(this.t('pair.no_installations'));

      const version = this.homey.manifest?.version;
      const entries = [];
      for (const source of sourceDevices(this.kind, installations)) {
        let features;
        try {
          features = await oAuth2Client.getFeatures({
            installationId: source.gateway.installationId,
            gatewaySerial: source.gateway.serial,
            deviceId: source.device.id,
          });
        } catch (error) {
          throw featureReadError(error, source.gateway, source.device);
        }
        entries.push(...extraEntries(this.kind, source, features, { t: this.t, version }));
      }
      if (entries.length === 0) throw new Error(this.t(`pair.extra.${this.kind}.none`));
      return withUniqueNames(entries);
    } catch (error) {
      this.error('Error in onPairListDevices:', error);
      throw pairingError(this.homey, error);
    }
  }

}

module.exports = { ExtraDriver };
