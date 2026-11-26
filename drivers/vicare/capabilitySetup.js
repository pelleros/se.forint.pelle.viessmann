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

// Which capabilities a device has, and how they are set up: the capabilities of its stored
// features that its roles and optional groups allow (and the removal of capabilities nothing
// produces any more), their options from the config and the API's limits, the operating modes
// of its heating circuit, and one listener per writable capability. Runs on every start, after
// an extended poll found new features or a response showed a new role, when an optional group is
// turned on or off, when the heating circuit changes and after the maintenance action. The
// mapping itself is in featureMapper.js; this module applies it to a device.

const { hasRoleTags } = require('./roles');
const { PATHS, getCapability } = require('./config');
const { MODE_TITLES } = require('./config/modes');
const { featureMapper, mergeOperatingModes } = require('./featureMapper');

/** @typedef {import('./featureMapper').ModeValue} ModeValue */

/**
 * Adds the capabilities of every stored feature that the device's roles and optional groups
 * allow, with the API's temperature limits as min/max/step, and removes the capabilities that no
 * stored feature produces any more (or whose group is off). Inferred roles (roles.js) only ever
 * add capabilities: without role tags of its own, a device keeps every capability whose feature
 * is stored.
 * @param {any} device the ViessmannDevice
 */
async function initializeCapabilities(device) {
  // Without a stored feature list (pairings older than 1.0.9 whose refresh failed) every
  // capability would look obsolete; leave them alone until the refresh succeeds
  if (!Array.isArray(device._features)) {
    device.error('No stored feature list, capabilities are left unchanged');
    return;
  }

  const roles = device.getRoles();
  const groups = device.getEnabledGroups();
  const keepAllowed = (/** @type {string} */ path) => featureMapper.isInEnabledGroup(path, groups)
    && (!hasRoleTags(device._roles) || featureMapper.hasRequiredRole(path, roles));

  for (const existingCap of device.getCapabilities()) {
    if (!featureMapper.isProduced(existingCap, device._features, keepAllowed)) {
      await device.removeCapability(existingCap);
      device.log(`Removed capability: ${existingCap}`);
    }
  }

  for (const { path, capability: { capabilityName } } of featureMapper.capabilitiesFor(device._features, roles, groups)) {
    if (device.hasCapability(capabilityName)) continue;
    try {
      await device.setCapabilityOptions(capabilityName, featureMapper.optionsFor(capabilityName, path, device._constraints, device.deviceContext()));
      await device.addCapability(capabilityName);
    } catch (err) {
      device.error(`Error handling capability ${capabilityName} for ${path}:`, err);
    }
  }
}

/**
 * The feature path whose options and limits a capability takes on this device: a derived
 * capability's first source, else the path a write goes through (newer devices name some
 * programs differently). Undefined for a capability that no stored feature produces.
 * @param {string} capabilityName
 * @param {string[] | undefined} storedFeatures
 * @returns {string | undefined}
 */
function optionsPath(capabilityName, storedFeatures) {
  const derived = featureMapper.derivedByName(capabilityName);
  return derived ? derived.sources[0] : featureMapper.commandTarget(capabilityName, storedFeatures)?.path;
}

/**
 * Sets every capability's options again, from the config and the API's limits, so that devices
 * that already have a capability get changed options without a new pairing.
 * @param {any} device the ViessmannDevice
 */
async function updateCapabilityOptions(device) {
  const context = device.deviceContext();
  for (const capabilityName of device.getCapabilities()) {
    const path = optionsPath(capabilityName, device._features);
    if (!path) continue;
    try {
      await device.setCapabilityOptions(capabilityName, featureMapper.optionsFor(capabilityName, path, device._constraints, context));
    } catch (error) {
      device.error(`Could not update the options of ${capabilityName}:`, error);
    }
  }
}

/**
 * The device's operating modes, with the translated titles of the modes the app knows.
 * @param {unknown} operatingModes the stored operating modes
 * @returns {ModeValue[]}
 */
function withModeTitles(operatingModes) {
  return (Array.isArray(operatingModes) ? operatingModes : [])
    .map((mode) => (MODE_TITLES[mode?.id] ? { id: mode.id, title: MODE_TITLES[mode.id] } : mode));
}

/**
 * Sets the values of the operating mode capability to the device's modes: the values it offers
 * that the device has (in their order), then the device's other modes. Without known device
 * modes the capability keeps what it offers. A failure is not that bad: the capability keeps
 * its values.
 * @param {any} device the ViessmannDevice
 */
async function initializeOperatingModes(device) {
  try {
    const deviceModes = withModeTitles(device._operatingModes);
    if (deviceModes.length === 0) return;

    const { capabilityName } = getCapability(PATHS.HEATING_CIRCUIT_0_MODE);
    if (!device.hasCapability(capabilityName)) return;

    const capabilityOptions = device.getCapabilityOptions(capabilityName) || {};
    const currentModes = Array.isArray(capabilityOptions.values) ? capabilityOptions.values : [];
    const values = mergeOperatingModes(currentModes, deviceModes);

    if (process.env.DEBUG) {
      device.log('[ViessmannDevice::initializeOperatingModes] Operating modes:', values.map((mode) => mode.id));
    }
    await device.setCapabilityOptions(capabilityName, { ...capabilityOptions, values });
  } catch (err) {
    if (process.env.DEBUG) {
      device.log('Error initializing operating modes:', err);
    }
  }
}

/**
 * Registers one listener per writable capability the device has (a command or a derived
 * `write`), once. A value that equals the current one sends nothing, so a Matter bridge or voice
 * assistant repeating the set point costs no API call. A capability the device does not have yet
 * gets its listener on a later run (e.g. after an extended poll found its feature).
 * @param {any} device the ViessmannDevice
 */
async function registerCapabilityListeners(device) {
  if (!Array.isArray(device._listeners)) device._listeners = [];

  for (const capabilityName of featureMapper.writableCapabilities()) {
    if (device._listeners.includes(capabilityName)) continue;
    try {
      if (!device.hasCapability(capabilityName)) {
        device.log(`Capability ${capabilityName} not found, skipping listener registration`);
        continue;
      }
      device.registerCapabilityListener(capabilityName, async (/** @type {any} */ value) => {
        if (process.env.DEBUG) {
          device.log(`${capabilityName}:`, value);
        }
        if (value === device.getCapabilityValue(capabilityName)) return;
        await device.writeCapability(capabilityName, value);
      });
      device._listeners.push(capabilityName);
    } catch (err) {
      device.error(`Error setting up listener for ${capabilityName}:`, err);
    }
  }
}

module.exports = {
  initializeCapabilities, updateCapabilityOptions, initializeOperatingModes, registerCapabilityListeners, optionsPath, withModeTitles,
};
