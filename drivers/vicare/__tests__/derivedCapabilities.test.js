/* eslint-env jest */

'use strict';

// derivedCapabilities.js (the capability order and derived capabilities) and how the mapper and
// the config use it.

const config = require('../config');
const { FeatureMapper, featureMapper } = require('../featureMapper');
const {
  capabilityRank, sortByCapabilityOrder, derivedSource, addDerivedReadings, withWrittenValues,
} = require('../derivedCapabilities');

const { PATHS } = config;
const derived = (extra = {}) => ({
  capabilityName: 'measure_x', sources: ['a', 'b'], derive: () => 1, capabilityOptions: {}, ...extra,
});

test('a capability takes the place of its ID, else the first matching prefix, else the end', () => {
  const order = ['a', 'b.x', 'b*', 'c'];
  expect(['b.x', 'b.y', 'a', 'z', 'c'].map((id) => capabilityRank(id, order))).toEqual([1, 2, 0, 4, 3]);
  const entries = ['z', 'b.y', 'a', 'b.z'].map((capabilityName) => ({ capability: { capabilityName } }));
  expect(sortByCapabilityOrder(entries, order).map((entry) => entry.capability.capabilityName)).toEqual(['a', 'b.y', 'b.z', 'z']);
});

test('a derived capability comes from its first stored, allowed source, when it is available', () => {
  expect(derivedSource(derived(), ['b', 'a'], () => true)).toBe('a');
  expect(derivedSource(derived(), ['b'], (path) => path !== 'b')).toBeUndefined();
  expect(derivedSource(derived({ available: () => false }), ['a'], () => true)).toBeUndefined();
});

test('derived readings see the readings before them; a throwing derive gives no value', () => {
  const readings = new Map([['measure_y', { value: 2, gone: false }]]);
  const sum = derived({ derive: (read, context) => context.readings.get('measure_y').value + read('a', 'value.value') });
  const broken = derived({
    capabilityName: 'measure_z',
    derive: () => {
      throw new Error('boom');
    },
  });
  addDerivedReadings([sum, broken], () => 3, () => true, readings, { absenceCounts: true });
  expect(readings.get('measure_x')).toEqual({ value: 5, gone: false });
  expect(readings.get('measure_z')).toEqual({ value: undefined, gone: false });
});

test('a derived reading is gone only without a value, without connected sources, when absence counts', () => {
  const none = derived({ derive: () => undefined });
  const read = () => undefined;
  expect(addDerivedReadings([none], read, () => false, new Map(), { absenceCounts: true }).get('measure_x').gone).toBe(true);
  expect(addDerivedReadings([none], read, () => false, new Map(), { absenceCounts: false }).get('measure_x').gone).toBe(false);
  expect(addDerivedReadings([none], read, () => true, new Map(), { absenceCounts: true }).get('measure_x').gone).toBe(false);
});

test('written values replace the property in a copy of their feature; other features stay as they are', () => {
  const mode = { feature: 'a.mode', isEnabled: true, properties: { value: { type: 'string', value: 'dhwAndHeating' } } };
  const target = { feature: 'a.target', isEnabled: true, properties: { temperature: { value: 20, unit: 'celsius' } } };
  const other = { feature: 'a.other', isEnabled: true, properties: {} };
  const features = withWrittenValues([mode, target, other], [
    { path: 'a.mode', propertyPath: 'value.value', value: 'dhw' },
    { path: 'a.target', propertyPath: 'temperature.value', value: 21 },
    { path: 'a.other', propertyPath: 'active.value', value: true },
    { path: 'a.missing', propertyPath: 'value.value', value: 1 },
  ]);
  expect(features.map((feature) => feature.feature)).toEqual(['a.mode', 'a.target', 'a.other']);
  expect(features[0].properties.value).toEqual({ type: 'string', value: 'dhw' });
  expect(features[1].properties.temperature).toEqual({ value: 21, unit: 'celsius' });
  expect(features[2].properties.active).toEqual({ value: true });
  expect(mode.properties.value.value).toBe('dhwAndHeating');
  expect(withWrittenValues([mode], [])[0]).toBe(mode);
});

describe('in the mapper and the config', () => {
  test('are added and kept only while a source the roles allow is stored', () => {
    expect(featureMapper.isProduced('measure_heating_active', [PATHS.COMPRESSOR], () => true)).toBe(true);
    expect(featureMapper.isProduced('measure_heating_active', [PATHS.COMPRESSOR], () => false)).toBe(false);
    expect(featureMapper.isProduced('thermostat_mode.heatingProgram', [PATHS.HEATING_CIRCUIT_0_PROGRAM], () => true)).toBe(false);
    // Without the heat pump role only what every device gets (alwaysAdd) is added
    expect(featureMapper.capabilitiesFor([PATHS.COMPRESSOR], []).map(({ capability }) => capability.capabilityName))
      .toEqual(['alarm_problem', 'button.refreshFeatures']);
  });

  test('know their options, configuration and writability', () => {
    expect(featureMapper.configuredOptions('measure_status_text').title.en).toBe('Status');
    expect(featureMapper.capabilityByName('measure_operating_state').capabilityName).toBe('measure_operating_state');
    expect(featureMapper.writableCapabilities()).toEqual(expect.arrayContaining(['thermostat_mode', 'thermostat_mode.heatingProgram',
      'target_temperature', 'target_hysteresis.hotWater']));
    expect(featureMapper.writableCapabilities()).not.toContain('measure_status_text');
    expect(config.getCapabilityOptions('thermostat_mode').uiComponent).toBeNull();
  });

  test('a mapper without derived capabilities works as before', () => {
    const plain = new FeatureMapper({ FEATURES: config.FEATURES, PATHS: config.PATHS });
    expect(plain.DERIVED).toEqual([]);
    expect(plain.capabilitiesFor([PATHS.HOT_WATER_TEMP], []).map(({ capability }) => capability.capabilityName))
      .toEqual(['measure_temperature.hotWater', 'alarm_problem', 'button.refreshFeatures']);
  });

  test('the config refuses a derived capability with the name of another capability', () => {
    const one = { PATHS: { A: 'a.b' }, FEATURES: { 'a.b': { capabilities: [{ capabilityName: 'measure_x', propertyPath: 'value.value', capabilityOptions: {} }] } } };
    const two = { PATHS: {}, FEATURES: {}, DERIVED: [derived({ sources: [] })] };
    expect(() => config.combine({ one, two }, [])).toThrow('two derives measure_x, which is defined twice');
  });
});
