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

// What a write to a capability sends: the commands, in order, and the capability values to show
// once all of them succeeded. A configured capability writes through its command on the feature
// path the device has; a derived capability (config/*.js → DERIVED) plans its own commands.
// device.js sends the plan; nothing here talks to Homey or the API.

const { FEATURES } = require('./config');
const { featureMapper } = require('./featureMapper');
const { translate } = require('../../lib/errorMessages');

/** @typedef {import('./config/types').CapabilityConfig} CapabilityConfig */
/** @typedef {import('./config/types').DerivedWrite} WritePlan */

/**
 * The command and parameters that write `value` through a configured capability: a named
 * command whose parameters all get the value, or the (mapped) value itself as the command name.
 * @param {CapabilityConfig} capability
 * @param {any} value
 * @returns {{ command: string, parameters: Record<string, any> }}
 */
function capabilityCommand(capability, value) {
  const config = capability.command;
  if (!config) throw new Error(`${capability.capabilityName} cannot be changed`);
  if (config.useValueAsCommand) return { command: capability.valueMapping?.[value] || value, parameters: {} };
  /** @type {Record<string, any>} */
  const parameters = {};
  for (const parameter of Object.values(config.parameterMapping || {})) parameters[parameter] = value;
  return { command: /** @type {string} */ (config.name), parameters };
}

/**
 * The write through a configured capability on `path`: its command, then the new value for the
 * capability and for the others on the path that show the same property (the heating set point
 * and the standard thermostat's).
 * @param {string} path
 * @param {CapabilityConfig} capability
 * @param {any} value
 * @returns {WritePlan}
 */
function configuredWrite(path, capability, value) {
  const { command, parameters } = capabilityCommand(capability, value);
  const shown = (FEATURES[path]?.capabilities || [])
    .filter((other) => other.capabilityName === capability.capabilityName
      || (other.propertyPath === capability.propertyPath && !other.valueMapping && !capability.valueMapping))
    .map((other) => other.capabilityName);
  const names = shown.length > 0 ? shown : [capability.capabilityName];
  return { commands: [{ path, command, parameters }], values: Object.fromEntries(names.map((name) => [name, value])) };
}

/**
 * The write of `value` to a capability of a device. Throws for a capability that cannot be
 * changed, and (derived capabilities) an error with a `code` for a value the device cannot take.
 * @param {string} capabilityName
 * @param {any} value
 * @param {import('./config/types').DeviceContext} context
 * @returns {WritePlan}
 */
function planWrite(capabilityName, value, context) {
  const derived = featureMapper.derivedByName(capabilityName);
  if (derived?.write) return derived.write(value, context);
  const target = featureMapper.commandTarget(capabilityName, context.features);
  if (!target?.capability.command) throw new Error(`${capabilityName} cannot be changed`);
  return configuredWrite(target.path, target.capability, value);
}

/**
 * The message of a write error in the user's language: the translation of its code
 * (locales/*.json → commands) when it has one, else its own message.
 * @param {any} homey
 * @param {unknown} error
 * @returns {string}
 */
function writeErrorMessage(homey, error) {
  const fallback = error instanceof Error ? error.message : String(error);
  const code = /** @type {any} */ (error)?.code;
  if (typeof code !== 'string') return fallback;
  const key = `commands.${code}`;
  const text = translate(homey, key);
  return text === key ? fallback : text;
}

module.exports = {
  capabilityCommand, configuredWrite, planWrite, writeErrorMessage,
};
