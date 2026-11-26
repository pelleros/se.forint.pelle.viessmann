'use strict';

// A device on the in-memory Homey fake that has polled one of our fixtures once: it has the
// capabilities, values and command metadata of that installation, an OAuth client whose
// commands succeed (and are recorded), and Homey timers that tests run by hand. Use it with
//   jest.mock('homey-oauth2app', () => require('<path>/test/helpers/fakeHomeyOAuth2App'));

const fs = require('fs');
const path = require('path');

const FIXTURES_DIR = path.join(__dirname, '../fixtures');

const clone = (value) => JSON.parse(JSON.stringify(value));
const readFixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8'));

/**
 * Homey's timers, recorded: `run()` runs the timers that are due at `now` (in order).
 * @param {{ now: number }} clock
 */
function fakeTimers(clock) {
  let next = 0;
  const timers = new Map();
  return {
    timers,
    setTimeout: jest.fn((fn, ms) => {
      next += 1;
      timers.set(next, { fn, at: clock.now + ms });
      return next;
    }),
    clearTimeout: jest.fn((id) => timers.delete(id)),
    async run() {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= clock.now).sort(([, a], [, b]) => a.at - b.at);
      for (const [id, timer] of due) {
        timers.delete(id);
        timer.fn();
      }
      // Let the restore chains finish
      for (let i = 0; i < 20; i++) await Promise.resolve();
    },
  };
}

/**
 * @param {object} options
 * @param {string} [options.fixture] a *_features.json file in test/fixtures
 * @param {string[]} [options.roles]
 * @param {{ now: number }} [options.clock]
 * @param {string} [options.heatingCircuitId]
 */
async function polledFixtureDevice({
  fixture = 'vitocal_222_features.json',
  roles = ['type:heating;integrated', 'type:dhw;integrated', 'type:heatpump'],
  clock = { now: Date.parse('2026-11-26T12:00:00Z') },
  heatingCircuitId = '0',
} = {}) {
  // Required here, after the test has mocked homey-oauth2app
  // eslint-disable-next-line global-require
  const ViessmannDevice = require('../../drivers/vicare/device');
  const dump = readFixture(fixture);
  const device = new ViessmannDevice();
  device.driver = { getTriggerCard: jest.fn(() => null), _calculatePollInterval: () => 2 * 60 * 1000 };
  device._installationId = 900001;
  device._gatewaySerial = '9999000000000001';
  device._deviceId = '0';
  device._heatingCircuitId = heatingCircuitId;
  device._roles = roles;
  device._features = dump.data.filter((feature) => feature.isEnabled).map((feature) => feature.feature);
  device.oAuth2Client = {
    executeCommand: jest.fn(async () => ({ data: { success: true } })),
    getFeatures: jest.fn(async ({ filter } = {}) => {
      if (filter === undefined) return clone(dump);
      const requested = filter.split(',');
      return { ...clone(dump), data: dump.data.filter((item) => requested.includes(item.feature)).map(clone) };
    }),
  };
  const timers = fakeTimers(clock);
  device.homey = { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout };
  await device.initializeCapabilities();
  // A regular poll: only the configured paths
  await device.onFeaturesUpdated(await device.getFeatures({ useFilter: true }), false);
  device.setCapabilityValue.mockClear();
  device.oAuth2Client.getFeatures.mockClear();
  return {
    device, dump, timers, clock,
  };
}

module.exports = {
  polledFixtureDevice, fakeTimers, readFixture, clone,
};
