/*
 *
 *  Copyright (C) 2024 Per Rosengren
 *  This file is part of se.forint.pelle.viessmann project.
 *
 *  se.forint.pelle.viessmann project is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  se.forint.pelle.viessmann project is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with se.forint.pelle.viessmann project.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

// @ts-check

'use strict';

// Sending a command to the device: every write goes through sendFeatureCommand, whether it is a
// capability write (device.executeCommand, with capabilityCommand), the commands a derived
// capability plans (sendCommands, from capabilityWrites.js), the heating curve (both of its
// values at once) or the generic command card. A command is checked against the device's
// command metadata before it is sent, goes to the device's heating circuit, and a response with
// `success: false` is an error. Errors keep the API's reason, status and Retry-After. Anything
// that must happen around every write belongs in sendFeatureCommand, so that capability
// listeners and Flow cards get it alike: the account's allowance (writeQuota.js) and confirming
// the written values on a later poll (deviceMonitor.js).

const validateCommand = require('../../lib/commandValidation');
const { resolveCircuitPath } = require('./heatingCircuit');
const { translate } = require('../../lib/errorMessages');
const { takeAccountWrite } = require('./writeQuota');

/**
 * The parts of a device a command needs.
 * @typedef {object} CommandDevice
 * @property {Record<string, any> | undefined} _commands the command metadata per feature
 * @property {string} _installationId
 * @property {string} _gatewaySerial
 * @property {string} _deviceId
 * @property {string | undefined} _heatingCircuitId
 * @property {{ executeCommand: (request: Record<string, any>) => Promise<any> }} oAuth2Client
 * @property {(...args: any[]) => void} error
 * @property {any} [homey] for the translated texts
 * @property {(key: string) => any} [getStoreValue] the account (OAuth2SessionId) for writeQuota.js
 * @property {{ plannedCallsPerDay?: (sessionId: string | undefined) => number }} [driver]
 * @property {() => { rememberWrite: (capabilityName: string, value: any) => void }} [getMonitor]
 */

/**
 * The command and parameters that write `value` to a configured capability: a named command
 * whose parameters all get the value, or the (mapped) value itself as the command name.
 * @param {import('./config/types').CapabilityConfig} capability
 * @param {any} value
 * @returns {{ command: string, parameters: Record<string, any> }}
 */
function capabilityCommand(capability, value) {
  const config = capability.command;
  if (!config) throw new Error(`${capability.capabilityName} cannot be written`);
  if (config.useValueAsCommand) return { command: capability.valueMapping?.[value] || value, parameters: {} };
  /** @type {Record<string, any>} */
  const parameters = {};
  for (const parameter of Object.values(config.parameterMapping || {})) parameters[parameter] = value;
  return { command: /** @type {string} */ (config.name), parameters };
}

/**
 * Checks a command against the device's command metadata (throws when it is not allowed).
 * @param {CommandDevice} device
 * @param {string} path circuit-normalized feature path
 * @param {string} command
 * @param {Record<string, any>} parameters
 */
function checkFeatureCommand(device, path, command, parameters) {
  validateCommand(device._commands, path, command, parameters);
}

/**
 * The error the user sees for a command that failed, keeping the API's reason (status,
 * Viessmann error type/message), status and Retry-After. A refused write (403) can be a temporary
 * fault at Viessmann: nothing is removed for it.
 * @param {CommandDevice} device
 * @param {unknown} error
 * @returns {Error & { status?: number, retryAfterMs?: number }}
 */
function commandError(device, error) {
  device.error('Error executing command:', error);
  const reason = error instanceof Error ? error.message : String(error);
  const status = /** @type {any} */ (error)?.status;
  /** @type {Error & { status?: number, retryAfterMs?: number }} */
  const wrapped = new Error(status === 403
    ? translate(device.homey, 'errors.command_refused', { detail: reason })
    : `Error executing command: ${reason}`, { cause: error });
  wrapped.status = status;
  wrapped.retryAfterMs = /** @type {any} */ (error)?.retryAfterMs;
  return wrapped;
}

