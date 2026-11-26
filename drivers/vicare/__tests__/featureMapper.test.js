/* eslint-env jest */

'use strict';

// The pure mapping between feature responses and capabilities (no Homey involved), and the
// combination of the theme modules in config/.

const fs = require('fs');
const path = require('path');
const config = require('../config');
const {
  FeatureMapper, featureMapper, readPropertyValue, isConnected, mergeOperatingModes,
} = require('../featureMapper');

const FIXTURES_DIR = path.join(__dirname, '../../../test/fixtures');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8'));

const feature = (name, properties, extra = {}) => ({
  feature: name, isEnabled: true, properties, ...extra,
});

describe('config modules', () => {
  // The order of 1.0.16: newly paired devices add their capabilities in this order
  const PATHS_1016 = [
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
    'heating.bufferCylinder.sensors.temperature.top',
    'heating.sensors.temperature.return',
    'heating.primaryCircuit.sensors.temperature.supply',
    'heating.primaryCircuit.sensors.temperature.return',
    'heating.secondaryCircuit.sensors.temperature.supply',
    'heating.boiler.sensors.temperature.main',
    'heating.boiler.sensors.temperature.commonSupply',
    'heating.compressors.0',
    'heating.compressors.0.statistics',
    'heating.compressors.0.sensors.power',
    'heating.cop.total',
    'heating.cop.heating',
    'heating.cop.dhw',
    'heating.burners.0',
    'heating.burners.0.modulation',
    'heating.burners.0.statistics',
    'fuelCell.sensors.temperature.return',
    'fuelCell.sensors.temperature.supply',
    'fuelCell.statistics',
    'fuelCell.operating.phase',
    'fuelCell.operating.modes.active',
  ];

  test('PATHS keeps the order of 1.0.16; new paths come after it', () => {
    expect(Object.values(config.PATHS).slice(0, PATHS_1016.length)).toEqual(PATHS_1016);
  });

  test('FEATURES has an entry for every path in PATHS, in the same order', () => {
    expect(Object.keys(config.FEATURES)).toEqual(Object.values(config.PATHS));
  });

  test('every path belongs to exactly one theme module', () => {
    const owners = Object.values(config.MODULES).flatMap((module) => Object.values(module.PATHS));
    expect(new Set(owners).size).toBe(owners.length);
    expect([...owners].sort()).toEqual(Object.values(config.PATHS).sort());
  });

  test('combine refuses a path or constant defined twice, and a feature outside the module\'s PATHS', () => {
    const one = { PATHS: { A: 'a.b' }, FEATURES: { 'a.b': { capabilities: [] } } };
    expect(() => config.combine({ one, two: { PATHS: { A: 'x.y' }, FEATURES: {} } }, [])).toThrow('PATHS.A is defined in both one and two');
    expect(() => config.combine({ one, two: { PATHS: { B: 'a.b' }, FEATURES: {} } }, [])).toThrow('a.b is defined in both one and two');
    expect(() => config.combine({ one: { PATHS: {}, FEATURES: { 'a.b': { capabilities: [] } } } }, [])).toThrow('not in its PATHS');
  });

  test('combine puts listed constants first and the rest in module order', () => {
    const first = { PATHS: { A: 'a', B: 'b' }, FEATURES: { a: { capabilities: [] }, b: { capabilities: [] } } };
    const second = { PATHS: { C: 'c' }, FEATURES: { c: { capabilities: [] } } };
    const { PATHS, FEATURES } = config.combine({ first, second }, ['C', 'B', 'UNKNOWN']);
    expect(Object.keys(PATHS)).toEqual(['C', 'B', 'A']);
    expect(Object.keys(FEATURES)).toEqual(['c', 'b', 'a']);
  });
});

describe('readPropertyValue', () => {
  test.each([
    [{ value: { value: 21.5 } }, 'value.value', 21.5],
    [{ value: { value: 'dhw' } }, 'value.value', 'dhw'],
    [{ active: { value: false } }, 'active.value', false],
    [{ value: { value: null } }, 'value.value', null],
    [{ value: { value: Number.NaN } }, 'value.value', undefined],
    [{ value: { value: { nested: 1 } } }, 'value.value', undefined],
    [{ value: {} }, 'value.value', undefined],
    [undefined, 'value.value', undefined],
  ])('%j at %s is %p', (properties, propertyPath, expected) => {
    expect(readPropertyValue(properties, propertyPath)).toBe(expected);
  });

  test('a disabled, notConnected or empty feature is not connected', () => {
    expect(isConnected(feature('x', { value: { value: 1 } }))).toBe(true);
    expect(isConnected(feature('x', { value: { value: 1 } }, { isEnabled: false }))).toBe(false);
    expect(isConnected(feature('x', { status: { value: 'notConnected' } }))).toBe(false);
    expect(isConnected(feature('x', undefined))).toBe(false);
    expect(isConnected(undefined)).toBe(false);
  });
});

