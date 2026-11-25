/* eslint-env jest */

'use strict';

// Feeds every device response from PyViCare (test/fixtures/pyvicare/) through
// onFeaturesUpdated, the way device.test.js does with our own fixtures: the response is
// processed without errors, every mapped capability's propertyPath resolves and the capability
// gets the value from the response. The device works on the heating circuit that pairing
// would detect for that response.

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const ViessmannDevice = require('../device');
const { FEATURES, PATHS } = require('../config');
const { detectHeatingCircuit, normalizeCircuitFeatures } = require('../heatingCircuit');
const { loadPyViCareFixtures } = require('../../../test/helpers/pyvicareFixtures');

// All roles, so that capabilities limited to heat pumps or boilers are checked as well
const ALL_ROLES = ['type:heating', 'type:heatpump', 'type:boiler'];
const ALL_CAPABILITIES = Object.values(FEATURES).flatMap((feature) => feature.capabilities);

const fixtures = loadPyViCareFixtures();

const getValueFromPath = (obj, path) => path.split('.').reduce((acc, part) => acc && acc[part], obj);

// [feature, capability, propertyPath, properties] for every capability of a mapped feature that
// the response reports as enabled, with properties and (where it has a status) connected. A
// feature without properties reports nothing (scripts/featureCoverage.js does not count it as
// usable either).
function mappedCapabilities(response) {
  const cases = [];
  for (const [featurePath, featureConfig] of Object.entries(FEATURES)) {
    const feature = response.data.find((item) => item.feature === featurePath);
    if (!feature?.isEnabled || Object.keys(feature.properties || {}).length === 0) continue;
    const status = feature.properties.status?.value;
    if (status && status !== 'connected') continue;
    for (const capability of featureConfig.capabilities) {
      cases.push([featurePath, capability.capabilityName, capability.propertyPath, feature.properties]);
    }
  }
  return cases;
}

function createDevice(heatingCircuitId) {
  const device = new ViessmannDevice();
  device._features = Object.values(PATHS);
  device._roles = ALL_ROLES;
  device._heatingCircuitId = heatingCircuitId;
  device.driver = { getTriggerCard: jest.fn(() => null) };
  ALL_CAPABILITIES.forEach((capability) => device.__values.set(capability.capabilityName, null));
  return device;
}

test('test/fixtures/pyvicare contains device responses', () => {
  expect(fixtures.length).toBeGreaterThan(0);
});

test('the PyViCare responses cover features that config.js maps', () => {
  const covered = fixtures.filter(({ dump }) => {
    const response = normalizeCircuitFeatures(dump, detectHeatingCircuit(dump.data));
    return mappedCapabilities(response).length > 0;
  });
  expect(covered.length).toBeGreaterThan(fixtures.length / 2);
});

describe.each(fixtures.map(({ name, dump }) => [name, dump]))('PyViCare %s', (name, dump) => {
  const heatingCircuitId = detectHeatingCircuit(dump.data);
  const response = normalizeCircuitFeatures(dump, heatingCircuitId);
  const cases = mappedCapabilities(response);

  test('onFeaturesUpdated processes the response without errors', async () => {
    const device = createDevice(heatingCircuitId);

    await device.onFeaturesUpdated(JSON.parse(JSON.stringify(dump)), false);

    expect(device.error).not.toHaveBeenCalled();
    expect(device.setUnavailable).not.toHaveBeenCalled();
    expect(device.getAvailable()).toBe(true);

    // Every capability that has a value in the response got it; no other capability changed.
    // A feature marked `fallbackFor` is read only when the other features give no value.
    const readings = new Map();
    const byFallback = ([a], [b]) => Number(Boolean(FEATURES[a].fallbackFor)) - Number(Boolean(FEATURES[b].fallbackFor));
    for (const [, capabilityName, propertyPath, properties] of [...cases].sort(byFallback)) {
      const value = getValueFromPath(properties, propertyPath);
      if (value !== undefined && !readings.has(capabilityName)) readings.set(capabilityName, value);
    }
    const expected = {};
    for (const [capabilityName, value] of readings) {
      // A capability starts at null, so a null reading is no change
      if (value === null) continue;
      const { valueMapping } = ALL_CAPABILITIES.find((capability) => capability.capabilityName === capabilityName);
      expected[capabilityName] = valueMapping && value in valueMapping ? valueMapping[value] : value;
    }
    const set = Object.fromEntries(device.setCapabilityValue.mock.calls);
    expect(set).toEqual(expected);
  });

  if (cases.length > 0) {
    test.each(cases)('%s: %s reads %s', (featurePath, capabilityName, propertyPath, properties) => {
      expect(getValueFromPath(properties, propertyPath)).toBeDefined();
    });
  }
});
