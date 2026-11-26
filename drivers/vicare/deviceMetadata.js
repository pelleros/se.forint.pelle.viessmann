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

// What a device knows about its Viessmann device beyond its ids: the stored feature list, the
// API's constraints and command metadata, the heating circuit's operating modes and the circuit
// it works on (store keys features, constraints, commandMetadata, operatingModes,
// heatingCircuitId), and the roles that responses show. Read from one unfiltered features
// response when pairing, by the one-time refresh of older pairings (migrations.js), by the
// maintenance action and when the heating circuit changes. The stored feature list only ever
// grows (CONTRIBUTING.md, ground rule 2): a refresh merges the old and the fresh list, and an
// extended poll appends the features it finds.

const { detectHeatingCircuit, normalizeCircuitFeatures } = require('./heatingCircuit');
const { inferRoles, hasRoleTags } = require('./roles');
const { featureMapper } = require('./featureMapper');

/** @typedef {import('./featureMapper').FeaturesResponse} FeaturesResponse */
/** @typedef {import('./featureMapper').DeviceMetadata & { heatingCircuitId: string }} CircuitMetadata */

/**
 * What a device stores from an unfiltered features response, for the selected heating circuit
 * ('auto' or a circuit id). Throws an error with code `heating_circuit_not_available` for a
 * circuit the installation does not have.
 * @param {{ data: any[] }} rawResponse
 * @param {string} [selectedCircuit]
 * @returns {CircuitMetadata}
 */
function readDeviceMetadata(rawResponse, selectedCircuit = 'auto') {
  const heatingCircuitId = detectHeatingCircuit(rawResponse.data, selectedCircuit);
  const {
    features, constraints, operatingModes, commandMetadata,
  } = featureMapper.deviceMetadata(normalizeCircuitFeatures(rawResponse, heatingCircuitId));
  return {
    features,
    constraints,
    operatingModes,
    heatingCircuitId,
    commandMetadata,
  };
}

/**
 * Combines freshly read metadata with what the device has stored. The feature list only grows.
 * Constraints are merged per feature, and the stored operating modes are kept when the API
 * reports none right now. Everything else comes from the fresh metadata.
 * @param {{ features?: unknown, constraints?: Record<string, any>, operatingModes?: any }} stored
 * @param {Record<string, any> | undefined} fresh
 * @returns {Record<string, any> & { features: string[] }}
 */
function mergeMetadata(stored, fresh) {
  const features = Array.isArray(stored.features) ? [...stored.features] : [];
  for (const feature of Array.isArray(fresh?.features) ? fresh.features : []) {
    if (!features.includes(feature)) features.push(feature);
  }
  return {
    ...fresh,
    features,
    constraints: { ...stored.constraints, ...fresh?.constraints },
    operatingModes: fresh?.operatingModes?.length ? fresh.operatingModes : stored.operatingModes,
  };
}

/**
 * Freshly read metadata merged with what the device has stored (see mergeMetadata).
 * @param {any} device the ViessmannDevice
 * @param {Record<string, any> | undefined} fresh
 */
function mergeWithStored(device, fresh) {
  return mergeMetadata({
    features: device.getStoreValue('features'),
    constraints: device.getStoreValue('constraints'),
    operatingModes: device.getStoreValue('operatingModes'),
  }, fresh);
}

// heatingCircuitId and commandMetadata go last: until both are stored, the next start runs the
// refresh again
const REFRESH_STORE_ORDER = ['features', 'constraints', 'operatingModes', 'commandMetadata', 'heatingCircuitId'];

/**
 * Reads the device's features from the API again and stores what pairing stores today, merged
 * with what is stored (see mergeMetadata). The refresh is not needed to run the device: a failure
 * is logged and the refresh is retried on the next start.
 * @param {any} device the ViessmannDevice
 */
async function refreshStoredMetadata(device) {
  try {
    const metadata = await device.driver._getEnabledFeaturesAndOpModes(
      device.oAuth2Client,
      device.getStoreValue('installationId'),
      device.getStoreValue('gatewaySerial'),
      device.getStoreValue('deviceId'),
      device.getSetting?.('heatingCircuit') || 'auto',
    );
    const merged = device.mergeRefreshedMetadata(metadata);
    for (const key of REFRESH_STORE_ORDER) {
      if (merged[key] !== undefined) await device.setStoreValue(key, merged[key]);
    }
  } catch (error) {
    device.error('Could not refresh the device metadata, retrying on the next start:', error);
  }
}

/**
 * Stores metadata (after a heating circuit change or the maintenance action) and sets the
 * device up for it again: capabilities, options, operating modes and listeners.
 * @param {any} device the ViessmannDevice
 * @param {Record<string, any>} metadata
 */
async function applyMetadata(device, metadata) {
  for (const [key, value] of Object.entries(metadata)) await device.setStoreValue(key, value);
  device._heatingCircuitId = metadata.heatingCircuitId;
  device._features = metadata.features;
  device._constraints = metadata.constraints;
  device._operatingModes = metadata.operatingModes;
  device._commands = metadata.commandMetadata;
  await device.initializeCapabilities();
  await device.updateCapabilityOptions();
  await device.initializeOperatingModes();
  await device.registerCapabilityListeners();
}

/**
 * Stores the features that an extended (unfiltered) poll reports as enabled but the device does
 * not know yet, then adds their capabilities and listeners. A feature that is missing or
 * notConnected in one response is kept. Failures are logged and retried on the next extended
 * poll; they must not make the device unavailable.
 * @param {any} device the ViessmannDevice
 * @param {FeaturesResponse} response circuit-normalized
 */
async function addNewFeatures(device, response) {
  try {
    const knownFeatures = Array.isArray(device._features) ? device._features : [];
    const newFeatures = featureMapper.newFeatures(response, knownFeatures);
    if (newFeatures.length === 0) return;

    device.log('New features found:', newFeatures);
    const features = [...knownFeatures, ...newFeatures];
    await device.setStoreValue('features', features);
    device._features = features;

    await device.initializeCapabilities();
    await device.registerCapabilityListeners();
  } catch (error) {
    device.error('Error adding new features:', error);
  }
}

/**
 * A response can show a role that the stored features do not (e.g. `heating.compressors` listing
 * a compressor): the device remembers it (in memory) and adds the capabilities it allows. Only
 * for devices whose stored roles say nothing about what they are (roles.js). Like
 * addNewFeatures, a failure is logged and must not make the device unavailable.
 * @param {any} device the ViessmannDevice
 * @param {any[]} featureData the response's features
 */
async function addInferredRoles(device, featureData) {
  try {
    if (hasRoleTags(device._roles)) return;
    const known = device.getRoles();
    const learned = inferRoles([], featureData).filter((role) => !known.includes(role));
    if (learned.length === 0) return;
    device.log('Roles inferred from the features:', learned);
    device._responseRoles = [...(device._responseRoles || []), ...learned];
    await device.initializeCapabilities();
    await device.registerCapabilityListeners();
  } catch (error) {
    device.error('Error adding capabilities for inferred roles:', error);
  }
}

module.exports = {
  readDeviceMetadata, mergeMetadata, mergeWithStored, refreshStoredMetadata, applyMetadata, addNewFeatures, addInferredRoles,
};
