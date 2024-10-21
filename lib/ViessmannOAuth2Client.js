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

const Homey = require('homey');
const {
  OAuth2Client, OAuth2Error, OAuth2Token, fetch,
} = require('homey-oauth2app');
const querystring = require('querystring');

module.exports = class ViessmannOAuth2Client extends OAuth2Client {

  // Required:
  static API_URL = 'https://api.viessmann.com/iot/v2';
  static TOKEN_URL = 'https://iam.viessmann.com/idp/v3/token';
  static AUTHORIZATION_URL = 'https://iam.viessmann.com/idp/v3/authorize';
  static SCOPES = ['IoT User offline_access'];

  // Optional:
  // static REDIRECT_URL = 'https://callback.athom.com/oauth2/callback'; // Default: 'https://callback.athom.com/oauth2/callback'

  async onInit() {
    this._clientId = this.homey.settings.get('clientId');
  }

  async onHandleNotOK({ body }) {
    this.log('onHandleNotOK::body', body);
    throw new OAuth2Error(body.error);
  }

  /**
   * Method that handles the creation of the authorization url. The Viessmann API expects code_challenge
   * and code_challenge_method property to be added as query parameter.
   * @param scopes
   * @param state
   * @returns {string}
   */
  onHandleAuthorizationURL({ scopes, state } = {}) {
    this.log('MyBrandOAuth2Client::onHandleAuthorizationURL called with clientid: ', this._clientId);
    const query = {
      state,
      client_id: this._clientId,
      redirect_uri: this._redirectUrl,
      scope: this.onHandleAuthorizationURLScopes({ scopes }),
      response_type: 'code',
      code_challenge_method: 'S256',
      code_challenge: this._clientSecret,
    };

    return `${this._authorizationUrl}?${querystring.stringify(query)}`;
  }

  /**
   * Method that exchanges a code for a token with the Viessmann API.
   * @param code
   * @returns {Promise<*>}
   */
  async onGetTokenByCode({ code }) {
    //*
    const body = new URLSearchParams();
    body.append('grant_type', 'authorization_code');
    body.append('client_id', this._clientId);
    body.append('client_secret', this._clientSecret);
    body.append('code', code);
    body.append('redirect_uri', this._redirectUrl);
    body.append('code_verifier', Homey.env.CODE_VERIFIER);

    const response = await fetch(this._tokenUrl, {
      body,
      method: 'POST',
    });
    if (!response.ok) {
      return this.onHandleGetTokenByCodeError({ response });
    }

    this._token = await this.onHandleGetTokenByCodeResponse({ response });
    return this.getToken();
  }

  /**
   * Method that exchanges a code for a token with the Viessmann API.
   * @param code
   * @returns {Promise<*>}
   */
  async onRefreshToken() {
    if (process.env.DEBUG) {
      this.log(`onRefreshToken::refreshing token: ${this._token.access_token}`);
    }
    const res = await fetch(this._tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this._clientId,
        grant_type: 'refresh_token',
        refresh_token: this._token.refresh_token,
      }),
    }).catch((err) => {
      this.log('Failed to refresh token:', err);
      this.error(err);
    });

    const body = await res.json();
    const newToken = new OAuth2Token(body);
    this._token = newToken;
    this.save();
    if (process.env.DEBUG) {
      this.log('onRefreshToken::response body:', body);
      this.log('access_token', newToken.access_token);
      this.log('refresh_token', newToken.refresh_token);
    }
    return this.getToken();
  }

  async getInstallations() {
    return this.get({
      path: '/equipment/installations',
    });
  }

  /* 
  * Return the available gateway ids for a given installation
  */
  async getGateways() {
    return this.get({
      path: '/equipment/gateways',
    });
  }

  async getGatewayFeatures({ installationId, gatewaySerial, deviceId }) {
    return this.get({
      path: `/features/installations/${installationId}/gateways/${gatewaySerial}/features`,
    });
  }

  /*
  * Return the available device ids for a given installation and gateway
  */
  async getDevices({ installationId, gatewaySerial }) {
    return this.get({
      path: `/equipment/installations/${installationId}/gateways/${gatewaySerial}/devices`,
    });
  }

  async getFeatures({
    installationId, gatewaySerial, deviceId, filter,
  }) {
    return this.get({
      path: `/features/installations/${installationId}/gateways/${gatewaySerial}/devices/${deviceId}/features?filter=${filter}`,
    });
  }

  async getFeature({
    installationId, gatewaySerial, deviceId, featureName,
  }) {
    return this.get({
      path: `/features/installations/${installationId}/gateways/${gatewaySerial}/devices/${deviceId}/features/${featureName}`,
    });
  }

  /*
  * Return the available compressor ids for a given installation, gateway and device
  */
  async getCompressors({ installationId, gatewaySerial, deviceId }) {
    await this.getFeature({
      installationId, gatewaySerial, deviceId, featureName: 'heating.compressors',
    });
  }

  async setDhwTemp({
    installationId, gatewaySerial, deviceId, value,
  }) {
    return this.post({
      path: `/features/installations/${installationId}/gateways/${gatewaySerial}/devices/${deviceId}/features/heating.dhw.temperature.main/commands/setTargetTemperature`,
      json: { temperature: value },
    });
  }

  async setDhwOneTimeCharge({
    installationId, gatewaySerial, deviceId, value,
  }) {
    if (process.env.DEBUG) {
      this.log('setDhwOneTimeCharge::value', `/features/installations/${installationId}/gateways/${gatewaySerial}/devices/${deviceId}/features/heating.dhw.oneTimeCharge/commands/${value}`);
    }
    return this.post({
      path: `/features/installations/${installationId}/gateways/${gatewaySerial}/devices/${deviceId}/features/heating.dhw.oneTimeCharge/commands/${value}`,
      json: { },
    });
  }

  async setHeatingTemp({
    installationId, gatewaySerial, deviceId, value,
  }) {
    return this.post({
      path: `/features/installations/${installationId}/gateways/${gatewaySerial}/devices/${deviceId}/features/heating.circuits.0.operating.programs.normal/commands/setTemperature`,
      json: { targetTemperature: value },
    });
  }

  async setMainOperatingMode({
    installationId, gatewaySerial, deviceId, value,
  }) {
    return this.post({
      path: `/features/installations/${installationId}/gateways/${gatewaySerial}/devices/${deviceId}/features/heating.circuits.0.operating.modes.active/commands/setMode`,
      json: { mode: value },
    });
  }

};
