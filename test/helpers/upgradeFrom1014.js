'use strict';

// Simulates the update from 1.0.14: a device store built the way 1.0.14 paired a device, with
// the capabilities 1.0.14 gave it, starts on the current code. The 1.0.14 versions of the code
// that shaped a paired device are frozen here, so the simulation keeps describing what is
// installed on users' Homeys.
//
// Needs the in-memory Homey fake; call this in the test file before requiring this helper:
//   jest.mock('homey-oauth2app', () => require('<path>/test/helpers/fakeHomeyOAuth2App'));

const ViessmannDriver = require('../../drivers/vicare/driver');
const ViessmannDevice = require('../../drivers/vicare/device');
const { apiError } = require('../../lib/apiError');
const {
  FEATURES, PATHS, DERIVED, getAllCapabilities,
} = require('../../drivers/vicare/config');
const { effectiveRoles, inferRoles } = require('../../drivers/vicare/roles');

const clone = (value) => JSON.parse(JSON.stringify(value));

// drivers/vicare/driver.js _getEnabledFeaturesAndOpModes in 1.0.14
function pairedStore1014(response) {
  const features = [];
  const constraints = {};
  for (const feature of response.data) {
    if (feature.isEnabled && feature.properties?.status?.value !== 'notConnected') {
      features.push(feature.feature);
      if (feature.commands) {
        constraints[feature.feature] = {};
        Object.values(feature.commands).forEach((command) => {
          Object.entries(command.params || {}).forEach(([paramName, param]) => {
            if (param.constraints) constraints[feature.feature][paramName] = param.constraints;
          });
        });
      }
    }
  }
  const operatingModes = [];
  try {
    const mainOpMode = response.data.find((item) => item.feature === 'heating.circuits.0.operating.modes.active');
    if (mainOpMode?.isEnabled) {
      const formatString = (str) => str.replace(/([A-Z])/g, ' $1')
        .replace(/^./, (char) => char.toUpperCase())
        .replace(/Dhw/g, 'DHW')
        .trim();
      for (const mode of mainOpMode.commands.setMode.params.mode.constraints.enum) {
        operatingModes.push({ id: mode, title: { en: formatString(mode) } });
      }
    }
  } catch (err) {
    // not critical in 1.0.14 either
  }
  return { features, constraints, operatingModes };
}

// The feature paths config.js mapped in 1.0.14. Their capabilities and roles have not changed
// since; paths added later must not count as capabilities a 1.0.14 device had.
const PATHS_1014 = Object.freeze([
  'heating.dhw.sensors.temperature.dhwCylinder',
  'heating.dhw.temperature.main',
  'heating.dhw.temperature.temp2',
  'heating.circuits.0.operating.programs.normal',
  'heating.dhw.oneTimeCharge',
  'heating.circuits.0.operating.modes.active',
  'heating.sensors.temperature.outside',
  'heating.circuits.0.sensors.temperature.room',
  'heating.circuits.0.temperature',
  'heating.circuits.0.sensors.temperature.supply',
  'heating.bufferCylinder.sensors.temperature.main',
  'heating.sensors.temperature.return',
  'heating.primaryCircuit.sensors.temperature.supply',
  'heating.primaryCircuit.sensors.temperature.return',
  'heating.secondaryCircuit.sensors.temperature.supply',
  'heating.boiler.sensors.temperature.main',
  'heating.boiler.sensors.temperature.commonSupply',
  'heating.compressors.0',
  'heating.compressors.0.statistics',
  'heating.burners.0',
  'heating.burners.0.modulation',
  'heating.burners.0.statistics',
  'fuelCell.sensors.temperature.return',
  'fuelCell.sensors.temperature.supply',
  'fuelCell.statistics',
  'fuelCell.operating.phase',
  'fuelCell.operating.modes.active',
]);

