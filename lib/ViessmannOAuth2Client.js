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

const {
  OAuth2Client, OAuth2Error, OAuth2Token, fetch,
} = require('homey-oauth2app');
const querystring = require('querystring');
const { apiError, tokenError, redact } = require('./apiError');

// The body of a failed token response, as text (or parsed JSON when there is no text())
async function readBody(response) {
  try {
    if (typeof response.text === 'function') return await response.text();
    return await response.json();
  } catch (error) {
    return undefined;
  }
}
const {
  PATHS,
} = require('../drivers/vicare/config');

module.exports = class ViessmannOAuth2Client extends OAuth2Client {

  // Required:
  static API_URL = 'https://api.viessmann-climatesolutions.com/iot/v2';
  static TOKEN_URL = 'https://iam.viessmann-climatesolutions.com/idp/v3/token';
  static AUTHORIZATION_URL = 'https://iam.viessmann-climatesolutions.com/idp/v3/authorize';
  static SCOPES = ['IoT', 'User', 'offline_access'];
  static CLIENT_SECRET = '5M5nhkBfkWZCGfLZYcTL-l7esjPUN7PpZ4rq8k4cmys';
  static CODE_VERIFIER = '6PygdmeK8JKPuuftlkc6q4ceyvjhMM_a_cJrPbcmcLc-SPjx2ZXTYr-SOofPUBydQ3McNYRy7Hibc2L2WtVLJFpOQ~Qbgic455ArKjUz9_UiTLnO6q8A3e.I_fIF8hAo';
  static CLIENT_ID = '';
  // Optional:
  // static REDIRECT_URL = 'https://callback.athom.com/oauth2/callback'; // Default: 'https://callback.athom.com/oauth2/callback'

  // Default timeout for all API calls
  static DEFAULT_TIMEOUT = 30000; // 30 seconds

  async onInit() {
    this.log('Starting OAuth2Client init');
    await super.onInit();
    this._clientId = this.homey.settings.get('clientId');
    this.log('Got clientId from settings:', this._clientId);
  }

  debug(...props) {
    const secrets = [this._token?.access_token, this._token?.refresh_token].filter(Boolean);
    super.debug(...props.map((value) => redact(value, secrets)));
  }

  async onRequestResponse(args) {
    try {
      return await super.onRequestResponse(args);
    } catch (error) {
      // Still 401 after a successful token refresh: the SDK's generic error loses the status.
      // Errors from the refresh itself (onRefreshToken) keep their own classification.
      if (args.didRefreshToken && args.response?.status === 401 && !error.status) {
        throw apiError({ status: 401 });
      }
      throw error;
    }
  }

  // homey-oauth2app 3.7.2 does not pass a timeout from get()/post() on to node-fetch, so a
  // half-open connection would leave a request (and the device's polling) hanging forever.
  // Every API request gets DEFAULT_TIMEOUT here; node-fetch applies it to the response and body.
  async onBuildRequest(args) {
    const request = await super.onBuildRequest(args);
    request.opts.timeout = this.constructor.DEFAULT_TIMEOUT;
    return request;
  }

  async onHandleNotOK({
    body, status, statusText, headers,
  }) {
    this.log('Handling not OK response:', status);
    return apiError({
      body, status, statusText, headers,
    });
  }

  async onIsRateLimited() {
    // A 429 goes to onHandleNotOK like any other error, so that its body (with the time the
    // quota resets) is read and status and Retry-After are kept, instead of the SDK's generic
    // "Rate Limited".
    return false;
  }

  /**
   * Method that handles the creation of the authorization url. The Viessmann API expects code_challenge
   * and code_challenge_method property to be added as query parameter.
   * @param scopes
   * @param state
   * @returns {string}
   */
  onHandleAuthorizationURL({ scopes, state } = {}) {
    try {
      this.log('Starting authorization URL handling');
      this.log('Client ID:', this._clientId);
      this.log('Redirect URL:', this._redirectUrl);

      const scope = this.onHandleAuthorizationURLScopes({ scopes });
      this.log('Generated scope:', scope);

      const query = {
        state,
        client_id: this._clientId,
        redirect_uri: this._redirectUrl,
        scope,
        response_type: 'code',
        code_challenge_method: 'S256',
        code_challenge: this._clientSecret,
      };

      const url = `${this._authorizationUrl}?${querystring.stringify(query)}`;
      this.log('Generated final URL');
      return url;
    } catch (error) {
      this.error('Error in onHandleAuthorizationURL:', error);
      throw error;
    }
  }

  /**
   * Method that exchanges a code for a token with the Viessmann API.
   * @param code
   * @returns {Promise<*>}
   */
  async onGetTokenByCode({ code }) {
    this.log('Getting token by code');
    const body = {
      grant_type: 'authorization_code',
      client_id: this._clientId,
      code,
      redirect_uri: this._redirectUrl,
      code_verifier: this.constructor.CODE_VERIFIER,
    };

    try {
      const response = await fetch(this.constructor.TOKEN_URL, {
        method: 'POST',
        timeout: this.constructor.DEFAULT_TIMEOUT,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: querystring.stringify(body),
      });

      if (!response.ok) {
        this.error('Token response not OK:', response.status);
        throw tokenError({
          status: response.status, statusText: response.statusText, body: await readBody(response), duringLogin: true,
        });
      }

      const token = await this.parseTokenResponse(response);
      this.log('Successfully got token');
      return token;
    } catch (error) {
      this.error('Error getting token:', error);
      throw error;
    }
  }

  /**
   * Method that exchanges a code for a token with the Viessmann API.
   * @param code
   * @returns {Promise<*>}
   */
  async parseTokenResponse(response, previousToken = {}) {
    if (!response.ok) {
      throw tokenError({ status: response.status, statusText: response.statusText, body: await readBody(response) });
    }
    let body;
    try {
      body = await response.json();
    } catch (error) {
      throw new OAuth2Error('Invalid token response; existing credentials were kept');
    }
    if (!body || body.error || typeof body.access_token !== 'string' || !body.access_token.trim()
      || (body.refresh_token !== undefined && (typeof body.refresh_token !== 'string' || !body.refresh_token.trim()))) {
      throw new OAuth2Error('Invalid token response; existing credentials were kept');
    }
    return new OAuth2Token({ ...previousToken, ...body });
  }

  async onRefreshToken() {
    if (!this._token?.refresh_token) {
      throw tokenError({ status: 401, body: { message: 'No refresh token stored' } });
    }
    const response = await fetch(this.constructor.TOKEN_URL, {
      method: 'POST',
      timeout: this.constructor.DEFAULT_TIMEOUT,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this._clientId,
        grant_type: 'refresh_token',
        refresh_token: this._token.refresh_token,
      }),
    });
    const token = await this.parseTokenResponse(response, this._token);
    this._token = token;
    this.save();
    return this.getToken();
  }

  async getInstallations() {
    try {
      const response = await this.get({
        path: '/equipment/installations?includeGateways=true',
      });
      for (const installation of response.data) {
        if (installation.address) {
          installation.address = {};
        }
        if (installation.description) {
          installation.description = 'XXXXX';
        }
      }
      return response;
    } catch (error) {
      this.error('Error in getInstallations:', error);
      throw error;
    }
  }

  /* 
  * Return the available gateway ids for a given installation
  */
  async getGateways() {
    try {
      return await this.get({
        path: '/equipment/gateways',

      });
    } catch (error) {
      this.error('Error in getGateways:', error);
      throw error;
    }
  }

  async getGatewayFeatures({ installationId, gatewaySerial, deviceId }) {
    try {
      return await this.get({
        path: `/features/installations/${installationId}/gateways/${gatewaySerial}/features`,

      });
    } catch (error) {
      this.error('Error in getGatewayFeatures:', error);
      throw error;
    }
  }

  /*
  * Return the available device ids for a given installation and gateway
  */
  async getDevices({ installationId, gatewaySerial }) {
    try {
      return await this.get({
        path: `/equipment/installations/${installationId}/gateways/${gatewaySerial}/devices`,

      });
    } catch (error) {
      this.error('Error in getDevices:', error);
      throw error;
    }
  }

  async getFeatures({
    installationId, gatewaySerial, deviceId, filter,
  }) {
    try {
      if (filter === undefined) {
        return await this.get({
          path: `/features/installations/${installationId}/gateways/${gatewaySerial}/devices/${deviceId}/features?skipDisabled=true`,

        });
      }
      return await this.get({
        path: `/features/installations/${installationId}/gateways/${gatewaySerial}/devices/${deviceId}/features?filter=${filter}&skipDisabled=true`,

      });
    } catch (error) {
      this.error('Error in getFeatures:', error);
      throw error;
    }
  }

  async getFeature({
    installationId, gatewaySerial, deviceId, featureName,
  }) {
    try {
      return await this.get({
        path: `/features/installations/${installationId}/gateways/${gatewaySerial}/devices/${deviceId}/features/${featureName}`,

      });
    } catch (error) {
      this.error('Error in getFeature:', error);
      throw error;
    }
  }

  /*
  * Return the available compressor ids for a given installation, gateway and device
  */
  async getCompressors({ installationId, gatewaySerial, deviceId }) {
    try {
      await this.getFeature({
        installationId,
        gatewaySerial,
        deviceId,
        featureName: PATHS.COMPRESSOR,
      });
    } catch (error) {
      this.error('Error in getCompressors:', error);
      throw error;
    }
  }

  async executeCommand({
    installationId, gatewaySerial, deviceId, feature, command, body,
  }) {
    return this.post({
      path: `/features/installations/${installationId}/gateways/${gatewaySerial}/devices/${deviceId}/features/${feature}/commands/${command}`,
      json: body,

    });
  }

  onHandleAuthorizationURLScopes({ scopes = [] } = {}) {
    this.log('Handling authorization URL scopes');
    return scopes.join(' ');
  }

};
