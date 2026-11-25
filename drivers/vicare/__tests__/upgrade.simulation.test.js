/* eslint-env jest */

'use strict';

// Simulates the update from 1.0.14 for every installation type in test/fixtures/ (and, when
// present, the local raw dumps in documentation/json-example-files/): a device store built the
// way 1.0.14 paired it, with the capabilities 1.0.14 gave it, starts on this version against the
// installation as it reports itself today. Nothing may be removed, every capability ID must be
// a registered one, and the device must reach polling even when the upgrade refresh fails.

const fs = require('fs');
const path = require('path');

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const ViessmannDriver = require('../driver');
const ViessmannDevice = require('../device');
const { apiError } = require('../../../lib/apiError');
const { PATHS, getAllCapabilities } = require('../config');
const registry = require('./registry.json');

const FIXTURES_DIR = path.join(__dirname, '../../../test/fixtures');
const DOCUMENTATION_DIR = path.join(__dirname, '../../../documentation/json-example-files');
const OLD_API = 'before api endpoint change';

const readJson = (dir, file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));

// The 1.0.14 versions of the code that shaped a paired device, frozen here so that the
// simulation keeps describing what is installed on users' Homeys.

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

// drivers/vicare/device.js initializeCapabilities in 1.0.14: the capabilities of every
// stored feature that passes the role check (config.js is unchanged since 1.0.14)
function capabilitiesFor({ features, roles }) {
  const capabilities = new Set();
  for (const featurePath of Object.values(PATHS)) {
    const capabilityConfigs = getAllCapabilities(featurePath);
    const { requireRole } = ViessmannDevice.FEATURES[featurePath];
    if (features.includes(featurePath) && (!requireRole || roles.includes(requireRole))) {
      capabilityConfigs.forEach((capability) => capabilities.add(capability.capabilityName));
    }
  }
  return [...capabilities].sort();
}

// Installation id, gateway serial and device id from the feature URIs, roles from the
// installations dump (the gateway with that serial, else the first heating device)
function deviceIdentity(featuresDump, installationsDump) {
  const uri = featuresDump.data.find((feature) => feature.uri)?.uri || '';
  const [, installationId, gatewaySerial, deviceId] = uri.match(/installations\/(\d+)\/gateways\/(\w+)\/devices\/(\w+)/) || [];
  const gateways = [];
  const collect = (value) => {
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') {
      if (Array.isArray(value.devices) && value.serial) gateways.push(value);
      Object.values(value).forEach(collect);
    }
  };
  collect(installationsDump);
  const heatingDevices = gateways.flatMap((gateway) => gateway.devices
    .filter((device) => device.deviceType === 'heating')
    .map((device) => ({ gateway, device })));
  const match = heatingDevices.find(({ gateway, device }) => gateway.serial === gatewaySerial && String(device.id) === deviceId)
    || heatingDevices[0];
  return {
    installationId: Number(installationId) || match.gateway.installationId,
    gatewaySerial: gatewaySerial || match.gateway.serial,
    deviceId: deviceId || String(match.device.id),
    roles: match.device.roles,
  };
}

// An installation that only has heating circuit 1, like some Vitoconnect Optolink setups
function onlyCircuitOne(dump) {
  const result = clone(dump);
  result.data = result.data
    .filter((feature) => !/^heating\.circuits\.[1-9]/.test(feature.feature))
    .map((feature) => {
      const renamed = {
        ...feature,
        feature: feature.feature.replace(/^heating\.circuits\.0(\.|$)/, 'heating.circuits.1$1'),
        uri: feature.uri?.replace(/heating\.circuits\.0(\.|\/|$)/, 'heating.circuits.1$1'),
      };
      if (feature.feature === 'heating.circuits') {
        renamed.properties = { ...feature.properties, enabled: { type: 'array', value: ['1'] } };
      }
      return renamed;
    });
  return result;
}

// Returns only the requested features, like the API does for ?filter=
function respond(dump, filter) {
  if (filter === undefined) return clone(dump);
  const requested = filter.split(',');
  return { ...clone(dump), data: dump.data.filter((feature) => requested.includes(feature.feature)).map(clone) };
}

