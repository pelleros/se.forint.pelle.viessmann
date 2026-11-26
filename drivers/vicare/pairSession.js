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

// Adding a device: the views around Homey's login and device list (see driver.compose.json).
// `client_id` asks for the Client ID when none is saved; after the login `pair_check` shows what
// the account has, or why nothing can be added, and offers a report for the developer, which needs
// only the login. The device list reuses the check's result, so the API is read once. Also the
// names new devices get and the checks with specific messages.

const { translate } = require('../../lib/errorMessages');
const { collectReport, summarizeReport } = require('../../lib/report');

// Homey's redirect URI for OAuth logins, which the user enters in the Viessmann client
const DEFAULT_REDIRECT_URI = 'https://callback.athom.com/oauth2/callback';
// The check's result is reused by the device list for this long
const LIST_REUSE = 5 * 60 * 1000;
const CLIENT_ID_PATTERN = /^\S{8,128}$/;

/** @typedef {(key: string, tags?: Record<string, unknown>) => string} Translate */

/**
 * A model name from a Viessmann model id: 'E3_Vitodens_200_0821' → 'Vitodens 200',
 * 'E3_Vitovalor_PT2_0620' → 'Vitovalor PT2'. Undefined for ids that are no product name.
 * @param {unknown} modelId
 * @returns {string | undefined}
 */
function modelName(modelId) {
  if (typeof modelId !== 'string') return undefined;
  const parts = modelId.replace(/^E3_/i, '').split('_').filter(Boolean);
  if (parts.length === 0 || !/^vito[a-z]+$/i.test(parts[0])) return undefined;
  // A trailing date or variant code (0821, x05) is no part of the name
  while (parts.length > 1 && /^(\d{4}|x\d+)$/i.test(parts[parts.length - 1])) parts.pop();
  return parts.join(' ');
}

/**
 * The name of a new device: its model, or what it is; a second one of the same name gets a number.
 * @param {any} device the device in the installations response
 * @param {string[]} taken names already given in this pairing
 * @param {Translate} t
 * @returns {string}
 */
function deviceName(device, taken, t) {
  const model = modelName(device?.modelId);
  const roles = Array.isArray(device?.roles) ? device.roles.join(' ') : '';
  let name;
  if (model) name = `Viessmann ${model}`;
  else if (/heatpump/i.test(roles)) name = t('pair.device_name.heat_pump');
  else if (/fuelcell/i.test(roles)) name = t('pair.device_name.fuel_cell');
  else if (/boiler/i.test(roles)) name = t('pair.device_name.boiler');
  else name = t('pair.device_name.other');
  let unique = name;
  for (let number = 2; taken.includes(unique); number++) unique = `${name} ${number}`;
  return unique;
}

/**
 * Throws a specific message when the login works but there is nothing to add: no installation,
 * or no device of type heating (with the types the account has).
 * @param {any} installations the installations response
 * @param {Translate} t
 */
function checkInstallations(installations, t) {
  const list = Array.isArray(installations?.data) ? installations.data : [];
  const devices = list.flatMap((installation) => installation?.gateways || []).flatMap((gateway) => gateway?.devices || []);
  if (list.length === 0) throw new Error(t('pair.no_installations'));
  if (!devices.some((device) => device?.deviceType === 'heating')) {
    const types = [...new Set(devices.map((device) => [device?.deviceType, device?.modelId].filter(Boolean).join(' ')))];
    throw new Error(t('pair.no_heating_device', { types: types.join(', ') || '–' }));
  }
}

/**
 * The pairing views of one pairing session, on top of the SDK's pairing (homey-oauth2app).
 */
class PairSession {

  /**
   * @param {any} driver the ViessmannDriver
   * @param {any} socket the pairing session
   */
  constructor(driver, socket) {
    this.driver = driver;
    this.socket = socket;
    /** @type {any} the OAuth client of this pairing, once the device list ran */
    this.client = undefined;
    /** @type {{ devices?: any[], error?: unknown, at: number } | undefined} */
    this.result = undefined;
    /** @type {((data?: unknown) => Promise<any[]>) | undefined} */
    this.listDevices = undefined;
  }

