/* eslint-env jest */

'use strict';

// capabilityWrites.js: where a capability write goes and what it shows afterwards.

// lib/errorMessages.js (translations) loads homey-oauth2app through lib/apiError.js
// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const { PATHS, getCapability, getAllCapabilities } = require('../config');
const { capabilitiesShowing, writeCapability } = require('../capabilityWrites');
const en = require('../../../locales/en.json');

const HEATING_TARGET = getCapability(PATHS.HEATING_CIRCUIT_0_TARGET);
const CHARGE = getCapability(PATHS.HOT_WATER_CHARGE);
const ECO_PROGRAM = 'heating.circuits.0.operating.programs.eco';

// A device that records what it sends and shows
function device({ features = [], operatingModes = [], current = {} } = {}) {
  const shown = {};
  const remembered = [];
  return {
    shown,
    remembered,
    _features: features,
    _commands: undefined,
    _installationId: 'installation',
    _gatewaySerial: 'gateway',
    _deviceId: '0',
    _heatingCircuitId: '0',
    homey: { __: () => undefined },
    oAuth2Client: { executeCommand: jest.fn(async () => ({ data: { success: true } })) },
    error: jest.fn(),
    getMonitor: () => ({ rememberWrite: (...args) => remembered.push(args) }),
    deviceContext: () => ({ features, operatingModes, currentValue: (name) => current[name] }),
    executeCommand: jest.fn(async () => true),
    checkOperatingMode: jest.fn(),
    setCapabilityValueIfPossible: jest.fn(async (name, value) => {
      shown[name] = value;
    }),
  };
}

const sent = (target) => target.oAuth2Client.executeCommand.mock.calls.map(([request]) => [request.feature, request.command, request.body]);

test('a value written through a capability shows on the capabilities of the same property', () => {
  expect(getAllCapabilities(PATHS.HEATING_CIRCUIT_0_TARGET).map((capability) => capability.capabilityName))
    .toEqual(['target_temperature.heating', 'target_temperature']);
  expect(capabilitiesShowing(PATHS.HEATING_CIRCUIT_0_TARGET, HEATING_TARGET)).toEqual(['target_temperature.heating', 'target_temperature']);
  expect(capabilitiesShowing(PATHS.HOT_WATER_CHARGE, CHARGE)).toEqual(['thermostat_mode.hotWaterOneTimeCharge']);
});

test('a configured capability writes on the feature path the device has', async () => {
  const newer = device({ features: [PATHS.HEATING_CIRCUIT_0_TARGET_E3] });
  await writeCapability(newer, 'target_temperature', 20);
  expect(newer.executeCommand).toHaveBeenCalledWith(PATHS.HEATING_CIRCUIT_0_TARGET_E3, expect.objectContaining({ capabilityName: 'target_temperature' }), 20);

  const older = device({ features: [] });
  await writeCapability(older, 'target_temperature', 20);
  expect(older.executeCommand).toHaveBeenCalledWith(PATHS.HEATING_CIRCUIT_0_TARGET, expect.objectContaining({ capabilityName: 'target_temperature' }), 20);

  await expect(writeCapability(older, 'measure_status_text', 'x')).rejects.toThrow('measure_status_text cannot be changed');
  await expect(writeCapability(older, 'measure_temperature.outside', 1)).rejects.toThrow('measure_temperature.outside cannot be changed');
});

test('a derived capability sends its commands in order, then shows its values and has them confirmed', async () => {
  const target = device({ operatingModes: [{ id: 'dhw' }, { id: 'dhwAndHeating' }], current: { 'thermostat_mode.heating': 'dhwAndHeating' } });
  await expect(writeCapability(target, 'thermostat_mode', 'off')).resolves.toBe(true);

  expect(sent(target)).toEqual([[PATHS.HEATING_CIRCUIT_0_MODE, 'setMode', { mode: 'dhw' }]]);
  expect(target.checkOperatingMode).toHaveBeenCalledWith(PATHS.HEATING_CIRCUIT_0_MODE, 'dhw');
  expect(target.shown).toEqual({ thermostat_mode: 'off', 'thermostat_mode.heating': 'dhw' });
  expect(target.remembered).toEqual([['thermostat_mode', 'off'], ['thermostat_mode.heating', 'dhw']]);
  expect(target.executeCommand).not.toHaveBeenCalled();
});

test('a value the device cannot take is refused in the user\'s language, and nothing is sent', async () => {
  const target = device({ features: [PATHS.HEATING_CIRCUIT_0_COMFORT], current: { 'thermostat_mode.heatingProgram': 'normal' } });
  await expect(writeCapability(target, 'thermostat_mode.heatingProgram', 'reduced'))
    .rejects.toMatchObject({ code: 'program_follows_schedule', message: en.flow.program_follows_schedule });
  await expect(writeCapability(target, 'thermostat_mode.heatingProgram', 'eco'))
    .rejects.toMatchObject({ code: 'program_not_available', message: en.flow.program_not_available });
  // An error without a text of its own stays as it is
  await expect(writeCapability(target, 'thermostat_mode.heatingProgram', 'party')).rejects.toThrow('Unknown program: party');
  expect(sent(target)).toEqual([]);
  expect(target.shown).toEqual({});
});

test('a refused command stops the write: nothing after it is sent or shown', async () => {
  const target = device({ features: [PATHS.HEATING_CIRCUIT_0_COMFORT, ECO_PROGRAM], current: { 'thermostat_mode.heatingProgram': 'comfort' } });
  target.checkOperatingMode.mockImplementation(() => {});
  target.oAuth2Client.executeCommand.mockResolvedValueOnce({ data: { success: false, reason: 'busy' } });
  await expect(writeCapability(target, 'thermostat_mode.heatingProgram', 'eco')).rejects.toThrow('busy');
  expect(sent(target)).toEqual([[PATHS.HEATING_CIRCUIT_0_COMFORT, 'deactivate', {}]]);
  expect(target.shown).toEqual({});
  expect(target.remembered).toEqual([]);
});