function fixtureScenarios() {
  const fixture = (name) => readJson(FIXTURES_DIR, name);
  const boiler2016 = fixture('vitodens_200_2016_features.json');
  return [
    {
      name: 'fixtures: Vitocal 222 heat pump, 2024 dump to 2026 dump',
      before: fixture('vitocal_222_2024_features.json'),
      after: fixture('vitocal_222_features.json'),
      installations: fixture('vitocal_222_installations.json'),
      // connected in 2024, notConnected in 2026
      keeps: ['measure_temperature.buffer'],
    },
    {
      name: 'fixtures: Vitodens 200 E3 gas boiler',
      before: fixture('vitodens_200_e3_features.json'),
      after: fixture('vitodens_200_e3_features.json'),
      installations: fixture('vitodens_200_e3_installations.json'),
    },
    {
      name: 'fixtures: Vitodens 200 gas boiler (2016, Optolink)',
      before: boiler2016,
      after: boiler2016,
      installations: fixture('vitodens_200_2016_installations.json'),
    },
    {
      name: 'fixtures: Vitodens 200 E3 gas boiler (TCU)',
      before: fixture('vitodens_200_dh_features.json'),
      after: fixture('vitodens_200_dh_features.json'),
      installations: fixture('vitodens_200_dh_installations.json'),
    },
    {
      name: 'fixtures: Vitovalor PT2 fuel cell',
      before: fixture('vitovalor_pt2_features.json'),
      after: fixture('vitovalor_pt2_features.json'),
      installations: fixture('vitovalor_pt2_installations.json'),
    },
    {
      name: 'fixtures: gas boiler with only heating circuit 1',
      before: onlyCircuitOne(boiler2016),
      after: onlyCircuitOne(boiler2016),
      installations: fixture('vitodens_200_2016_installations.json'),
      circuit: '1',
    },
  ];
}

// Raw dumps are local only (never committed); skipped when documentation/ is absent
function documentationScenarios() {
  if (!fs.existsSync(DOCUMENTATION_DIR)) return [];
  const dump = (file) => readJson(DOCUMENTATION_DIR, file);
  const boiler2016 = dump(`${OLD_API}/vitodens_200_2016_features.json`);
  return [
    {
      name: 'documentation: Vitocal 222 heat pump, 2024 dump to 2026-11-25 dump',
      before: dump(`${OLD_API}/vitocal_222_features.json`),
      after: dump('vitocal_222_2026-11-25_features.json'),
      installations: dump('vitocal_222_2026-11-25_installations.json'),
      keeps: ['measure_temperature.buffer'],
    },
    {
      name: 'documentation: Vitodens 200 E3 gas boiler',
      before: dump(`${OLD_API}/vitodens_200_e3_features.json`),
      after: dump(`${OLD_API}/vitodens_200_e3_features.json`),
      installations: dump(`${OLD_API}/vitodens_200_e3_installations.json`),
    },
    {
      name: 'documentation: Vitodens 200 gas boiler (2016, Optolink)',
      before: boiler2016,
      after: boiler2016,
      installations: dump(`${OLD_API}/vitodens_200_2016_installations.json`),
    },
    {
      name: 'documentation: Vitodens 200 E3 gas boiler (TCU)',
      before: dump(`${OLD_API}/vitodens_200_DH_features.json`),
      after: dump(`${OLD_API}/vitodens_200_DH_features.json`),
      installations: dump(`${OLD_API}/vitodens_200_Vitovalor_PT2_installations.json`),
    },
    {
      name: 'documentation: Vitovalor PT2 fuel cell',
      before: dump(`${OLD_API}/vitovalor_PT2_features.json`),
      after: dump(`${OLD_API}/vitovalor_PT2_features.json`),
      installations: dump(`${OLD_API}/vitodens_200_Vitovalor_PT2_installations.json`),
    },
    {
      name: 'documentation: gas boiler with only heating circuit 1',
      before: onlyCircuitOne(boiler2016),
      after: onlyCircuitOne(boiler2016),
      installations: dump(`${OLD_API}/vitodens_200_2016_installations.json`),
      circuit: '1',
    },
  ];
}

const scenarios = [...fixtureScenarios(), ...documentationScenarios()];

// Pairs the device the 1.0.14 way, then starts it on this version
async function upgrade(scenario, { refreshFails = false } = {}) {
  const identity = deviceIdentity(scenario.before, scenario.installations);
  const store = { ...identity, ...pairedStore1014(scenario.before), version: '1.0.14' };
  const capabilitiesBefore = capabilitiesFor(store);
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
      return respond(scenario.after, filter);
    }),
    executeCommand: jest.fn(async () => ({ data: { success: true } })),
  };

  await device.onOAuth2Init();
  return {
    driver, device, store, data, capabilitiesBefore, pollingKey: data.id,
  };
}

