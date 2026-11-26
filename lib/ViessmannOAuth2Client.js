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

const crypto = require('crypto');
const { OAuth2Client, OAuth2Error, OAuth2Token } = require('homey-oauth2app');
const querystring = require('querystring');
const { apiError, tokenError, redact } = require('./apiError');
const { fetchWithTimeout } = require('./http');
const { maskId, maskForLog } = require('./logPrivacy');

/**
 * A new PKCE code verifier (RFC 7636): 32 random bytes, base64url (43 characters).
 * @returns {string}
 */
function createCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * The S256 code challenge of a code verifier.
 * @param {string} verifier
 * @returns {string}
 */
function codeChallengeS256(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

/**
 * The body of a failed token response, as text (or parsed JSON when there is no text()).
 * @param {any} response
 */
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

  /** @type {string | undefined} the PKCE code verifier of the login in progress */
  _codeVerifier;

  // Required:
  static API_URL = 'https://api.viessmann-climatesolutions.com/iot/v2';
  static TOKEN_URL = 'https://iam.viessmann-climatesolutions.com/idp/v3/token';
  static AUTHORIZATION_URL = 'https://iam.viessmann-climatesolutions.com/idp/v3/authorize';
  static SCOPES = ['IoT', 'User', 'offline_access'];
  // A public client: no secret, PKCE with a new code verifier per login. homey-oauth2app needs
  // a string here.
  static CLIENT_SECRET = '';
  // Every user enters their own Client ID in the app settings (read in onInit)
  static CLIENT_ID = '';
  // Optional:
  // static REDIRECT_URL = 'https://callback.athom.com/oauth2/callback'; // Default: 'https://callback.athom.com/oauth2/callback'

  // Default timeout for all API calls
  static DEFAULT_TIMEOUT = 30000; // 30 seconds

  async onInit() {
    this.log('Starting OAuth2Client init');
    await super.onInit();
    this._clientId = this.homey.settings.get('clientId');
    this.log('Got clientId from settings:', maskId(this._clientId));
  }

  // Debug output (homey-oauth2app logs every request) without tokens, and with the Client ID,
  // installation ids and gateway serials masked
  debug(...props) {
    const secrets = [this._token?.access_token, this._token?.refresh_token, this._codeVerifier].filter(Boolean);
    super.debug(...props.map((value) => maskForLog(redact(value, secrets), [this._clientId])));
  }

  /*
    homey-oauth2app 3.7's request flow, with the global fetch (see lib/http.js) instead of its
    node-fetch. A token refresh in progress is awaited before the request is built, so that the
    request carries the new token.
  */
  async _executeRequest(req, didRefreshToken = false) {
    if (this._refreshingToken) await this._refreshingToken;
    const { url, opts } = await this.onBuildRequest(req);

    this.debug('[req]', opts.method, url);
    for (const key of Object.keys(opts.headers)) {
      this.debug('[req]', `${key}: ${opts.headers[key]}`);
    }
    if (opts.body) this.debug('[req]', opts.body);

    let response;
    try {
      response = await fetchWithTimeout(url, opts);
    } catch (err) {
      return this.onRequestError({
        req, url, opts, err,
      });
    }
    return this.onRequestResponse({
      req, url, opts, response, didRefreshToken,
    });
  }

  async onRequestResponse(args) {
    try {
      return await super.onRequestResponse(args);
    } catch (error) {
      // Still 401 after a successful token refresh: the SDK's generic error loses the status.
      // Errors from the refresh itself (onRefreshToken) keep their own classification.
      if (args.didRefreshToken && args.response?.status === 401 && !(/** @type {any} */ (error)).status) {
        throw apiError({ status: 401 });
      }
      throw error;
    }
  }

  // A half-open connection must not leave a request (and the device's polling) hanging
  // forever: every API request gets DEFAULT_TIMEOUT, for the response and its body.
  async onBuildRequest(args) {
    const request = await super.onBuildRequest(args);
    request.opts.timeout = /** @type {typeof ViessmannOAuth2Client} */ (this.constructor).DEFAULT_TIMEOUT;
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
   * The authorization URL of a new login, with PKCE: a new code verifier for every login, whose
   * S256 challenge goes into the URL. The same client exchanges the code (onGetTokenByCode),
   * both while pairing and in Repair. Tokens of existing sessions are refreshed without it.
   * @param {{ scopes?: string[], state?: string }} [args]
   * @returns {string}
   */
  onHandleAuthorizationURL({ scopes, state } = {}) {
    try {
      this.log('Starting authorization URL handling');
      this.log('Client ID:', maskId(this._clientId));
      this.log('Redirect URL:', this._redirectUrl);

      const scope = this.onHandleAuthorizationURLScopes({ scopes });
      this.log('Generated scope:', scope);

      this._codeVerifier = createCodeVerifier();
      const query = {
        state,
        client_id: this._clientId,
        redirect_uri: this._redirectUrl,
        scope,
        response_type: 'code',
        code_challenge_method: 'S256',
        code_challenge: codeChallengeS256(this._codeVerifier),
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
   * Exchanges the code of a login for a token, with the code verifier of that login. A code
   * verifier is used once.
   * @param {{ code: string }} args
   * @returns {Promise<OAuth2Token>}
   */
  async onGetTokenByCode({ code }) {
    this.log('Getting token by code');
    const verifier = this._codeVerifier;
    this._codeVerifier = undefined;
    if (!verifier) {
      throw new OAuth2Error('This login was not started here (no PKCE code verifier); start adding or repairing the device again');
    }
    const body = {
      grant_type: 'authorization_code',
      client_id: this._clientId,
      code,
      redirect_uri: this._redirectUrl,
      code_verifier: verifier,
    };

    try {
      const response = await fetchWithTimeout(/** @type {typeof ViessmannOAuth2Client} */ (this.constructor).TOKEN_URL, {
        method: 'POST',
        timeout: /** @type {typeof ViessmannOAuth2Client} */ (this.constructor).DEFAULT_TIMEOUT,
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
   * The token from a token response, merged into the previous token (so a response without a
   * refresh token keeps the old one). Anything but a valid access token is an error, and the
   * existing credentials stay.
   * @param {any} response
   * @param {object} [previousToken]
   * @returns {Promise<OAuth2Token>}
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
    const response = await fetchWithTimeout(/** @type {typeof ViessmannOAuth2Client} */ (this.constructor).TOKEN_URL, {
      method: 'POST',
      timeout: /** @type {typeof ViessmannOAuth2Client} */ (this.constructor).DEFAULT_TIMEOUT,
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

  // The response as the API sends it, with real ids, which pairing needs. The troubleshooting
  // Web API (api.js) anonymizes it before it reaches the settings page.
  async getInstallations() {
    try {
      return await this.get({
        path: '/equipment/installations?includeGateways=true',
      });
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

module.exports.createCodeVerifier = createCodeVerifier;
module.exports.codeChallengeS256 = codeChallengeS256;
