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

// What changing a device setting does (device.onSettings): the update interval and the event log
// (refused before anything changes when they would plan more API calls a day than the account can
// spare, pollPlan.js), the optional groups of values (optionalGroups.js) and the heating circuit
// the device works on. Switching circuits reads all features once, shows the new circuit's values
// from that read and pauses the device's poller meanwhile; when anything fails, the previous
// circuit's metadata is restored. An error thrown here is shown by Homey, which then keeps the
// previous setting.

const { FEATURES } = require('./config');
const { isGroupSetting, enabledGroups } = require('./optionalGroups');
const { withinPlan, PLANNED_LIMIT } = require('./pollPlan');
const { translate } = require('../../lib/errorMessages');

/**
 * Refuses settings that would plan more API calls a day than the account can spare (pollPlan.js).
 * @param {any} device the ViessmannDevice
 * @param {Record<string, any>} newSettings
 */
function checkPollSettings(device, newSettings) {
  const settings = { pollInterval: newSettings.pollInterval, eventLog: newSettings.eventLog };
  const calls = device.driver.plannedCallsPerDay(device.getStoreValue('OAuth2SessionId'), { device, settings });
  if (!withinPlan(calls)) throw new Error(translate(device.homey, 'device_settings.too_many_calls', { calls, limit: PLANNED_LIMIT }));
}

/**
 * Uses the new update interval and event log setting at once (device.getPollSetting gives them
 * before Homey saves the settings): reschedules the next poll, without an extra poll.
 * @param {any} device the ViessmannDevice
 * @param {Record<string, any>} newSettings
 */
async function applyPollSettings(device, newSettings) {
  device._pollSettings = { pollInterval: newSettings.pollInterval, eventLog: newSettings.eventLog };
  if (device._uninitialized) return;
  await device.driver._startPolling(device, device.getPollingKey());
  device.getMonitor().scheduleEventLog();
}

/**
 * Adds or removes the capabilities of the optional groups (optionalGroups.js), without an API
 * call.
 * @param {any} device the ViessmannDevice
 * @param {string[]} groups the groups that are on
 */
async function applyEnabledGroups(device, groups) {
  device._enabledGroups = groups;
  await device.initializeCapabilities();
  await device.updateCapabilityOptions();
  await device.registerCapabilityListeners();
}

/**
 * The heating circuit setting as the circuit to read: 'auto' or a circuit number.
 * @param {unknown} setting
 * @returns {string}
 */
function circuitSetting(setting) {
  const selectedCircuit = String(setting).trim();
  if (selectedCircuit !== 'auto' && !/^\d+$/.test(selectedCircuit)) {
    throw new Error(`Unknown heating circuit setting: ${selectedCircuit}`);
  }
  return selectedCircuit;
}

/**
 * The error for a heating circuit the installation does not have, in the user's language (the
 * error's own message when there is no translation).
 * @param {any} homey
 * @param {{ circuit: string, available: string[], message: string }} error from detectHeatingCircuit
 * @returns {string}
 */
function circuitNotAvailableMessage(homey, { circuit, available, message }) {
  const tags = { circuit, available: available.length > 0 ? available.join(', ') : '–' };
  const translated = homey?.__?.('device_settings.heating_circuit_not_available', tags);
  return typeof translated === 'string' && !translated.startsWith('device_settings.') ? translated : message;
}

/**
 * The capabilities of heating circuit features that the new circuit does not report.
 * @param {string[]} reportedFeatures the new circuit's features (circuit-normalized)
 * @returns {string[]}
 */
function circuitCapabilitiesNotReported(reportedFeatures = []) {
  return Object.entries(FEATURES)
    .filter(([path]) => path.startsWith('heating.circuits.0.') && !reportedFeatures.includes(path))
    .flatMap(([, feature]) => feature.capabilities.map(({ capabilityName }) => capabilityName));
}

/**
 * After switching circuits, per-circuit capabilities whose feature the new circuit does not report
 * would keep showing the old circuit's values. Their values become unknown (null); the
 * capabilities themselves stay.
 * @param {any} device the ViessmannDevice
 * @param {string[]} [reportedFeatures]
 */
async function clearValuesNotReportedBy(device, reportedFeatures = []) {
  for (const capabilityName of circuitCapabilitiesNotReported(reportedFeatures)) {
    if (device.hasCapability(capabilityName) && device.getCapabilityValue(capabilityName) !== null) {
      try {
        await device.setCapabilityValue(capabilityName, null);
      } catch (error) {
        device.error(`Could not clear ${capabilityName}:`, error);
      }
    }
  }
}

/**
 * Switches the device to the heating circuit of the setting. One unfiltered read gives both the
 * new circuit's metadata and its current values. A different mode on the new circuit is not a
 * mode change, so heating-mode-changed does not fire for the switch itself.
 * @param {any} device the ViessmannDevice
 * @param {Record<string, any>} newSettings
 */
async function changeHeatingCircuit(device, newSettings) {
  const selectedCircuit = circuitSetting(newSettings.heatingCircuit);
  const response = await device.getFeatures();
  let fresh;
  try {
    fresh = device.driver._readDeviceMetadata(response, selectedCircuit);
  } catch (error) {
    // Homey shows the message and keeps the previous value; nothing has changed yet
    if (/** @type {any} */ (error).code === 'heating_circuit_not_available') {
      throw new Error(circuitNotAvailableMessage(device.homey, /** @type {any} */ (error)));
    }
    throw error;
  }
  const metadata = device.mergeRefreshedMetadata(fresh);
  // Pausing (not replacing) the poller keeps its backoff and Retry-After; a poll still in
  // progress for the old circuit is dropped
  await device.driver._pausePolling(device.getPollingKey());
  const previous = {
    heatingCircuitId: device._heatingCircuitId,
    // The feature list only grows, also when the switch is rolled back
    features: metadata.features,
    constraints: device._constraints,
    operatingModes: device._operatingModes,
    commandMetadata: device._commands,
  };
  const circuitChanged = metadata.heatingCircuitId !== previous.heatingCircuitId;
  try {
    await device.applyCircuitMetadata(metadata);
    if (circuitChanged) await clearValuesNotReportedBy(device, fresh.features);
    // Show the new circuit's values now, without waiting for (or adding) a poll
    await device.onFeaturesUpdated(response, false, { triggers: !circuitChanged });
  } catch (error) {
    await device.applyCircuitMetadata(previous);
    throw error;
  } finally {
    device.resumePolling();
  }
}

/**
 * Applies changed device settings, in Homey's onSettings order: poll settings are checked first.
 * @param {any} device the ViessmannDevice
 * @param {{ newSettings: Record<string, any>, changedKeys: string[] }} event
 */
async function applySettings(device, { newSettings, changedKeys }) {
  const pollSettingsChanged = changedKeys.includes('pollInterval') || changedKeys.includes('eventLog');
  // Refused before anything changes
  if (pollSettingsChanged) checkPollSettings(device, newSettings);
  if (changedKeys.includes('heatingCircuit')) await changeHeatingCircuit(device, newSettings);
  if (changedKeys.some(isGroupSetting)) await device.applyEnabledGroups(enabledGroups(newSettings));
  if (pollSettingsChanged) await applyPollSettings(device, newSettings);
}

module.exports = {
  applySettings, applyEnabledGroups, circuitSetting, circuitNotAvailableMessage, circuitCapabilitiesNotReported,
};
