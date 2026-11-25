/* eslint-disable max-classes-per-file */

'use strict';

// In-memory stand-in for the parts of homey-oauth2app (and the Homey SDK device and driver
// surface) that drivers/vicare uses. Use it with
//   jest.mock('homey-oauth2app', () => require('<path>/test/helpers/fakeHomeyOAuth2App'));
// It deliberately has no `setStore` method, like the real SDK. Timers are recorded, not run.

class OAuth2Error extends Error {}

class FakeOAuth2Device {

  constructor() {
    this.__values = new Map();
    this.__options = new Map();
    this.__listeners = new Map();
    this.__store = {};
    this.__settings = {};
    this.__data = {};
    this.__available = true;

    this.log = jest.fn();
    this.error = jest.fn();
    this.setAvailable = jest.fn(async () => {
      this.__available = true;
    });
    this.setUnavailable = jest.fn(async () => {
      this.__available = false;
    });
    this.addCapability = jest.fn(async (id) => {
      if (!this.__values.has(id)) this.__values.set(id, null);
    });
    this.removeCapability = jest.fn(async (id) => {
      this.__values.delete(id);
      this.__options.delete(id);
    });
    this.setCapabilityOptions = jest.fn(async (id, options) => {
      this.__options.set(id, options);
    });
    this.setCapabilityValue = jest.fn(async (id, value) => {
      if (!this.__values.has(id)) throw new Error(`Invalid Capability: ${id}`);
      this.__values.set(id, value);
    });
    this.registerCapabilityListener = jest.fn((id, listener) => {
      if (!this.__values.has(id)) throw new Error(`Invalid Capability: ${id}`);
      this.__listeners.set(id, listener);
    });
    this.setStoreValue = jest.fn(async (key, value) => {
      this.__store[key] = value;
    });
  }

  getAvailable() {
    return this.__available;
  }

  getCapabilities() {
    return [...this.__values.keys()];
  }

  hasCapability(id) {
    return this.__values.has(id);
  }

  getCapabilityValue(id) {
    return this.__values.has(id) ? this.__values.get(id) : null;
  }

  getCapabilityOptions(id) {
    if (!this.__values.has(id)) throw new Error(`Invalid Capability: ${id}`);
    return this.__options.get(id) || {};
  }

  getStoreValue(key) {
    return this.__store[key];
  }

  getStore() {
    return { ...this.__store };
  }

  getSetting(key) {
    return this.__settings[key];
  }

  getData() {
    return this.__data;
  }

}

class FakeOAuth2Driver {

  constructor() {
    this.log = jest.fn();
    this.error = jest.fn();
    let nextTimer = 0;
    this.homey = {
      setTimeout: jest.fn(() => {
        nextTimer += 1;
        return { timer: nextTimer };
      }),
      clearTimeout: jest.fn(),
      error: jest.fn(),
      manifest: { version: '1.0.15' },
    };
    this.getDevices = jest.fn(() => []);
  }

}

module.exports = {
  OAuth2Device: FakeOAuth2Device,
  OAuth2Driver: FakeOAuth2Driver,
  OAuth2Error,
};