// The capabilities of every stored feature that passes the role check: what
// initializeCapabilities gives the device, with the given feature paths mapped. The current
// code checks the roles from drivers/vicare/roles.js (aliases, and roles inferred from the
// features when the device reports no role tag); 1.0.14 checked the stored roles as they are.
// `storedRolesOnly` is 1.0.14: it had no computed capabilities and none that every device gets.
// With `derived`, the derived capabilities (2.0.0) whose source is stored and allowed are added.
function capabilitiesFor({ features, roles }, featurePaths = Object.values(PATHS), { storedRolesOnly = false, derived = true } = {}) {
  const allowed = storedRolesOnly ? roles : effectiveRoles(roles, inferRoles(features));
  const passes = (featurePath) => {
    const { requireRole, group } = FEATURES[featurePath];
    return features.includes(featurePath) && !group && (!requireRole || allowed.includes(requireRole));
  };
  const capabilities = new Set();
  for (const featurePath of featurePaths) {
    const { requireRole, alwaysAdd, group } = FEATURES[featurePath];
    const available = features.includes(featurePath) || (alwaysAdd && !storedRolesOnly);
    // Optional groups (diagnostic values) are off until the user turns them on
    if (available && !group && (!requireRole || allowed.includes(requireRole))) {
      getAllCapabilities(featurePath).filter((capability) => !(storedRolesOnly && capability.computed))
        .forEach((capability) => capabilities.add(capability.capabilityName));
    }
  }
  for (const capability of derived ? DERIVED : []) {
    if ((!capability.available || capability.available(features)) && capability.sources.some(passes)) {
      capabilities.add(capability.capabilityName);
    }
  }
  return [...capabilities].sort();
}

// drivers/vicare/device.js initializeCapabilities in 1.0.14
// Capabilities that later releases added to feature paths 1.0.14 already mapped
const ADDED_TO_1014_PATHS = ['target_temperature'];
const capabilitiesFor1014 = (store) => capabilitiesFor(store, PATHS_1014, { storedRolesOnly: true, derived: false })
  .filter((id) => !ADDED_TO_1014_PATHS.includes(id));

// Returns only the requested features, like the API does for ?filter=
function respond(dump, filter) {
  if (filter === undefined) return clone(dump);
  const requested = filter.split(',');
  return { ...clone(dump), data: dump.data.filter((feature) => requested.includes(feature.feature)).map(clone) };
}

/**
 * Pairs a device the 1.0.14 way from `before`, then starts it on the current code against an
 * API that reports `after`. With `refreshFails`, the unfiltered read of the upgrade refresh
 * fails with HTTP 503; regular (filtered) polls still work.
 *
 * @param {object} options
 * @param {{ installationId: number, gatewaySerial: string, deviceId: string, roles: string[] }} options.identity
 * @param {{ data: object[] }} options.before features response at pairing time
 * @param {{ data: object[] }} [options.after] features response today (default: `before`)
 * @param {boolean} [options.refreshFails]
 */
async function upgradeFrom1014({
  identity, before, after = before, refreshFails = false,
}) {
  const store = { ...identity, ...pairedStore1014(before), version: '1.0.14' };
  const capabilitiesBefore = capabilitiesFor1014(store);
  const data = { id: `${identity.installationId}-${identity.gatewaySerial}-${identity.deviceId}` };

  const driver = new ViessmannDriver();
  const device = new ViessmannDevice();
  device.driver = driver;
  device.__store = clone(store);
  device.__data = clone(data);
  device.__settings = { heatingCircuit: 'auto' };
  capabilitiesBefore.forEach((id) => device.__values.set(id, null));
  device.oAuth2Client = {
    getFeatures: jest.fn(async ({ filter }) => {
      if (filter === undefined && refreshFails) throw apiError({ status: 503, statusText: 'Service Unavailable' });
      return respond(after, filter);
    }),
    executeCommand: jest.fn(async () => ({ data: { success: true } })),
  };

  await device.onOAuth2Init();
  return {
    driver, device, store, data, capabilitiesBefore, pollingKey: data.id,
  };
}

// The filtered polls a device made (the upgrade refresh is the only unfiltered read)
const filteredPolls = (device) => device.oAuth2Client.getFeatures.mock.calls
  .filter(([request]) => request.filter !== undefined);

module.exports = {
  PATHS_1014, pairedStore1014, capabilitiesFor, capabilitiesFor1014, respond, upgradeFrom1014, filteredPolls,
};