describe('FeatureMapper', () => {
  const { PATHS } = config;

  test('capabilitiesFor lists the capabilities of stored features the roles allow, in the order of new devices', () => {
    const stored = [PATHS.COMPRESSOR, PATHS.HOT_WATER_TEMP, PATHS.BURNER, 'some.unmapped.feature'];
    const names = (roles) => featureMapper.capabilitiesFor(stored, roles).map(({ capability }) => capability.capabilityName);
    // Hot water, then the status (derived from the compressor and the burner)
    const status = ['measure_status_text', 'measure_heating_active', 'measure_operating_state'];

    expect(names(['type:heatpump'])).toEqual(['measure_temperature.hotWater', ...status, 'measure_compressor_active', 'measure_burner_active']);
    expect(names([])).toEqual(['measure_temperature.hotWater', ...status, 'measure_burner_active']);
  });

  test('isProduced keeps a capability while one allowed, stored path still produces it', () => {
    const allowAll = () => true;
    expect(featureMapper.isProduced('measure_temperature.buffer', [PATHS.BUFFER_TEMP_TOP], allowAll)).toBe(true);
    expect(featureMapper.isProduced('measure_temperature.buffer', [PATHS.HOT_WATER_TEMP], allowAll)).toBe(false);
    expect(featureMapper.isProduced('measure_compressor_active', [PATHS.COMPRESSOR], () => false)).toBe(false);
    expect(featureMapper.isProduced('not_a_capability', [PATHS.COMPRESSOR], allowAll)).toBe(false);
  });

  test('optionsFor adds the API\'s temperature limits and leaves the configured options alone', () => {
    const configured = config.getCapabilityOptions('target_temperature.hotWater');
    const options = featureMapper.optionsFor('target_temperature.hotWater', PATHS.HOT_WATER_TARGET, {
      [PATHS.HOT_WATER_TARGET]: { temperature: { min: 10, max: 55, stepping: 0.5 } },
    });

    expect(options).toEqual({
      ...configured, min: 10, max: 55, step: 0.5,
    });
    expect(configured.max).toBe(60);
    expect(featureMapper.optionsFor('target_temperature.heating', PATHS.HEATING_CIRCUIT_0_TARGET, {
      [PATHS.HEATING_CIRCUIT_0_TARGET]: { targetTemperature: { min: 3, max: 37 } },
    })).toMatchObject({ min: 3, max: 37, step: 1 });
    expect(featureMapper.optionsFor('measure_temperature.outside', PATHS.OUTSIDE_TEMP, undefined))
      .toEqual(config.getCapabilityOptions('measure_temperature.outside'));
    expect(() => featureMapper.optionsFor('unknown', 'x', {})).toThrow('No capability options found for: unknown');
  });

  test('readValues reads the main path before its fallback and marks unreported paths as gone', () => {
    const readings = featureMapper.readValues({
      data: [
        feature(PATHS.BUFFER_TEMP, { status: { value: 'notConnected' } }),
        feature(PATHS.BUFFER_TEMP_TOP, { value: { value: 41.2 } }),
        feature(PATHS.HOT_WATER_TEMP, { value: { value: 'garbage', extra: 1 } }),
        feature(PATHS.COMPRESSOR, { active: { value: true } }),
      ],
    }, []);

    expect(readings.get('measure_temperature.buffer')).toEqual({ value: 41.2, gone: false });
    expect(readings.get('measure_temperature.hotWater')).toEqual({ value: 'garbage', gone: false });
    expect(readings.get('measure_temperature.outside')).toEqual({ value: undefined, gone: true });
    // Without the heat pump role, the compressor is not read
    expect(readings.has('measure_compressor_active')).toBe(false);
  });

  test('a response without any mapped feature clears nothing', () => {
    const readings = featureMapper.readValues({ data: [feature('device.serial', { value: { value: 'x' } })] }, []);
    expect([...readings.values()].every((reading) => !reading.gone)).toBe(true);
  });

  test('displayValue maps API values for the one-time charge only', () => {
    expect(featureMapper.displayValue('thermostat_mode.hotWaterOneTimeCharge', true)).toBe('activate');
    expect(featureMapper.displayValue('thermostat_mode.hotWaterOneTimeCharge', false)).toBe('deactivate');
    expect(featureMapper.displayValue('measure_temperature.outside', 3)).toBe(3);
    expect(featureMapper.displayValue('unknown', 3)).toBe(3);
  });

  test('commandTarget is the first path that produces the capability', () => {
    expect(featureMapper.commandTarget('measure_temperature.buffer').path).toBe(PATHS.BUFFER_TEMP);
    expect(featureMapper.commandTarget('target_temperature.heating')).toMatchObject({
      path: PATHS.HEATING_CIRCUIT_0_TARGET, capability: { command: { name: 'setTemperature' } },
    });
    expect(featureMapper.commandTarget('unknown')).toBeNull();
  });

  test('updatedCommands replaces reported commands and empties disabled features', () => {
    const previous = { a: { x: {} }, b: { y: {} }, c: { z: {} } };
    const commands = featureMapper.updatedCommands({
      data: [feature('a', {}, { commands: { setX: {} } }), feature('b', {}, { isEnabled: false }), feature('d', {})],
    }, previous);

    expect(commands).toEqual({ a: { setX: {} }, b: {}, c: { z: {} } });
    expect(previous.a).toEqual({ x: {} });
  });

  test('newFeatures lists enabled, connected features that are not known yet', () => {
    expect(featureMapper.newFeatures({
      data: [
        feature('known', {}),
        feature('new', {}),
        feature('new', {}),
        feature('off', {}, { isEnabled: false }),
        feature('gone', { status: { value: 'notConnected' } }),
      ],
    }, ['known'])).toEqual(['new']);
    expect(featureMapper.newFeatures(undefined, [])).toEqual([]);
  });

  test('deviceMetadata reads features, constraints, commands and operating modes', () => {
    const metadata = featureMapper.deviceMetadata(fixture('vitocal_222_features.json'));

    expect(metadata.features).toContain(PATHS.HOT_WATER_TARGET);
    expect(metadata.constraints[PATHS.HOT_WATER_TARGET].temperature).toEqual(expect.objectContaining({ min: expect.any(Number) }));
    expect(Object.keys(metadata.commandMetadata[PATHS.HEATING_CIRCUIT_0_MODE])).toContain('setMode');
    expect(metadata.operatingModes.map((mode) => mode.id)).toEqual(expect.arrayContaining(['dhw', 'dhwAndHeating']));
    expect(metadata.operatingModes.find((mode) => mode.id === 'dhwAndHeating').title).toEqual({ en: 'DHW And Heating' });
  });

  test('deviceMetadata without readable operating modes has none', () => {
    const metadata = featureMapper.deviceMetadata({ data: [feature(PATHS.HEATING_CIRCUIT_0_MODE, { value: { value: 'dhw' } })] });
    expect(metadata).toEqual({
      features: [PATHS.HEATING_CIRCUIT_0_MODE], constraints: {}, commandMetadata: {}, operatingModes: [],
    });
  });

  test('a mapper can work on another configuration', () => {
    const custom = new FeatureMapper({
      PATHS: { X: 'x.y' },
      FEATURES: { 'x.y': { capabilities: [{ capabilityName: 'measure_x', propertyPath: 'value.value', capabilityOptions: {} }] } },
    });
    expect(custom.capabilitiesFor(['x.y'], []).map(({ capability }) => capability.capabilityName)).toEqual(['measure_x']);
    expect(custom.readValues({ data: [feature('x.y', { value: { value: 7 } })] }, []).get('measure_x').value).toBe(7);
  });
});

describe('mergeOperatingModes', () => {
  const mode = (id) => ({ id, title: { en: id } });

  test('keeps the supported current values in their order and adds the device\'s other modes', () => {
    expect(mergeOperatingModes([mode('dhw'), mode('heating'), mode('standby')], [mode('standby'), mode('dhw'), mode('forcedNormal')]))
      .toEqual([mode('dhw'), mode('standby'), mode('forcedNormal')]);
  });

  test('adds each device mode once', () => {
    expect(mergeOperatingModes([], [mode('dhw'), mode('dhw')])).toEqual([mode('dhw')]);
  });
});