  get homey() {
    return this.driver.homey;
  }

  /** @type {Translate} */
  t = (key, tags) => translate(this.homey, key, tags);

  /**
   * Runs the SDK's onPair with the device list handler wrapped (it shares its result with the
   * check), then registers the views' handlers.
   * @param {() => Promise<unknown> | unknown} sdkOnPair
   */
  async attach(sdkOnPair) {
    const { socket } = this;
    const setHandler = socket.setHandler.bind(socket);
    socket.setHandler = (/** @type {string} */ event, /** @type {Function} */ handler) => {
      if (event !== 'list_devices') return setHandler(event, handler);
      this.listDevices = /** @type {any} */ (handler);
      return setHandler(event, (/** @type {unknown} */ data) => this.list(data));
    };
    let result;
    try {
      result = await sdkOnPair();
    } finally {
      socket.setHandler = setHandler;
    }
    socket.setHandler('get_client_id', async () => this.getClientId());
    socket.setHandler('save_client_id', async (/** @type {unknown} */ value) => this.saveClientId(value));
    socket.setHandler('pair_check', async () => this.check());
    socket.setHandler('prepare_report', async () => this.prepareReport());
    return result;
  }

  // The driver's onPairListDevices hands its client here (see captureClient)
  captureClient(client) {
    this.client = client;
  }

  /**
   * The SDK's device list, run once for the check and the list. The SDK calls onPairListDevices
   * right away, which takes the client from driver._pairSession.
   * @param {unknown} [data]
   * @returns {Promise<any[]>}
   */
  async list(data) {
    if (this.result && Date.now() - this.result.at < LIST_REUSE) {
      const { devices, error } = this.result;
      if (error) {
        this.result = undefined;
        throw error;
      }
      return devices || [];
    }
    if (!this.listDevices) throw new Error('The device list is not ready');
    this.driver._pairSession = this;
    let pending;
    try {
      pending = this.listDevices(data);
    } finally {
      this.driver._pairSession = undefined;
    }
    try {
      const devices = await pending;
      this.result = { devices, at: Date.now() };
      return devices;
    } catch (error) {
      this.result = { error, at: Date.now() };
      throw error;
    }
  }

  getClientId() {
    const clientId = this.homey.settings.get('clientId');
    return {
      saved: typeof clientId === 'string' && clientId.trim() !== '',
      redirectUri: this.homey.app?.getConfig?.()?.redirectUrl || DEFAULT_REDIRECT_URI,
    };
  }

  /**
   * Saves a plausible Client ID (no spaces, a sensible length).
   * @param {unknown} value
   */
  saveClientId(value) {
    const clientId = typeof value === 'string' ? value.trim() : '';
    if (!CLIENT_ID_PATTERN.test(clientId)) throw new Error(this.t('pair.client_id.invalid'));
    this.homey.settings.set('clientId', clientId);
    return true;
  }

  // What the account has, before the device list: the devices found, or why there are none
  async check() {
    this.result = undefined;
    try {
      const devices = await this.list();
      return { devices: devices.map((device) => device.name), error: null };
    } catch (error) {
      this.result = undefined;
      return { devices: [], error: error instanceof Error ? error.message : String(error) };
    }
  }

  // The report for the developer, with only the login (no device needs to be added)
  async prepareReport() {
    if (!this.client) throw new Error(this.t('pair.check.no_login'));
    const report = await collectReport(this.client, { appVersion: this.homey.manifest?.version });
    const summary = summarizeReport(report);
    for (const line of summary) this.driver.log(line);
    return { report, summaryLines: summary.length };
  }

}

module.exports = {
  PairSession, modelName, deviceName, checkInstallations,
};
