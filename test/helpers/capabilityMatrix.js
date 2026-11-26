'use strict';

// The capability matrix: for every fixture device, what a newly paired device gets on the
// current code (its capabilities in the order it gets them, their options and the Flow cards
// Homey offers on it), written as a compact, diff-friendly golden file.
//
// Needs the in-memory Homey fake; call this in the test file before requiring this helper:
//   jest.mock('homey-oauth2app', () => require('<path>/test/helpers/fakeHomeyOAuth2App'));

const fs = require('fs');
const path = require('path');

const ViessmannDriver = require('../../drivers/vicare/driver');
const ViessmannDevice = require('../../drivers/vicare/device');
const { getCapabilityOptions } = require('../../drivers/vicare/config');
const flowCompose = require('../../drivers/vicare/driver.flow.compose.json');
const { loadFixtureDevices } = require('./fixtureDevices');

const MATRIX_FILE = path.join(__dirname, '../../drivers/vicare/__tests__/capabilityMatrix.json');
const APP_VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '../../.homeycompose/app.json'), 'utf8')).version;

const clone = (value) => JSON.parse(JSON.stringify(value));

// Returns only the requested features, like the API does for ?filter=
function respond(dump, filter) {
  if (filter === undefined) return clone(dump);
  const requested = filter.split(',');
  return { ...clone(dump), data: dump.data.filter((feature) => requested.includes(feature.feature)).map(clone) };
}

/**
 * True when a device with these capabilities matches a Flow card's `$filter`
 * (`capabilities=a|b`: any of them; several keys joined with `&`: all of them).
 * @param {string | undefined} filter
 * @param {string[]} capabilities
 */
function matchesFilter(filter, capabilities) {
  if (!filter) return true;
  return [...new URLSearchParams(filter)].every(([key, value]) => {
    if (key !== 'capabilities') throw new Error(`Unsupported $filter key "${key}" in the capability matrix`);
    return value.split('|').some((capability) => capabilities.includes(capability));
  });
}

/**
 * The Flow cards Homey offers on a device with these capabilities, as "group/id".
 * @param {string[]} capabilities
 */
function flowCardsFor(capabilities) {
  return ['conditions', 'actions', 'triggers'].flatMap((group) => (flowCompose[group] || [])
    .filter((card) => matchesFilter(card.$filter, capabilities))
    .map((card) => `${group.replace(/s$/, '')}/${card.id}`));
}

/**
 * The option keys whose value on the device differs from the configured options (missing
 * keys included as null), or undefined when they are the same.
 */
function optionDifferences(actual, configured) {
  const keys = [...new Set([...Object.keys(configured), ...Object.keys(actual)])];
  const changed = keys.filter((key) => JSON.stringify(actual[key]) !== JSON.stringify(configured[key]));
  if (changed.length === 0) return undefined;
  return Object.fromEntries(changed.map((key) => [key, actual[key] === undefined ? null : actual[key]]));
}

/**
 * Pairs one fixture device the way pairing does today and starts it (including its first,
 * filtered poll), then reads what it has.
 * @param {import('./fixtureDevices').FixtureDevice} fixture
 */
async function pairFixture({ features, identity }) {
  const driver = new ViessmannDriver();
  driver.homey.manifest = { version: APP_VERSION };
  const metadata = driver._readDeviceMetadata(clone(features));
  const device = new ViessmannDevice();
  device.driver = driver;
  device.__store = clone({
    installationId: identity.installationId,
    gatewaySerial: identity.gatewaySerial,
    deviceId: identity.deviceId,
    roles: identity.roles,
    ...metadata,
    version: APP_VERSION,
  });
  device.__data = { id: `${identity.installationId}-${identity.gatewaySerial}-${identity.deviceId}` };
  device.__settings = { heatingCircuit: 'auto' };
  device.oAuth2Client = {
    getFeatures: jest.fn(async ({ filter }) => respond(features, filter)),
    executeCommand: jest.fn(async () => ({ data: { success: true } })),
  };
  device.homey = { __: (key) => key };
  await device.onOAuth2Init();
  await driver._stopPolling(device.getPollingKey());
  return device;
}

/**
 * The matrix entry of one fixture device.
 * @param {import('./fixtureDevices').FixtureDevice} fixture
 */
async function deviceEntry(fixture) {
  const device = await pairFixture(fixture);
  const capabilities = device.getCapabilities();
  const options = {};
  for (const capability of capabilities) {
    const differences = optionDifferences(device.getCapabilityOptions(capability), getCapabilityOptions(capability));
    if (differences) options[capability] = differences;
  }
  return {
    circuit: device.getStoreValue('heatingCircuitId'),
    capabilities,
    options,
    flowCards: flowCardsFor(capabilities),
  };
}

/**
 * The whole matrix: the configured options of every capability a fixture device gets, once,
 * and per fixture device what it gets.
 */
async function buildMatrix() {
  const random = jest.spyOn(Math, 'random').mockReturnValue(0.5); // never the extended poll
  try {
    const devices = {};
    for (const fixture of loadFixtureDevices()) devices[fixture.name] = await deviceEntry(fixture);
    const used = [...new Set(Object.values(devices).flatMap((entry) => entry.capabilities))].sort();
    return {
      configuredOptions: Object.fromEntries(used.map((capability) => [capability, getCapabilityOptions(capability)])),
      devices,
    };
  } finally {
    random.mockRestore();
  }
}

// One item per line, small objects on one line: a change shows up as a few lines in a diff
function formatMatrix({ configuredOptions, devices }) {
  const json = (value) => JSON.stringify(value);
  const list = (items, indent) => (items.length === 0 ? '[]'
    : `[\n${items.map((item) => `${indent}  ${json(item)}`).join(',\n')}\n${indent}]`);
  const map = (object, indent) => (Object.keys(object).length === 0 ? '{}'
    : `{\n${Object.entries(object).map(([key, value]) => `${indent}  ${json(key)}: ${json(value)}`).join(',\n')}\n${indent}}`);
  const lines = [
    '{',
    `  "_comment": ${list([
      'GENERATED by `npm run matrix` (scripts/updateCapabilityMatrix.js); do not edit by hand.',
      'Per fixture device: the heating circuit pairing picks, the capabilities a newly paired device gets (in the',
      'order it gets them), their options where they differ from configuredOptions, and the Flow cards Homey',
      'offers on it. Every fixture is paired as a heating device, also those the app would not list.',
    ], '  ')},`,
    `  "configuredOptions": ${map(configuredOptions, '  ')},`,
    '  "devices": {',
    Object.entries(devices).map(([name, entry]) => [
      `    ${json(name)}: {`,
      `      "circuit": ${json(entry.circuit)},`,
      `      "capabilities": ${list(entry.capabilities, '      ')},`,
      `      "options": ${map(entry.options, '      ')},`,
      `      "flowCards": ${list(entry.flowCards, '      ')}`,
      '    }',
    ].join('\n')).join(',\n'),
    '  }',
    '}',
    '',
  ];
  return lines.join('\n');
}

module.exports = {
  MATRIX_FILE, buildMatrix, formatMatrix, matchesFilter, flowCardsFor, optionDifferences,
};
