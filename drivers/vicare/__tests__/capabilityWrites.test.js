/* eslint-env jest */

'use strict';

// capabilityWrites.js: where a capability write goes and what it shows afterwards.

// lib/errorMessages.js (translations) loads homey-oauth2app through lib/apiError.js
// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const { PATHS, getCapability, getAllCapabilities } = require('../config');
const {
  capabilitiesShowing, writtenProperty, showWrittenValues, writeCapability,
} = require('../capabilityWrites');
const { featureMapper } = require('../featureMapper');
const { recordFeatures } = require('../featureCards');
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
    readCapabilityValues: (response) => featureMapper.readValues(response, ['type:heatpump'], { language: 'en', features }),
  };
}

// A feature as a poll reports it
const reported = (path, properties) => ({ feature: path, isEnabled: true, properties });

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

describe('showing written values at once', () => {
  test('a written value is a property value only for a configured capability without mapping', () => {
    expect(writtenProperty('thermostat_mode.heating', 'dhw', [])).toEqual({ path: PATHS.HEATING_CIRCUIT_0_MODE, propertyPath: 'value.value', value: 'dhw' });
    expect(writtenProperty('target_temperature', 21, [PATHS.HEATING_CIRCUIT_0_TARGET_E3]))
      .toEqual({ path: PATHS.HEATING_CIRCUIT_0_TARGET_E3, propertyPath: 'temperature.value', value: 21 });
    expect(writtenProperty('thermostat_mode', 'off', [])).toBeNull();
    expect(writtenProperty('thermostat_mode.hotWaterOneTimeCharge', 'activate', [])).toBeNull();
    expect(writtenProperty('measure_power', 900, [])).toBeNull();
  });

  test('the derived capabilities follow the written value as the next poll will show them', async () => {
    const target = device();
    recordFeatures(target, { data: [reported(PATHS.HEATING_CIRCUIT_0_MODE, { value: { type: 'string', value: 'dhwAndHeating' } })] });
    await showWrittenValues(target, { 'thermostat_mode.heating': 'dhw' });
    expect(target.shown).toEqual({ 'thermostat_mode.heating': 'dhw', thermostat_mode: 'off' });
    expect(target.oAuth2Client.executeCommand).not.toHaveBeenCalled();
  });

  test('a derived capability that was written keeps its written value', async () => {
    const target = device();
    recordFeatures(target, { data: [reported(PATHS.HEATING_CIRCUIT_0_MODE, { value: { type: 'string', value: 'dhwAndHeating' } })] });
    await showWrittenValues(target, { 'thermostat_mode.heating': 'standby', thermostat_mode: 'off' });
    expect(target.setCapabilityValueIfPossible.mock.calls).toEqual([['thermostat_mode.heating', 'standby'], ['thermostat_mode', 'off']]);
  });

  test('without known features, or without a property written, only the written values are shown', async () => {
    const unknown = device();
    await showWrittenValues(unknown, { 'thermostat_mode.heating': 'dhw' });
    expect(unknown.shown).toEqual({ 'thermostat_mode.heating': 'dhw' });

    const charge = device();
    charge.readCapabilityValues = jest.fn();
    await showWrittenValues(charge, { 'thermostat_mode.hotWaterOneTimeCharge': 'activate' });
    expect(charge.readCapabilityValues).not.toHaveBeenCalled();
  });
});
