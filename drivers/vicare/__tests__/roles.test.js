/* eslint-env jest */

'use strict';

// Devices whose roles contain no role tag that config.js requires (type:heatpump, type:boiler)
// get roles inferred from their features (roles.js). Inferred roles only ever add capabilities.

const fs = require('fs');
const path = require('path');

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const ViessmannDriver = require('../driver');
const ViessmannDevice = require('../device');
const { FEATURES, PATHS } = require('../config');
const {
  ROLE_TAGS, inferRoles, hasRoleTags, effectiveRoles,
} = require('../roles');
const { loadPyViCareFixtures } = require('../../../test/helpers/pyvicareFixtures');

const FIXTURES_DIR = path.join(__dirname, '../../../test/fixtures');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));

const stripTypeRoles = (roles) => roles.filter((role) => !role.startsWith('type:'));
// Role-gated features outside the optional groups, which are off by default
const roleGated = (role) => Object.entries(FEATURES)
  .filter(([, feature]) => feature.requireRole === role && !feature.group)
  .flatMap(([featurePath, feature]) => feature.capabilities.map(({ capabilityName }) => [featurePath, capabilityName]));

// The roles of the heating device in an installations fixture
function heatingRoles(installationsFile) {
  const installations = readJson(path.join(FIXTURES_DIR, installationsFile));
  // Some dumps are the response, some only its data
  const devices = (Array.isArray(installations) ? installations : installations.data).flatMap((installation) => installation.gateways)
    .flatMap((gateway) => gateway.devices)
    .filter((device) => device.deviceType === 'heating');
  expect(devices).toHaveLength(1);
  return devices[0].roles;
}

// A device paired from a features response (as onPairListDevices stores it) with the given roles
async function pairedDevice(dump, roles) {
  const metadata = new ViessmannDriver()._readDeviceMetadata(clone(dump));
  const device = new ViessmannDevice();
  device.driver = { getTriggerCard: jest.fn(() => null) };
  device._roles = roles;
  device._features = metadata.features;
  device._heatingCircuitId = metadata.heatingCircuitId;
  await device.initializeCapabilities();
  return device;
}

describe('inferRoles', () => {
  test.each([
    ['a compressor feature', [PATHS.COMPRESSOR], [], ['type:heatpump']],
    ['a second compressor', ['heating.compressors.1'], [], ['type:heatpump']],
    ['a burner feature', [PATHS.BURNER], [], ['type:boiler']],
    ['a compressor and a burner (hybrid)', [PATHS.COMPRESSOR, PATHS.BURNER], [], ['type:heatpump', 'type:boiler']],
    ['only compressor statistics', [PATHS.COMPRESSOR_STATS], [], []],
    ['no compressor or burner', [PATHS.OUTSIDE_TEMP, 'heating.compressors'], [], []],
    ['the compressor list with an enabled compressor', [],
      [{ feature: 'heating.compressors', isEnabled: true, properties: { enabled: { type: 'array', value: ['0'] } } }], ['type:heatpump']],
    ['the burner list with an enabled burner', [],
      [{ feature: 'heating.burners', isEnabled: true, properties: { enabled: { type: 'array', value: ['0'] } } }], ['type:boiler']],
    ['an empty compressor list', [],
      [{ feature: 'heating.compressors', isEnabled: true, properties: { enabled: { type: 'array', value: [] } } }], []],
    ['a disabled compressor list', [],
      [{ feature: 'heating.compressors', isEnabled: false, properties: { enabled: { type: 'array', value: ['0'] } } }], []],
    ['garbage', [null, 42, { feature: 'heating.compressors.0' }], [null, 'x', { feature: 'heating.burners', isEnabled: true, properties: null }], []],
  ])('%s', (_, names, data, expected) => {
    expect(inferRoles(names, data)).toEqual(expected);
  });

  test('accepts no input at all', () => {
    expect(inferRoles()).toEqual([]);
    expect(inferRoles(null, null)).toEqual([]);
  });
});

describe('effectiveRoles', () => {
  test('the role tags that config.js requires are the ones the fallback covers', () => {
    expect(ROLE_TAGS.sort()).toEqual(['type:boiler', 'type:heatpump']);
  });

  test('stored roles with a role tag are used as they are', () => {
    const roles = ['type:boiler', 'type:dhw'];
    expect(hasRoleTags(roles)).toBe(true);
    expect(effectiveRoles(roles, ['type:heatpump'])).toEqual(roles);
  });

  test.each([
    ['without role tags', ['type:heating', 'type:dhw']],
    ['empty', []],
    ['missing', undefined],
    ['not a list', 'type:heating'],
  ])('stored roles %s get the inferred roles', (_, roles) => {
    expect(hasRoleTags(roles)).toBe(false);
    expect(effectiveRoles(roles, ['type:heatpump'])).toEqual([...(Array.isArray(roles) ? roles : []), 'type:heatpump']);
  });
});

