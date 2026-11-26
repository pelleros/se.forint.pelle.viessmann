/* eslint-env jest */

'use strict';

// deviceSettings.js: the rules behind a changed device setting. Whole devices are covered by
// pollSettings.test.js (interval, event log), optionalGroups.test.js and heatingCircuit.test.js
// (switching circuits, rollback, paused polling).

// lib/errorMessages.js (translations) loads homey-oauth2app through lib/apiError.js
// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const { PATHS, getCapability } = require('../config');
const {
  applySettings, circuitSetting, circuitNotAvailableMessage, circuitCapabilitiesNotReported,
} = require('../deviceSettings');

test('the heating circuit setting is "auto" or a circuit number', () => {
  expect(circuitSetting('auto')).toBe('auto');
  expect(circuitSetting(' 1 ')).toBe('1');
  expect(circuitSetting(2)).toBe('2');
  expect(() => circuitSetting('first')).toThrow('Unknown heating circuit setting: first');
});

test('a circuit the installation does not have is explained in the user\'s language, with the circuits it has, counted from 1', () => {
  const error = { circuit: '2', available: ['0', '1'], message: 'Heating circuit 2 is not available' };
  const homey = { __: jest.fn((key, tags) => `Circuit ${tags.circuit} not there, only ${tags.available}`) };
  expect(circuitNotAvailableMessage(homey, error)).toBe('Circuit 3 not there, only 1, 2');
  circuitNotAvailableMessage(homey, { ...error, available: [] });
  expect(homey.__).toHaveBeenLastCalledWith('device_settings.heating_circuit_not_available', { circuit: '3', available: '–' });
  // No translation: English
  const english = 'Heating circuit 3 is not available on this installation. Available circuits: 1, 2.';
  expect(circuitNotAvailableMessage({ __: (key) => key }, error)).toBe(english);
  expect(circuitNotAvailableMessage(undefined, error)).toBe(english);
});

test('after a switch, only per-circuit capabilities the new circuit does not report lose their value', () => {
  const supply = getCapability(PATHS.HEATING_CIRCUIT_0_SUPPLY_TEMPERATURE).capabilityName;
  const room = getCapability(PATHS.HEATING_CIRCUIT_0_ROOM_TEMPERATURE).capabilityName;
  const notReported = circuitCapabilitiesNotReported([PATHS.HEATING_CIRCUIT_0_SUPPLY_TEMPERATURE]);
  expect(notReported).toContain(room);
  expect(notReported).not.toContain(supply);
  expect(notReported).not.toContain(getCapability(PATHS.HOT_WATER_TEMP).capabilityName);
});

test('poll settings that plan too many calls are refused before anything else changes', async () => {
  const device = {
    homey: {},
    driver: { plannedCallsPerDay: jest.fn(() => 5000), _startPolling: jest.fn() },
    getStoreValue: () => 'session',
    getFeatures: jest.fn(),
    applyEnabledGroups: jest.fn(),
  };
  const newSettings = { pollInterval: '2', eventLog: '15', heatingCircuit: '1' };
  await expect(applySettings(device, { newSettings, changedKeys: ['pollInterval', 'heatingCircuit', 'diagnosticValues'] }))
    .rejects.toThrow(/5000/);
  expect(device.driver.plannedCallsPerDay).toHaveBeenCalledWith('session', { device, settings: { pollInterval: '2', eventLog: '15' } });
  expect(device.getFeatures).not.toHaveBeenCalled();
  expect(device.applyEnabledGroups).not.toHaveBeenCalled();
  expect(device.driver._startPolling).not.toHaveBeenCalled();
});
