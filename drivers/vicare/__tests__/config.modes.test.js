/* eslint-env jest */

'use strict';

// config/modes.js: the operating mode titles and Homey's standard thermostat mode.

const {
  MODE_TITLES, STANDARD_MODES, standardModeOf, standardModesFor, standardModeWrite,
} = require('../config/modes');

const LANGUAGES = ['de', 'en', 'fr', 'nl', 'sv'];
const MODE_PATH = 'heating.circuits.0.operating.modes.active';
const modes = (...ids) => ids.map((id) => ({ id }));
const context = (operatingModes, current) => ({ operatingModes, currentValue: () => current });

test('every mode and standard value has a title in every app language', () => {
  for (const title of [...Object.values(MODE_TITLES), ...STANDARD_MODES.map((mode) => mode.title)]) {
    expect(Object.keys(title).sort()).toEqual(LANGUAGES);
  }
});

test('the Viessmann modes stand for heat, off, cool and auto', () => {
  expect(['heating', 'dhwAndHeating', 'forcedNormal', 'forcedReduced'].map(standardModeOf)).toEqual(['heat', 'heat', 'heat', 'heat']);
  expect(['dhw', 'standby', 'normalStandby'].map(standardModeOf)).toEqual(['off', 'off', 'off']);
  expect(standardModeOf('cooling')).toBe('cool');
  expect(['heatingCooling', 'dhwAndHeatingCooling'].map(standardModeOf)).toEqual(['auto', 'auto']);
  expect(standardModeOf('somethingNew')).toBeNull();
});

test('cool and auto are offered only to devices with such a mode; heat and off when the modes are unknown', () => {
  const ids = (operatingModes) => standardModesFor(operatingModes).map((mode) => mode.id);
  expect(ids(modes('dhw', 'dhwAndHeating', 'standby'))).toEqual(['heat', 'off']);
  expect(ids(modes('heating', 'standby'))).toEqual(['heat', 'off']);
  expect(ids(modes('dhw', 'dhwAndHeating', 'dhwAndHeatingCooling', 'standby'))).toEqual(['heat', 'auto', 'off']);
  expect(ids(modes('heating', 'cooling', 'heatingCooling', 'standby'))).toEqual(['heat', 'cool', 'auto', 'off']);
  expect(ids([])).toEqual(['heat', 'off']);
  expect(ids(undefined)).toEqual(['heat', 'off']);
});

describe('standardModeWrite', () => {
  const sets = (mode) => ({ path: MODE_PATH, command: 'setMode', parameters: { mode } });

  test('off is hot water only where the device has it, else standby', () => {
    expect(standardModeWrite('off', context(modes('dhw', 'dhwAndHeating', 'standby'), 'dhwAndHeating'), MODE_PATH)).toEqual({
      commands: [sets('dhw')], values: { thermostat_mode: 'off', 'thermostat_mode.heating': 'dhw' },
    });
    expect(standardModeWrite('off', context(modes('heating', 'standby'), 'heating'), MODE_PATH).commands).toEqual([sets('standby')]);
  });

  test('heat prefers hot water and heating; auto prefers hot water, heating and cooling', () => {
    expect(standardModeWrite('heat', context(modes('dhw', 'dhwAndHeating', 'heating'), 'dhw'), MODE_PATH).commands).toEqual([sets('dhwAndHeating')]);
    expect(standardModeWrite('heat', context(modes('heating', 'standby'), 'standby'), MODE_PATH).commands).toEqual([sets('heating')]);
    expect(standardModeWrite('auto', context(modes('heatingCooling', 'dhwAndHeatingCooling'), 'dhw'), MODE_PATH).commands)
      .toEqual([sets('dhwAndHeatingCooling')]);
  });

  test('a mode that already stands for the value stays, and unknown modes use the first choice', () => {
    expect(standardModeWrite('heat', context(modes('dhwAndHeating', 'forcedNormal'), 'forcedNormal'), MODE_PATH))
      .toEqual({ commands: [], values: { thermostat_mode: 'heat' } });
    expect(standardModeWrite('off', context([], undefined), MODE_PATH).commands).toEqual([sets('dhw')]);
  });

  test('a value the device has no mode for, or no standard value, is refused', () => {
    expect(() => standardModeWrite('cool', context(modes('dhw', 'dhwAndHeating'), 'dhw'), MODE_PATH))
      .toThrow(expect.objectContaining({ code: 'mode_not_available' }));
    expect(() => standardModeWrite('party', context([], undefined), MODE_PATH)).toThrow('Unknown thermostat mode: party');
  });
});