describe('role aliases', () => {
  test.each([
    ['a hot water heat pump', ['type:dhwHeatpump']],
    ['another spelling', ['type:heatPump']],
    ['a longer type name', ['type:heatpumpOutdoorUnit']],
    ['next to a role tag of its own', ['type:boiler', 'type:dhwHeatpump']],
  ])('%s counts as type:heatpump', (_, roles) => {
    expect(effectiveRoles(roles)).toEqual(expect.arrayContaining([...roles, 'type:heatpump']));
  });

  test.each([
    ['a product family', ['type:productFamily;Vitocal']],
    ['a value after the type name', ['type:gateway;Heatpump1']],
    ['an interface', ['interface:heatpump']],
    ['a capability', ['capability:heatpumpReport']],
  ])('%s does not', (_, roles) => {
    expect(effectiveRoles(roles)).not.toContain('type:heatpump');
  });

  test('an alias does not stop the inference for a device without role tags', () => {
    expect(hasRoleTags(['type:dhwHeatpump'])).toBe(false);
    expect(effectiveRoles(['type:dhwHeatpump'], ['type:boiler'])).toEqual(['type:dhwHeatpump', 'type:heatpump', 'type:boiler']);
  });
});

/*
  Vitocal 262-A, a hot water heat pump (PyViCare's Vitocal262A_T2H-R290.json, model
  E3_Vitocal_262_02): its roles have type:dhwHeatpump instead of type:heatpump. Only the roles
  and features this test needs.
*/
const VITOCAL_262A_ROLES = [
  'interface:compressor', 'interface:domesticHotWater', 'type:E3', 'type:dhw;integrated', 'type:dhwHeatpump',
  'type:heating;integrated', 'type:product;Vitocal_262A', 'type:productFamily;Vitocal',
];
const VITOCAL_262A = {
  data: [
    { feature: 'heating.compressors', isEnabled: true, properties: { enabled: { type: 'array', value: ['0'] } } },
    {
      feature: 'heating.compressors.0',
      isEnabled: true,
      properties: { active: { type: 'boolean', value: false }, phase: { type: 'string', value: 'off' } },
    },
    {
      feature: 'heating.compressors.0.statistics',
      isEnabled: true,
      properties: { hours: { type: 'number', unit: 'hour', value: 1256 }, starts: { type: 'number', unit: '', value: 330 } },
    },
    {
      feature: 'heating.dhw.sensors.temperature.dhwCylinder',
      isEnabled: true,
      properties: { status: { type: 'string', value: 'connected' }, value: { type: 'number', unit: 'celsius', value: 55.3 } },
    },
  ],
};

describe('Vitocal 262-A (type:dhwHeatpump)', () => {
  const COMPRESSOR_CAPABILITIES = {
    measure_compressor_active: false,
    'measure_compressor_number.compressorHours': 1256,
    'measure_compressor_number.compressorStarts': 330,
  };

  test('gets the compressor capabilities and values', async () => {
    const device = await pairedDevice(VITOCAL_262A, VITOCAL_262A_ROLES);

    await device.onFeaturesUpdated(clone(VITOCAL_262A), false);

    for (const [capabilityName, value] of Object.entries(COMPRESSOR_CAPABILITIES)) {
      expect([capabilityName, device.getCapabilityValue(capabilityName)]).toEqual([capabilityName, value]);
    }
    expect(device.getCapabilityValue('measure_temperature.hotWater')).toBe(55.3);
    expect(device.removeCapability).not.toHaveBeenCalled();
  });

  test('the role alone allows them, also without a compressor feature to infer it from', async () => {
    const device = new ViessmannDevice();
    device._roles = VITOCAL_262A_ROLES;
    device._features = [PATHS.COMPRESSOR_STATS];

    await device.initializeCapabilities();

    expect(device.hasCapability('measure_compressor_number.compressorHours')).toBe(true);
    expect(device.hasCapability('measure_compressor_number.compressorStarts')).toBe(true);
  });

  test('next to a role tag of its own (here type:boiler), the alias still adds the heat pump', async () => {
    const device = await pairedDevice(VITOCAL_262A, ['type:boiler', 'type:dhwHeatpump']);

    for (const capabilityName of Object.keys(COMPRESSOR_CAPABILITIES)) expect(device.hasCapability(capabilityName)).toBe(true);
    expect(device.removeCapability).not.toHaveBeenCalled();
  });
});

