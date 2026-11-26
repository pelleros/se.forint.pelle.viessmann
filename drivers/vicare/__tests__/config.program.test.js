/* eslint-env jest */

'use strict';

// config/program.js: the program picker (reading the active program, the programs a device
// has, switching programs) and the program titles.

const { PATHS, DERIVED } = require('../config');
const {
  PROGRAMS, ECO_PROGRAM, programsFor, programPath,
} = require('../config/program');
const { featureReader } = require('../../../test/helpers/featureReader');

const picker = DERIVED.find((derived) => derived.capabilityName === 'thermostat_mode.heatingProgram');
const ALL = [PATHS.HEATING_CIRCUIT_0_TARGET, PATHS.HEATING_CIRCUIT_0_REDUCED, PATHS.HEATING_CIRCUIT_0_COMFORT, ECO_PROGRAM];
const switchTo = (value, current, features = ALL) => picker.write(value, { features, currentValue: () => current });

test('every program has a title in every app language', () => {
  for (const program of PROGRAMS) expect(Object.keys(program.title).sort()).toEqual(['de', 'en', 'fr', 'nl', 'sv']);
});

test('the picker shows the active program, newer program names as the same program, others as none', () => {
  const active = (value) => picker.derive(featureReader({ [PATHS.HEATING_CIRCUIT_0_PROGRAM]: { value: { value } } }), {});
  expect(['normal', 'normalHeating', 'reduced', 'reducedHeating', 'comfort', 'comfortHeating', 'eco'].map(active))
    .toEqual(['normal', 'normal', 'reduced', 'reduced', 'comfort', 'comfort', 'eco']);
  expect(active('standby')).toBeNull();
  expect(active(undefined)).toBeUndefined();
});

test('the picker offers the programs the device has, and only to devices with one', () => {
  expect(programsFor([PATHS.HEATING_CIRCUIT_0_TARGET_E3, PATHS.HEATING_CIRCUIT_0_COMFORT_E3]).map((program) => program.id))
    .toEqual(['normal', 'comfort']);
  expect(picker.options({ features: ALL }).values.map((value) => value.id)).toEqual(['normal', 'reduced', 'comfort', 'eco']);
  expect(picker.available([])).toBe(false);
  expect(programPath('comfort', [PATHS.HEATING_CIRCUIT_0_COMFORT_E3])).toBe(PATHS.HEATING_CIRCUIT_0_COMFORT_E3);
  expect(programPath('eco', [])).toBeUndefined();
});

describe('switching programs', () => {
  const command = (path, name) => ({ path, command: name, parameters: {} });

  test('comfort and eco are switched on; switching one on first switches the other off', () => {
    expect(switchTo('comfort', 'normal')).toEqual({
      commands: [command(PATHS.HEATING_CIRCUIT_0_COMFORT, 'activate')], values: { 'thermostat_mode.heatingProgram': 'comfort' },
    });
    expect(switchTo('eco', 'comfort').commands).toEqual([
      command(PATHS.HEATING_CIRCUIT_0_COMFORT, 'deactivate'), command(ECO_PROGRAM, 'activate'),
    ]);
  });

  test('normal and reduced end comfort or eco and leave the next program to the time program', () => {
    expect(switchTo('normal', 'eco')).toEqual({ commands: [command(ECO_PROGRAM, 'deactivate')], values: {} });
    expect(switchTo('reduced', 'comfort').commands).toEqual([command(PATHS.HEATING_CIRCUIT_0_COMFORT, 'deactivate')]);
    expect(() => switchTo('reduced', 'normal')).toThrow(expect.objectContaining({ code: 'program_follows_schedule' }));
  });

  test('a program the device does not have, or an unknown one, is refused', () => {
    expect(() => switchTo('eco', 'normal', [PATHS.HEATING_CIRCUIT_0_TARGET])).toThrow(expect.objectContaining({ code: 'program_not_available' }));
    expect(() => switchTo('nap', 'normal')).toThrow('Unknown program: nap');
  });
});