/**
 * Checks and sends a command. `check` can refuse it first (e.g. an operating mode the circuit
 * does not have); its error is reported like any other. Then the account must be able to spare
 * the call (writeQuota.js, whose text the user sees as it is); `restoring` (undoing a temporary
 * change) is never refused. After a successful write, a later poll checks that the device shows
 * the values in `confirm` (capability name → value written; deviceMonitor.js).
 * @param {CommandDevice} device
 * @param {string} path circuit-normalized feature path
 * @param {string} command
 * @param {Record<string, any>} parameters
 * @param {{ check?: () => void, restoring?: boolean, confirm?: Record<string, any> }} [options]
 * @returns {Promise<void>}
 */
async function sendFeatureCommand(device, path, command, parameters, { check, restoring = false, confirm = {} } = {}) {
  try {
    check?.();
    checkFeatureCommand(device, path, command, parameters);
  } catch (error) {
    throw commandError(device, error);
  }
  // After the checks, so that a refused value takes nothing from the account
  try {
    takeAccountWrite(device, { restoring });
  } catch (error) {
    device.error('Write refused:', error instanceof Error ? error.message : error);
    throw error;
  }
  try {
    const result = await device.oAuth2Client.executeCommand({
      installationId: device._installationId,
      gatewaySerial: device._gatewaySerial,
      deviceId: device._deviceId,
      feature: resolveCircuitPath(path, device._heatingCircuitId),
      command,
      body: parameters,
    });
    if (result?.data?.success === false) {
      throw new Error(`Viessmann rejected command: ${result.data.reason || result.data.message || 'Unknown reason'}`);
    }
  } catch (error) {
    throw commandError(device, error);
  }
  const monitor = device.getMonitor?.();
  for (const [capabilityName, value] of Object.entries(confirm)) monitor?.rememberWrite(capabilityName, value);
}

/**
 * Writes `value` to a configured capability (see capabilityCommand), to be confirmed on a later
 * poll; except a command that is the value itself (such as starting a one-time charge, which
 * ends by itself), which the device does not keep showing.
 * @param {CommandDevice} device
 * @param {string} path circuit-normalized feature path
 * @param {import('./config/types').CapabilityConfig} capability
 * @param {any} value
 * @param {{ check?: () => void, restoring?: boolean }} [options]
 * @returns {Promise<void>}
 */
async function sendCapabilityValue(device, path, capability, value, { check, restoring } = {}) {
  const { command, parameters } = capabilityCommand(capability, value);
  const confirm = capability.command?.useValueAsCommand ? {} : { [capability.capabilityName]: value };
  await sendFeatureCommand(device, path, command, parameters, { check, restoring, confirm });
}

/**
 * Sends commands in order, each with sendFeatureCommand, and stops at the first that fails (a
 * write of a derived capability, such as a program switch that ends one program before it
 * starts another). `check` can refuse each command before it is sent. Once the last one
 * succeeded, a later poll checks the values in `confirm` (capability name → value).
 * @param {CommandDevice} device
 * @param {{ path: string, command: string, parameters: Record<string, any> }[]} commands
 * @param {{ check?: (command: { path: string, command: string, parameters: Record<string, any> }) => void,
 *   confirm?: Record<string, any> }} [options]
 * @returns {Promise<void>}
 */
async function sendCommands(device, commands, { check, confirm = {} } = {}) {
  for (const [index, entry] of commands.entries()) {
    await sendFeatureCommand(device, entry.path, entry.command, entry.parameters, {
      check: check && (() => check(entry)),
      confirm: index === commands.length - 1 ? confirm : {},
    });
  }
}

module.exports = {
  capabilityCommand, checkFeatureCommand, sendFeatureCommand, sendCapabilityValue, sendCommands,
};