describe('our fixtures with the type roles stripped', () => {
  const cases = [
    ['vitocal_222_features.json', 'vitocal_222_installations.json', 'type:heatpump'],
    ['vitocal_222_2024_features.json', 'vitocal_222_installations.json', 'type:heatpump'],
    ['vitodens_200_2016_features.json', 'vitodens_200_2016_installations.json', 'type:boiler'],
    ['vitodens_200_dh_features.json', 'vitodens_200_dh_installations.json', 'type:boiler'],
    ['vitodens_200_e3_features.json', 'vitodens_200_e3_installations.json', 'type:boiler'],
    ['vitovalor_pt2_features.json', 'vitovalor_pt2_installations.json', null],
  ];

  test('cover every features fixture', () => {
    const fixtures = fs.readdirSync(FIXTURES_DIR).filter((name) => name.endsWith('_features.json'));
    expect(cases.map(([name]) => name).sort()).toEqual(fixtures.sort());
  });

  test.each(cases)('%s gets the same capabilities and values as with its roles', async (featuresFile, installationsFile, role) => {
    const dump = readJson(path.join(FIXTURES_DIR, featuresFile));
    const roles = heatingRoles(installationsFile);
    const stripped = stripTypeRoles(roles);
    expect(hasRoleTags(stripped)).toBe(false);

    const withRoles = await pairedDevice(dump, roles);
    const withoutRoles = await pairedDevice(dump, stripped);
    expect(withoutRoles.getCapabilities().sort()).toEqual(withRoles.getCapabilities().sort());

    // The role-gated capabilities the fixture has are really there (not just equally missing)
    const gated = roleGated(role).filter(([featurePath]) => withoutRoles._features.includes(featurePath));
    if (role) expect(gated.length).toBeGreaterThan(0);
    for (const [, capabilityName] of gated) expect(withoutRoles.hasCapability(capabilityName)).toBe(true);

    await withRoles.onFeaturesUpdated(clone(dump), false);
    await withoutRoles.onFeaturesUpdated(clone(dump), false);
    for (const capabilityName of withRoles.getCapabilities()) {
      expect([capabilityName, withoutRoles.getCapabilityValue(capabilityName)])
        .toEqual([capabilityName, withRoles.getCapabilityValue(capabilityName)]);
    }
  });
});

// PyViCare's device responses (test/fixtures/pyvicare/), all paired without any roles
const pyvicareFixtures = loadPyViCareFixtures().map(({ name, dump }) => [name, dump]);

describe('PyViCare responses without roles', () => {
  test('are there', () => {
    expect(pyvicareFixtures.length).toBeGreaterThan(50);
  });

  test.each(pyvicareFixtures)('%s', async (_, dump) => {
    const device = await pairedDevice(dump, []);
    const inferred = inferRoles(device._features);
    for (const role of ROLE_TAGS) {
      for (const [featurePath, capabilityName] of roleGated(role)) {
        const expected = inferred.includes(role) && device._features.includes(featurePath);
        expect([featurePath, capabilityName, device.hasCapability(capabilityName)])
          .toEqual([featurePath, capabilityName, expected]);
      }
    }
  });
});

describe('inferred roles never remove capabilities', () => {
  const COMPRESSOR_STARTS = 'measure_compressor_number.compressorStarts';

  test('a device without role tags keeps a role-gated capability whose feature is stored', async () => {
    const device = new ViessmannDevice();
    device._roles = ['type:heating'];
    // Statistics alone do not show a compressor, so no role is inferred
    device._features = [PATHS.COMPRESSOR_STATS];
    device.__values.set(COMPRESSOR_STARTS, 1200);

    await device.initializeCapabilities();

    expect(device.removeCapability).not.toHaveBeenCalled();
    expect(device.getCapabilityValue(COMPRESSOR_STARTS)).toBe(1200);
  });

  test('a device with a role tag still loses a capability its role does not allow (as before)', async () => {
    const device = new ViessmannDevice();
    device._roles = ['type:boiler'];
    device._features = [PATHS.COMPRESSOR_STATS];
    device.__values.set(COMPRESSOR_STARTS, 1200);

    await device.initializeCapabilities();

    expect(device.hasCapability(COMPRESSOR_STARTS)).toBe(false);
  });

  test('a compressor list in a response adds the heat pump capabilities, and they survive a restart', async () => {
    const store = { roles: ['type:heating'], features: [PATHS.COMPRESSOR_STATS] };
    const device = new ViessmannDevice();
    device.driver = { getTriggerCard: jest.fn(() => null) };
    device._roles = store.roles;
    device._features = store.features;
    await device.initializeCapabilities();
    expect(device.hasCapability(COMPRESSOR_STARTS)).toBe(false);

    await device.onFeaturesUpdated({
      data: [
        { feature: 'heating.compressors', isEnabled: true, properties: { enabled: { type: 'array', value: ['0'] } } },
        { feature: PATHS.COMPRESSOR_STATS, isEnabled: true, properties: { starts: { type: 'number', value: 1200 } } },
      ],
    }, true);
    expect(device.hasCapability(COMPRESSOR_STARTS)).toBe(true);
    expect(device.getCapabilityValue(COMPRESSOR_STARTS)).toBe(1200);
    expect(device.setUnavailable).not.toHaveBeenCalled();

    // After a restart the response-only role is gone, but nothing is removed
    const restarted = new ViessmannDevice();
    restarted.__values = new Map(device.__values);
    restarted._roles = store.roles;
    restarted._features = device._features;
    await restarted.initializeCapabilities();
    expect(restarted.removeCapability).not.toHaveBeenCalled();
    expect(restarted.hasCapability(COMPRESSOR_STARTS)).toBe(true);
  });
});
