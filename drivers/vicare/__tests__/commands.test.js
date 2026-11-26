/* eslint-env jest */

'use strict';

// Sending commands (commands.js): what a capability write sends, and how sending checks, routes
// and reports.

// lib/errorMessages.js (translations) loads homey-oauth2app through lib/apiError.js
// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const { capabilityCommand, sendFeatureCommand } = require('../commands');
const { getCapability, PATHS } = require('../config');

const CURVE = 'heating.circuits.0.heating.curve';
const METADATA = {
  [CURVE]: {
    setCurve: {
      isExecutable: true,
      params: {
        slope: { type: 'number', required: true, constraints: { min: 0, max: 3.5, stepping: 0.1 } },
        shift: { type: 'number', required: true, constraints: { min: -15, max: 40, stepping: 1 } },
      },
    },
  },
};

function device({ result = { data: { success: true } }, circuit = '0', commands = METADATA } = {}) {
  return {
    _commands: commands,
    _installationId: 'installation',
    _gatewaySerial: 'gateway',
    _deviceId: '0',
    _heatingCircuitId: circuit,
    oAuth2Client: { executeCommand: jest.fn(async () => result) },
    error: jest.fn(),
  };
}

describe('capabilityCommand', () => {
  test('a named command gets the value in every mapped parameter', () => {
    expect(capabilityCommand(getCapability(PATHS.HOT_WATER_TARGET), 50))
      .toEqual({ command: 'setTargetTemperature', parameters: { temperature: 50 } });
    expect(capabilityCommand(getCapability(PATHS.HEATING_CIRCUIT_0_MODE), 'dhw'))
      .toEqual({ command: 'setMode', parameters: { mode: 'dhw' } });
  });

  test('a value used as the command is mapped, without parameters', () => {
    const charge = getCapability(PATHS.HOT_WATER_CHARGE);
    expect(capabilityCommand(charge, 'activate')).toEqual({ command: 'activate', parameters: {} });
    expect(capabilityCommand(charge, true)).toEqual({ command: 'activate', parameters: {} });
  });

  test('a read-only capability cannot be written', () => {
    expect(() => capabilityCommand(getCapability(PATHS.OUTSIDE_TEMP), 1)).toThrow('measure_temperature.outside cannot be written');
  });
});

describe('sendFeatureCommand', () => {
  test('sends to the device\'s heating circuit', async () => {
    const target = device({ circuit: '2' });
    await sendFeatureCommand(target, CURVE, 'setCurve', { slope: 1, shift: 0 });
    expect(target.oAuth2Client.executeCommand).toHaveBeenCalledWith({
      installationId: 'installation',
      gatewaySerial: 'gateway',
      deviceId: '0',
      feature: 'heating.circuits.2.heating.curve',
      command: 'setCurve',
      body: { slope: 1, shift: 0 },
    });
  });

  test('refuses before sending: the extra check first, then the command metadata', async () => {
    const target = device();
    await expect(sendFeatureCommand(target, CURVE, 'setCurve', { slope: 1, shift: 0 }, {
      check: () => {
        throw new Error('not on this circuit');
      },
    })).rejects.toThrow('Error executing command: not on this circuit');
    await expect(sendFeatureCommand(target, CURVE, 'setCurve', { slope: 9, shift: 0 }))
      .rejects.toThrow('Error executing command: slope is outside the supported range');
    expect(target.oAuth2Client.executeCommand).not.toHaveBeenCalled();
    expect(target.error).toHaveBeenCalledWith('Error executing command:', expect.any(Error));
  });

  test('a response with success false is an error with Viessmann\'s reason', async () => {
    const target = device({ result: { data: { success: false, message: 'locked' } } });
    await expect(sendFeatureCommand(target, CURVE, 'setCurve', { slope: 1, shift: 0 }))
      .rejects.toThrow('Error executing command: Viessmann rejected command: locked');
  });

  test('an API error keeps its cause, status and Retry-After', async () => {
    const target = device();
    const apiError = Object.assign(new Error('Viessmann HTTP 429'), { status: 429, retryAfterMs: 60000 });
    target.oAuth2Client.executeCommand.mockRejectedValueOnce(apiError);
    const error = await sendFeatureCommand(target, CURVE, 'setCurve', { slope: 1, shift: 0 }).catch((caught) => caught);
    expect(error).toEqual(expect.objectContaining({
      message: 'Error executing command: Viessmann HTTP 429', status: 429, retryAfterMs: 60000, cause: apiError,
    }));
  });
});
