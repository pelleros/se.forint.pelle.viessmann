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

// What a device does with a features response: from a poll (driver.js), from the read when its
// heating circuit changes (deviceSettings.js) and from the maintenance action (deviceMonitor.js).
// The response goes to the device's heating circuit (heatingCircuit.js); the device keeps the
// command metadata current, remembers the features for the generic cards, stores new features
// and learned roles (deviceMetadata.js), shows every capability's value and fires the triggers of
// the values that changed, and hands the response to deviceMonitor.js. A response that is no
// feature list makes the device unavailable; single odd entries or values are skipped.

const { normalizeCircuitFeatures } = require('./heatingCircuit');
const { featureMapper } = require('./featureMapper');
const { recordFeatures } = require('./featureCards');
const { fireValueTriggers } = require('./flowHandlers');
const { addNewFeatures, addInferredRoles } = require('./deviceMetadata');

/**
 * Homey shows when the device was last heard from: after every successful update.
 * @param {any} device the ViessmannDevice
 */
async function markSeen(device) {
  try {
    await device.setLastSeenAt();
  } catch (error) {
    device.error('Could not set the last seen time:', error);
  }
}

/**
 * setAvailable/setUnavailable reject (e.g. with 'device_not_found') when the device was deleted
 * meanwhile; that is logged instead of left unhandled.
 * @param {any} device the ViessmannDevice
 * @param {boolean} available
 * @param {unknown} [message]
 */
async function setAvailabilitySafely(device, available, message) {
  try {
    if (available) {
      await device.setAvailable();
    } else {
      await device.setUnavailable(message);
    }
  } catch (error) {
    device.error(`Could not mark device as ${available ? 'available' : 'unavailable'}:`, error);
  }
}

/**
 * Applies a features response to the device. `extendedResponse`: the response holds all
 * features (not only the polled paths), so new features are stored. `triggers: false` updates
 * the values without firing trigger cards (the switch to another heating circuit).
 * @param {any} device the ViessmannDevice
 * @param {any} rawResponse the API's response, not yet circuit-normalized
 * @param {boolean} extendedResponse
 * @param {{ triggers?: boolean }} [options]
 */
async function applyFeaturesResponse(device, rawResponse, extendedResponse, { triggers = true } = {}) {
  try {
    if (!Array.isArray(rawResponse?.data)) throw new Error('Invalid features response: no feature list');
    const response = normalizeCircuitFeatures(rawResponse, device._heatingCircuitId);
    device._commands = featureMapper.updatedCommands(response, device._commands);
    // For the Flow cards that read any feature (featureCards.js)
    recordFeatures(device, response, { complete: Boolean(extendedResponse) });
    if (process.env.DEBUG) {
      device.log('Starting feature update processing...', 'extendedResponse:', extendedResponse);
    }
    if (extendedResponse) {
      await addNewFeatures(device, response);
    }
    await addInferredRoles(device, response.data);

    for (const [capabilityName, reading] of device.readCapabilityValues(response)) {
      if (reading.value !== undefined) {
        await device.setCapabilityValueIfPossible(capabilityName, reading.value, { trigger: triggers });
      } else if (reading.gone && device.hasCapability(capabilityName) && device.getCapabilityValue(capabilityName) !== null) {
        // The last value would stay on screen and in Insights for good; the capability stays
        device.log(`${capabilityName} is no longer reported, clearing its value`);
        await device.setCapabilityValueIfPossible(capabilityName, null, { trigger: false });
      }
    }

    // Computed values, faults, frozen values and write checks (never throws)
    await device.getMonitor().onResponse(response, { triggers });

    if (process.env.DEBUG) {
      device.log('Feature update processing completed');
    }

    await setAvailabilitySafely(device, true);
    await markSeen(device);
  } catch (error) {
    device.error('Error processing features update:', error);
    await setAvailabilitySafely(device, false, error);
  }
}

/**
 * Shows a value on a capability the device has, as the capability shows it (after its value
 * mapping). When that changed, it tells the temporary changes (boost.js) and fires the triggers:
 * the cards with a kind (flowHandlers.js) and the capability's own trigger card. A failure is
 * logged.
 * @param {any} device the ViessmannDevice
 * @param {string} capabilityName
 * @param {any} value
 * @param {{ trigger?: boolean }} [options] `trigger: false` updates the value without firing its trigger cards
 */
async function showValue(device, capabilityName, value, { trigger = true } = {}) {
  try {
    if (!device.hasCapability(capabilityName)) return;
    if (!featureMapper.capabilityByName(capabilityName)) {
      device.error(`No configuration found for capability: ${capabilityName}`);
      return;
    }

    const currentValue = device.getCapabilityValue(capabilityName);
    const displayed = featureMapper.displayValue(capabilityName, value);
    if (currentValue === displayed) return;
    await device.setCapabilityValue(capabilityName, displayed);
    await device._boosts?.valueChanged(capabilityName, displayed);
    if (!trigger) return;
    await fireValueTriggers(device, capabilityName, displayed, currentValue);

    try {
      const triggerCard = device.driver.getTriggerCard(capabilityName);
      if (triggerCard) {
        await triggerCard.trigger(device, { mode: value }, {});
      }
    } catch (error) {
      // Ignore if no trigger card exists
    }
  } catch (error) {
    device.error(`Failed to set capability ${capabilityName}:`, error);
  }
}

module.exports = { applyFeaturesResponse, showValue };
