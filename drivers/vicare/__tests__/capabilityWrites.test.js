/* eslint-env jest */

'use strict';

// capabilityWrites.js: what a write to a capability sends, and its error messages.

// The translations come through lib/errorMessages.js, which loads homey-oauth2app
// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const { PATHS, getCapability } = require('../config');
const {
  capabilityCommand, configuredWrite, planWrite, writeErrorMessage,
} = require('../capabilityWrites');
const en = require('../../../locales/en.json');

const HEATING_TARGET = getCapability(PATHS.HEATING_CIRCUIT_0_TARGET);
const CHARGE = getCapability(PATHS.HOT_WATER_CHARGE);

test('a named command gets the value in every parameter; a value can also be the command', () => {
  expect(capabilityCommand(HEATING_TARGET, 21)).toEqual({ command: 'setTemperature', parameters: { targetTemperature: 21 } });
  expect(capabilityCommand(CHARGE, 'activate')).toEqual({ command: 'activate', parameters: {} });
  expect(() => capabilityCommand({ capabilityName: 'measure_x', propertyPath: 'value.value', capabilityOptions: {} }, 1))
    .toThrow('measure_x cannot be changed');
});

test('a configured write also shows the value on the capabilities of the same property', () => {
  expect(configuredWrite(PATHS.HEATING_CIRCUIT_0_TARGET, HEATING_TARGET, 21)).toEqual({
    commands: [{ path: PATHS.HEATING_CIRCUIT_0_TARGET, command: 'setTemperature', parameters: { targetTemperature: 21 } }],
    values: { 'target_temperature.heating': 21, target_temperature: 21 },
  });
  expect(configuredWrite(PATHS.HOT_WATER_CHARGE, CHARGE, 'activate').values).toEqual({ 'thermostat_mode.hotWaterOneTimeCharge': 'activate' });
});

test('a write goes to the feature path the device has, or through a derived capability\'s own commands', () => {
  const newer = { features: [PATHS.HEATING_CIRCUIT_0_TARGET_E3] };
  expect(planWrite('target_temperature', 20, newer).commands[0].path).toBe(PATHS.HEATING_CIRCUIT_0_TARGET_E3);
  expect(planWrite('target_temperature', 20, { features: [] }).commands[0].path).toBe(PATHS.HEATING_CIRCUIT_0_TARGET);
  expect(planWrite('thermostat_mode', 'off', { operatingModes: [{ id: 'dhw' }], currentValue: () => 'dhwAndHeating' }).commands)
    .toEqual([{ path: PATHS.HEATING_CIRCUIT_0_MODE, command: 'setMode', parameters: { mode: 'dhw' } }]);
  expect(() => planWrite('measure_status_text', 'x', {})).toThrow('measure_status_text cannot be changed');
});

test('an error with a known code is shown in the user\'s language, any other with its own message', () => {
  const coded = Object.assign(new Error('raw'), { code: 'program_follows_schedule' });
  expect(writeErrorMessage({ __: (key) => `sv:${key}` }, coded)).toBe('sv:commands.program_follows_schedule');
  expect(writeErrorMessage(undefined, coded)).toBe(en.commands.program_follows_schedule);
  expect(writeErrorMessage(undefined, Object.assign(new Error('raw'), { code: 'unknown_code' }))).toBe('raw');
  expect(writeErrorMessage(undefined, new Error('plain'))).toBe('plain');
  expect(writeErrorMessage(undefined, 'text')).toBe('text');
});
