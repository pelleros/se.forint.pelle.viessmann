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
    this.log(`onRefreshToken::refreshing token: ${this._token.access_token}`);
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
    this.log('onRefreshToken::response body:', body);
    const newToken = new OAuth2Token(body);

    this.log('access_token', newToken.access_token);
    this.log('refresh_token', newToken.refresh_token);
    this._token = newToken;
    this.save();
    return this.getToken();
  }

  async getInstallations() {
    return this.get({
      path: '/equipment/installations',
    });
  }

  async getGatewaySerial() {
    return this.get({
      path: '/equipment/gateways',
    });
  }

  async getDeviceId({ installationId, gatewaySerial }) {
    return this.get({
      path: `/equipment/installations/${installationId}/gateways/${gatewaySerial}/devices`,
    });
  }

  async getHotWaterTemp({ installationId, gatewaySerial, deviceId }) {
    return this.get({
      path: `/features/installations/${installationId}/gateways/${gatewaySerial}/devices/${deviceId}/features/heating.dhw.sensors.temperature.hotWaterStorage`,
    });
  }

  async getGatewayFeatures({ installationId, gatewaySerial, deviceId }) {
    return this.get({
      path: `/features/installations/${installationId}/gateways/${gatewaySerial}/features`,
    });
  }

  async getDhwPower({ installationId, gatewaySerial, deviceId }) {
    return this.get({
      path: `/features/installations/${installationId}/gateways/${gatewaySerial}/devices/${deviceId}/features/heating.power.consumption.dhw`,
    });
  }

  async getFeatures({ installationId, gatewaySerial, deviceId }) {
    return this.get({
      path: `/features/installations/${installationId}/gateways/${gatewaySerial}/devices/${deviceId}/features`,
    });
  }

  async getThings({ color }) {
    return this.get({
      path: '/things',
      query: { color },
    });
  }

  async updateThing({ id, thing }) {
    return this.put({
      path: `/thing/${id}`,
      json: { thing },
    });
  }

};
