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

// Commands that are not the write of one capability: the heating curve (both of its values at
// once) and the generic command card. Like device.executeCommand, a command is checked against
// the device's command metadata before it is sent, goes to the device's heating circuit, and
// a response with `success: false` is an error.

const validateCommand = require('../../lib/commandValidation');
const { resolveCircuitPath } = require('./heatingCircuit');

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
 */

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
 * Checks and sends a command. Errors carry the API's reason, like device.executeCommand.
 * @param {CommandDevice} device
 * @param {string} path circuit-normalized feature path
 * @param {string} command
 * @param {Record<string, any>} parameters
 * @returns {Promise<void>}
 */
async function sendFeatureCommand(device, path, command, parameters) {
  try {
    checkFeatureCommand(device, path, command, parameters);
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
    device.error('Error executing command:', error);
    const reason = error instanceof Error ? error.message : String(error);
    /** @type {Error & { status?: number, retryAfterMs?: number }} */
    const wrapped = new Error(`Error executing command: ${reason}`, { cause: error });
    wrapped.status = /** @type {any} */ (error)?.status;
    wrapped.retryAfterMs = /** @type {any} */ (error)?.retryAfterMs;
    throw wrapped;
  }
}

module.exports = { checkFeatureCommand, sendFeatureCommand };
