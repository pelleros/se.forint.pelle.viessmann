'use strict';

// Extra devices (heating circuit, hot water, room) on the in-memory Homey fake: the ViCare driver
// that polls, the extra drivers, devices made from the device list entries of a fixture, and an
// OAuth client that answers from the fixture (filtered like the API) and records commands. Timers
// are recorded, not run. Use it with
//   jest.mock('homey-oauth2app', () => require('<path>/test/helpers/fakeHomeyOAuth2App'));

const fs = require('fs');
const path = require('path');

const APP_VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '../../.homeycompose/app.json'), 'utf8')).version;

const clone = (value) => JSON.parse(JSON.stringify(value));

// Returns only the requested features, like the API does for ?filter=
function respond(dump, filter) {
  if (filter === undefined) return clone(dump);
  const requested = filter.split(',');
  return { ...clone(dump), data: dump.data.filter((feature) => requested.includes(feature.feature)).map(clone) };
}

/**
 * An OAuth client answering from a features dump (or from `dumps` per device id).
 * @param {{ data: any[] }} dump
 */
function fixtureClient(dump) {
  return {
    getFeatures: jest.fn(async ({ filter } = {}) => respond(dump, filter)),
    executeCommand: jest.fn(async () => ({ data: { success: true } })),
  };
}

// The extra drivers by kind, each with its device class
function extraClasses() {
  /* eslint-disable global-require */
  return {
    circuit: { driverId: 'heating-circuit', Driver: require('../../drivers/heating-circuit/driver'), Device: require('../../drivers/heating-circuit/device') },
    hotWater: { driverId: 'hot-water', Driver: require('../../drivers/hot-water/driver'), Device: require('../../drivers/hot-water/device') },
    room: { driverId: 'room', Driver: require('../../drivers/room/driver'), Device: require('../../drivers/room/device') },
  };
  /* eslint-enable global-require */
}

/**
 * A Homey with the ViCare driver and the extra drivers.
 */
function extraHomey() {
  /* eslint-disable-next-line global-require */
  const ViessmannDriver = require('../../drivers/vicare/driver');
  const drivers = new Map();
  let nextTimer = 0;
  const homey = {
    setTimeout: jest.fn(() => {
      nextTimer += 1;
      return { timer: nextTimer };
    }),
    clearTimeout: jest.fn(),
    error: jest.fn(),
    manifest: { version: APP_VERSION },
    notifications: { createNotification: jest.fn(async () => {}) },
    drivers: {
      getDriver: (id) => {
        const driver = drivers.get(id);
        if (!driver) throw new Error(`Driver not found: ${id}`);
        return driver;
      },
    },
  };
  const vicare = new ViessmannDriver();
  vicare.homey = homey;
  drivers.set('vicare', vicare);
  const extra = {};
  for (const [kind, { driverId, Driver }] of Object.entries(extraClasses())) {
    const driver = new Driver();
    driver.homey = homey;
    drivers.set(driverId, driver);
    extra[kind] = driver;
  }
  return { homey, vicare, extra };
}

/**
 * Makes a device of a kind from a device list entry (as Homey does when it is added: with the
 * entry's capabilities and options) and starts it.
 * @param {ReturnType<typeof extraHomey>} setup
 * @param {'circuit' | 'hotWater' | 'room'} kind
 * @param {any} entry
 * @param {any} client
 * @param {{ sessionId?: string }} [options]
 */
async function addExtraDevice(setup, kind, entry, client, { sessionId = 'session-1' } = {}) {
  const { Device } = extraClasses()[kind];
  const device = new Device();
  device.driver = setup.extra[kind];
  device.homey = setup.homey;
  device.__store = clone({ ...entry.store, OAuth2SessionId: sessionId });
  device.__data = clone(entry.data);
  device.getName = () => entry.name;
  device.setWarning = jest.fn(async () => {});
  device.unsetWarning = jest.fn(async () => {});
  for (const capability of entry.capabilities) {
    await device.addCapability(capability);
    await device.setCapabilityOptions(capability, clone(entry.capabilitiesOptions[capability]));
  }
  device.addCapability.mockClear();
  device.setCapabilityOptions.mockClear();
  device.oAuth2Client = client;
  await device.onOAuth2Init();
  return device;
}

module.exports = {
  APP_VERSION, clone, respond, fixtureClient, extraClasses, extraHomey, addExtraDevice,
};
