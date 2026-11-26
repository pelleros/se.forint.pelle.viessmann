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
//
// After a write the device shows the new values at once (showWrittenValues): the capabilities
// written, and the derived capabilities computed the way the next poll will compute them, from
// the features the device last heard of with the written values in place. So the standard
// thermostat mode follows a new operating mode right away, without an API call.

const { FEATURES } = require('./config');
const { featureMapper } = require('./featureMapper');
const { sendCommands } = require('./commands');
const { userErrorFrom } = require('./userErrors');
const { knownFeatures } = require('./featureCards');
const { withWrittenValues } = require('./derivedCapabilities');

/** @typedef {import('./config/types').CapabilityConfig} CapabilityConfig */

/**
 * The parts of a device a write needs.
 * @typedef {import('./commands').CommandDevice & {
 *   _features?: string[],
 *   deviceContext: () => import('./config/types').DeviceContext,
 *   executeCommand: (path: string, capability: CapabilityConfig, value: any) => Promise<any>,
 *   checkOperatingMode: (path: string, mode: any) => void,
 *   setCapabilityValueIfPossible: (capabilityName: string, value: any) => Promise<void>,
 *   readCapabilityValues: (response: { data: any[] }) => Map<string, { value: any, gone: boolean }>,
 *   _featureCache?: any,
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
 * The feature property a capability value was written to, on the path the device has; null for
 * a value that is not a property value as it is (a derived capability, a value mapping, a value
 * that is the command itself, a value the device computes).
 * @param {string} capabilityName
 * @param {any} value
 * @param {string[] | undefined} storedFeatures
 * @returns {{ path: string, propertyPath: string, value: any } | null}
 */
function writtenProperty(capabilityName, value, storedFeatures) {
  const target = featureMapper.commandTarget(capabilityName, storedFeatures);
  if (!target) return null;
  const { capability } = target;
  if (capability.valueMapping || capability.computed || capability.command?.useValueAsCommand) return null;
  return { path: target.path, propertyPath: capability.propertyPath, value };
}

/**
 * Shows written values on the device at once: the capabilities written, then every derived
 * capability as the next poll will derive it, from the features the device last heard of with
 * the written values in place (no API call). Derived capabilities that were written themselves
 * keep their written value.
 * @param {WriteDevice} device
 * @param {Record<string, any>} values capability name → value written
 */
async function showWrittenValues(device, values) {
  for (const [name, value] of Object.entries(values)) await device.setCapabilityValueIfPossible(name, value);
  /** @type {{ path: string, propertyPath: string, value: any }[]} */
  const writes = [];
  for (const [name, value] of Object.entries(values)) {
    const write = writtenProperty(name, value, device._features);
    if (write) writes.push(write);
  }
  if (writes.length === 0) return;
  const readings = device.readCapabilityValues({ data: withWrittenValues(knownFeatures(device), writes) });
  for (const { capabilityName } of featureMapper.DERIVED) {
    const value = readings.get(capabilityName)?.value;
    if (value !== undefined && !(capabilityName in values)) await device.setCapabilityValueIfPossible(capabilityName, value);
  }
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
  await showWrittenValues(device, plan.values);
  return true;
}

module.exports = {
  capabilitiesShowing, writtenProperty, showWrittenValues, writeCapability,
};
