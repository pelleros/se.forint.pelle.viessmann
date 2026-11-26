// @ts-check

'use strict';

/*
 * vicare-dev-twin-fixture-mode
 *
 * The dev twin's OAuth client in fixture mode (`npm run homey:twin -- <command> --fixture <name>`,
 * see docs/TESTING.md). It answers from one bundled fixture instead of the Viessmann API: any
 * user name and password log in, the installation and features come from the fixture, and
 * commands change the fixture's values locally. Nothing reaches Viessmann, so no account and no
 * API quota are needed.
 *
 * scripts/devTwin.js copies this file into the twin as fixtureMode/FixtureOAuth2Client.js. It
 * must never be in the App Store package: scripts/checkPackage.js fails on the marker in the first
 * line of this comment.
 */

const { OAuth2Token } = require('homey-oauth2app');

const clone = (value) => JSON.parse(JSON.stringify(value));

/**
 * @typedef {object} Fixture
 * @property {string} name
 * @property {{ data: any[] }} features the device's features response
 * @property {object} installations the installations response the device is paired from
 */

/**
 * Sets the value a command writes. The parameter's own property if the feature has one, the
 * set point (`temperature`) for `targetTemperature`, else `value`; activate/deactivate set
 * `active`.
 * @param {any} feature
 * @param {string} command
 * @param {Record<string, any>} body
 */
function applyCommand(feature, command, body) {
  const properties = feature.properties || {};
  feature.properties = properties;
  if (command === 'activate' || command === 'deactivate') {
    properties.active = { type: 'boolean', ...properties.active, value: command === 'activate' };
    return;
  }
  for (const [parameter, value] of Object.entries(body || {})) {
    let property = 'value';
    if (properties[parameter]) property = parameter;
    else if (parameter === 'targetTemperature' && properties.temperature) property = 'temperature';
    properties[property] = { ...properties[property], value };
  }
}

/**
 * The twin's OAuth client class: `BaseClient` (the app's ViessmannOAuth2Client) answering from
 * `fixture`. Every client of the app shares the fixture's state, so a command made from one
 * device or Flow shows up in the next poll.
 * @param {any} BaseClient
 * @param {Fixture} fixture
 */
function createFixtureClient(BaseClient, fixture) {
  const state = clone(fixture.features);
  const token = () => new OAuth2Token({
    access_token: 'fixture-mode', refresh_token: 'fixture-mode', token_type: 'bearer', expires_in: 365 * 24 * 3600,
  });
  // A fresh timestamp on every answer, as from a live installation
  const answer = (features) => ({ data: features.map((feature) => ({ ...clone(feature), timestamp: new Date().toISOString() })) });

  return class FixtureOAuth2Client extends BaseClient {

    static FIXTURE_NAME = fixture.name;

    async onInit() {
      await super.onInit();
      this.log(`Fixture mode: answering from fixture "${fixture.name}", nothing is sent to Viessmann`);
    }

    async onGetTokenByCredentials() {
      this._token = token();
      return this.getToken();
    }

    async onGetTokenByCode() {
      return token();
    }

    async onRefreshToken() {
      this._token = token();
      this.save();
      return this.getToken();
    }

    async getInstallations() {
      return clone(fixture.installations);
    }

    async getGateways() {
      return { data: [] };
    }

    async getDevices() {
      return { data: [] };
    }

    async getGatewayFeatures() {
      return { data: [] };
    }

    // The same features for every device of the installation, as the API sends them with
    // skipDisabled=true (and only the requested ones with a filter)
    /** @param {{ filter?: string }} [request] */
    async getFeatures({ filter } = {}) {
      const requested = typeof filter === 'string' ? filter.split(',') : null;
      return answer(state.data.filter((feature) => feature.isEnabled !== false
        && (!requested || requested.includes(feature.feature))));
    }

    async getFeature({ featureName }) {
      const feature = state.data.find((item) => item.feature === featureName);
      if (!feature) throw new Error(`Fixture mode: the fixture has no feature ${featureName}`);
      return { data: answer([feature]).data[0] };
    }

    async executeCommand({ feature: featureName, command, body }) {
      const feature = state.data.find((item) => item.feature === featureName);
      const descriptor = feature?.commands?.[command];
      if (!descriptor || descriptor.isExecutable === false) {
        throw new Error(`Fixture mode: command ${command} is not available for ${featureName}`);
      }
      applyCommand(feature, command, body);
      this.log(`Fixture mode: ${featureName} ${command}`, body);
      return { data: { success: true, reason: 'COMMAND_EXECUTION_SUCCESS', message: null } };
    }

  };
}

module.exports = { createFixtureClient, applyCommand };