beforeEach(() => {
  jest.spyOn(Math, 'random').mockReturnValue(0.5); // regular (filtered) polls only
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('test/fixtures provides the installation types to simulate', () => {
  expect(fixtureScenarios().length).toBeGreaterThanOrEqual(6);
});

describe.each(scenarios.map((scenario) => [scenario.name, scenario]))('upgrade from 1.0.14: %s', (_, scenario) => {
  test('the 1.0.14 device has capabilities to lose', () => {
    const store = { ...deviceIdentity(scenario.before, scenario.installations), ...pairedStore1014(scenario.before) };
    expect(capabilitiesFor(store).length).toBeGreaterThan(0);
  });

  test.each([
    ['the refresh succeeds', false],
    ['the refresh call throws', true],
  ])('when %s: nothing is removed, IDs are registered and polling starts', async (__, refreshFails) => {
    const {
      driver, device, store, data, capabilitiesBefore, pollingKey,
    } = await upgrade(scenario, { refreshFails });

    // No capability removed, every ID one that this app has always shipped
    expect(device.removeCapability).not.toHaveBeenCalled();
    const capabilitiesAfter = device.getCapabilities().sort();
    expect(capabilitiesAfter).toEqual(expect.arrayContaining(capabilitiesBefore));
    capabilitiesAfter.forEach((id) => expect(registry.capabilities).toContain(id));
    // Exactly the capabilities of the stored (merged) features
    expect(capabilitiesAfter).toEqual(capabilitiesFor(device.getStore()));
    (scenario.keeps || []).forEach((id) => expect(capabilitiesAfter).toContain(id));

    // Identity and stored features: unchanged or grown
    expect(device.getData()).toEqual(data);
    for (const key of ['installationId', 'gatewaySerial', 'deviceId', 'roles']) {
      expect(device.getStoreValue(key)).toEqual(store[key]);
    }
    expect(device.getStoreValue('features')).toEqual(expect.arrayContaining(store.features));

    // The device polls and is available
    expect(driver._devicePollers.has(pollingKey)).toBe(true);
    const polls = device.oAuth2Client.getFeatures.mock.calls.filter(([request]) => request.filter !== undefined);
    expect(polls).toHaveLength(1);
    expect(device.setUnavailable).not.toHaveBeenCalled();
    expect(device.getAvailable()).toBe(true);

    if (refreshFails) {
      expect(capabilitiesAfter).toEqual(capabilitiesBefore);
      expect(device.getStoreValue('heatingCircuitId')).toBeUndefined();
      expect(device.error).toHaveBeenCalledWith(expect.stringContaining('retrying on the next start'), expect.any(Error));
    } else {
      expect(device.getStoreValue('heatingCircuitId')).toBe(scenario.circuit || '0');
      expect(device.getStoreValue('commandMetadata')).toEqual(expect.any(Object));
      if (!scenario.circuit) expect(polls[0][0].filter).toBe(Object.values(PATHS).join(','));
    }
  });

  if (scenario.circuit) {
    test('circuit 1 gets the circuit-0 capability IDs, and commands and polls go to circuit 1', async () => {
      const { device, capabilitiesBefore } = await upgrade(scenario);

      // 1.0.14 only looked at circuit 0, so these are new for this installation
      for (const id of ['thermostat_mode.heating', 'target_temperature.heating']) {
        expect(capabilitiesBefore).not.toContain(id);
        expect(device.hasCapability(id)).toBe(true);
      }
      expect(device.getCapabilities().filter((id) => /circuit[1-9]/.test(id))).toEqual([]);

      const [[poll]] = device.oAuth2Client.getFeatures.mock.calls.filter(([request]) => request.filter !== undefined);
      expect(poll.filter).toContain('heating.circuits.1.operating.modes.active');
      expect(poll.filter).not.toContain('heating.circuits.0.');
      expect(device.getCapabilityValue('thermostat_mode.heating')).not.toBeNull();

      const [mode] = device.getStoreValue('operatingModes');
      await device.__listeners.get('thermostat_mode.heating')(mode.id);
      expect(device.oAuth2Client.executeCommand).toHaveBeenCalledWith(expect.objectContaining({
        feature: 'heating.circuits.1.operating.modes.active', command: 'setMode', body: { mode: mode.id },
      }));
    });
  }
});
