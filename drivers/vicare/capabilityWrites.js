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

// Writing a capability value, from a capability listener or a Flow action. A configured
// capability writes through its command on the feature path the device has (newer devices name
// some programs differently), with device.executeCommand. A derived capability (config/*.js →
// DERIVED) plans its own commands, which commands.js sends in order, like every other write.

const { FEATURES } = require('./config');
const { featureMapper } = require('./featureMapper');
const { sendCommands } = require('./commands');
const { userErrorFrom } = require('./userErrors');

/** @typedef {import('./config/types').CapabilityConfig} CapabilityConfig */

/**
 * The parts of a device a write needs.
 * @typedef {import('./commands').CommandDevice & {
 *   _features?: string[],
 *   deviceContext: () => import('./config/types').DeviceContext,
 *   executeCommand: (path: string, capability: CapabilityConfig, value: any) => Promise<any>,
 *   checkOperatingMode: (path: string, mode: any) => void,
 *   setCapabilityValueIfPossible: (capabilityName: string, value: any) => Promise<void>,
 * }} WriteDevice
 */

/**
 * The capabilities on `path` that show a value written through `capability`: itself, and the
 * others that show the same property without a value mapping (the heating set point and the
 * standard thermostat's).
 * @param {string} path
 * @param {CapabilityConfig} capability
 * @returns {string[]}
 */
function capabilitiesShowing(path, capability) {
  const others = (FEATURES[path]?.capabilities || [])
    .filter((other) => other.capabilityName !== capability.capabilityName && !capability.valueMapping
      && other.propertyPath === capability.propertyPath && !other.valueMapping)
    .map((other) => other.capabilityName);
  return [capability.capabilityName, ...others];
}

/**
 * Writes `value` to a capability of the device. Throws for a capability that cannot be changed,
 * and the user's text for a value the device cannot take.
 * @param {WriteDevice} device
 * @param {string} capabilityName
 * @param {any} value
 * @returns {Promise<boolean>}
 */
async function writeCapability(device, capabilityName, value) {
  const derived = featureMapper.derivedByName(capabilityName);
  if (!derived?.write) {
    const target = featureMapper.commandTarget(capabilityName, device._features);
    if (!target?.capability.command) throw new Error(`${capabilityName} cannot be changed`);
    return device.executeCommand(target.path, target.capability, value);
  }
  let plan;
  try {
    plan = derived.write(value, device.deviceContext());
  } catch (error) {
    throw userErrorFrom(device, error);
  }
  await sendCommands(device, plan.commands, {
    check: (command) => device.checkOperatingMode(command.path, command.parameters.mode),
    confirm: plan.values,
  });
  for (const [name, shown] of Object.entries(plan.values)) await device.setCapabilityValueIfPossible(name, shown);
  return true;
}

module.exports = { capabilitiesShowing, writeCapability };
