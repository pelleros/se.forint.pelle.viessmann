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

// Pure mapping between Viessmann feature responses and Homey capabilities, without any Homey
// dependency: which capabilities a device gets, with which options, and which values a
// response gives them. device.js and driver.js use it; tests and tools can use it directly.

const config = require('./config');

/** @typedef {import('./config/types').FeatureConfig} FeatureConfig */
/** @typedef {import('./config/types').CapabilityConfig} CapabilityConfig */

/**
 * One feature of a features response, as far as the mapper reads it.
 * @typedef {object} Feature
 * @property {string} feature
 * @property {boolean} [isEnabled]
 * @property {Record<string, any>} [properties]
 * @property {Record<string, any>} [commands]
 */

/** @typedef {{ data: Feature[] }} FeaturesResponse */

/**
 * A capability's value from one response: `value` is undefined when no feature path gives one,
 * `gone` is true when none of its paths is reported as an enabled, connected feature.
 * @typedef {{ value: string | number | boolean | null | undefined, gone: boolean }} Reading
 */

/** @typedef {{ id: string, title: Record<string, string> }} ModeValue */

/**
 * What a device stores from an unfiltered features response.
 * @typedef {object} DeviceMetadata
 * @property {string[]} features enabled, connected feature paths
 * @property {Record<string, Record<string, any>>} constraints per feature: parameter → constraints
 * @property {Record<string, Record<string, any>>} commandMetadata per feature: the API's commands
 * @property {ModeValue[]} operatingModes the heating circuit's modes
 */

/**
 * Reads a dot path such as 'value.value' from a feature's properties. Only a string, a boolean,
 * a finite number or null is a value a capability can take; anything else (objects, NaN, ...)
 * counts as no value, so the capability keeps its last value.
 * @param {Record<string, any> | undefined} properties
 * @param {string} propertyPath
 * @returns {string | number | boolean | null | undefined}
 */
function readPropertyValue(properties, propertyPath) {
  /** @type {any} */
  const value = propertyPath.split('.')
    .reduce((/** @type {any} */ current, part) => (current == null ? undefined : current[part]), properties);
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  return Number.isFinite(value) ? value : undefined;
}

/**
 * True when the feature is reported enabled, with properties, and not `notConnected`.
 * @param {Feature | undefined} feature
 * @returns {boolean}
 */
function isConnected(feature) {
  return Boolean(feature?.isEnabled && feature.properties && feature.properties.status?.value !== 'notConnected');
}

/**
 * A mode id such as 'dhwAndHeating' as a title: 'DHW And Heating'.
 * @param {string} mode
 * @returns {string}
 */
function modeTitle(mode) {
  return mode.replace(/([A-Z])/g, ' $1')
    .replace(/^./, (char) => char.toUpperCase())
    .replace(/Dhw/g, 'DHW')
    .trim();
}

class FeatureMapper {

  /**
   * @param {{ FEATURES: Record<string, FeatureConfig>, PATHS: Record<string, string> }} [configuration]
   */
  constructor(configuration = config) {
    this.config = configuration;
  }

  get FEATURES() {
    return this.config.FEATURES;
  }

  get PATHS() {
    return this.config.PATHS;
  }

  /**
   * True when the feature path has no required role or `roles` contains it.
   * @param {string} path
   * @param {string[]} roles
   * @returns {boolean}
   */
  hasRequiredRole(path, roles) {
    const feature = this.FEATURES[path];
    return !feature?.requireRole || roles.includes(feature.requireRole);
  }

  /**
   * True when a device with these stored features gets the capabilities of the path: it stores
   * the feature, or the feature is `alwaysAdd`.
   * @param {string} path
   * @param {string[]} storedFeatures
   * @returns {boolean}
   */
  isAvailable(path, storedFeatures) {
    return storedFeatures.includes(path) || Boolean(this.FEATURES[path]?.alwaysAdd);
  }

  /**
   * The capabilities a device with these stored features and roles gets, in PATHS order. A
   * capability fed by several paths is listed once per path.
   * @param {string[]} storedFeatures
   * @param {string[]} roles
   * @returns {{ path: string, capability: CapabilityConfig }[]}
   */
  capabilitiesFor(storedFeatures, roles) {
    const result = [];
    for (const path of Object.values(this.PATHS)) {
      if (!this.hasRequiredRole(path, roles) || !this.isAvailable(path, storedFeatures)) continue;
      for (const capability of this.FEATURES[path]?.capabilities || []) result.push({ path, capability });
    }
    return result;
  }

  /**
   * True when a stored feature that `allowPath` accepts still produces the capability.
   * @param {string} capabilityName
   * @param {string[]} storedFeatures
   * @param {(path: string) => boolean} allowPath
   * @returns {boolean}
   */
  isProduced(capabilityName, storedFeatures, allowPath) {
    return Object.values(this.PATHS).some((path) => this.isAvailable(path, storedFeatures)
      && (this.FEATURES[path]?.capabilities || []).some((capability) => capability.capabilityName === capabilityName)
      && allowPath(path));
  }

  /**
   * The configured options of a capability; throws for an unknown capability.
   * @param {string} capabilityName
   * @returns {Record<string, any>}
   */
  configuredOptions(capabilityName) {
    for (const feature of Object.values(this.FEATURES)) {
      const capability = feature.capabilities?.find((cap) => cap.capabilityName === capabilityName);
      if (capability?.capabilityOptions) return capability.capabilityOptions;
    }
    throw new Error(`No capability options found for: ${capabilityName}`);
  }

  /**
   * The options a device sets on a capability fed by `path`: the configured options, with the
   * temperature limits the API reports for the path's command (`temperature` or
   * `targetTemperature`) as min, max and step.
   * @param {string} capabilityName
   * @param {string} path
   * @param {Record<string, Record<string, any>> | undefined} constraints
   * @returns {Record<string, any>}
   */
  optionsFor(capabilityName, path, constraints) {
    const options = { ...this.configuredOptions(capabilityName) };
    const pathConstraints = constraints?.[path];
    const temperature = pathConstraints?.temperature || pathConstraints?.targetTemperature;
    if (temperature) {
      Object.assign(options, { min: temperature.min, max: temperature.max, step: temperature.stepping || options.step || 1 });
    }
    return options;
  }

  /**
   * The configured capability with this name, with its feature's `requireRole`, or null.
   * @param {string} capabilityName
   * @returns {(CapabilityConfig & { requireRole?: string }) | null}
   */
  capabilityByName(capabilityName) {
    for (const feature of Object.values(this.FEATURES)) {
      const capability = feature.capabilities.find((cap) => cap.capabilityName === capabilityName);
      if (capability) return { ...capability, requireRole: feature.requireRole };
    }
    return null;
  }

  /**
   * The feature path and configured capability that a Flow action or a capability listener
   * writes through: the first path that produces the capability.
   * @param {string} capabilityName
   * @returns {{ path: string, capability: CapabilityConfig } | null}
   */
  commandTarget(capabilityName) {
    for (const [path, feature] of Object.entries(this.FEATURES)) {
      const capability = feature.capabilities?.find((cap) => cap.capabilityName === capabilityName);
      if (capability) return { path, capability };
    }
    return null;
  }

  /**
   * The value a capability shows for an API value (its `valueMapping`, if any).
   * @param {string} capabilityName
   * @param {any} value
   * @returns {any}
   */
  displayValue(capabilityName, value) {
    const mapping = this.capabilityByName(capabilityName)?.valueMapping;
    return mapping && value in mapping ? mapping[value] : value;
  }

  /**
   * Reads every capability's value from a (circuit-normalized) features response. A capability
   * can be fed by more than one feature path: paths with `fallbackFor` are read only when the
   * other paths give no value. A response without any mapped feature clears nothing (no
   * capability is `gone`). Capabilities whose feature needs a role that `roles` lacks are left
   * out, and so are `computed` capabilities, which the device computes itself.
   * @param {FeaturesResponse} response
   * @param {string[]} roles
   * @returns {Map<string, Reading>}
   */
  readValues(response, roles) {
    const reported = new Map(response.data.map((feature) => [feature.feature, feature]));
    const absenceCounts = response.data.some((feature) => this.FEATURES[feature.feature]);
    const entries = Object.entries(this.FEATURES)
      .filter(([path]) => this.hasRequiredRole(path, roles))
      .sort(([, a], [, b]) => Number(Boolean(a.fallbackFor)) - Number(Boolean(b.fallbackFor)));

    /** @type {Map<string, Reading>} */
    const readings = new Map();
    for (const [path, featureConfig] of entries) {
      const feature = reported.get(path);
      const connected = isConnected(feature);
      for (const { capabilityName, propertyPath, computed } of featureConfig.capabilities) {
        if (computed) continue;
        const reading = readings.get(capabilityName) || { value: undefined, gone: true };
        readings.set(capabilityName, reading);
        if (reading.value !== undefined) continue;
        if (connected) {
          reading.value = readPropertyValue(feature?.properties, propertyPath);
          reading.gone = false;
        } else if (!feature && !absenceCounts) {
          reading.gone = false;
        }
      }
    }
    return readings;
  }

  /**
   * The command metadata after a response: what the response reports per feature replaces the
   * old entry, and a disabled feature has no commands. An enabled feature that suddenly reports
   * no commands at all keeps the ones it had: Viessmann has sent empty commands for a while
   * before, so this may be temporary, and a write is then refused by the API itself.
   * @param {FeaturesResponse} response
   * @param {Record<string, any> | undefined} previous
   * @returns {Record<string, any>}
   */
  updatedCommands(response, previous) {
    const commands = { ...previous };
    for (const feature of response.data) {
      if (!feature.isEnabled) commands[feature.feature] = {};
      else if (feature.commands && typeof feature.commands === 'object') {
        const known = commands[feature.feature];
        const emptied = Object.keys(feature.commands).length === 0 && known && Object.keys(known).length > 0;
        if (!emptied) commands[feature.feature] = feature.commands;
      }
    }
    return commands;
  }

  /**
   * The enabled features a response reports that are not in `knownFeatures` yet, in response
   * order (a feature that is `notConnected` is not added).
   * @param {FeaturesResponse | undefined} response
   * @param {string[]} knownFeatures
   * @returns {string[]}
   */
  newFeatures(response, knownFeatures) {
    /** @type {string[]} */
    const found = [];
    for (const feature of response?.data || []) {
      if (feature.isEnabled && feature.properties?.status?.value !== 'notConnected'
        && !knownFeatures.includes(feature.feature) && !found.includes(feature.feature)) {
        found.push(feature.feature);
      }
    }
    return found;
  }

  /**
   * What a device stores from an unfiltered, circuit-normalized features response: enabled and
   * connected features, the constraints and commands per feature and the operating modes of the
   * heating circuit (none when they cannot be read).
   * @param {FeaturesResponse} response
   * @returns {DeviceMetadata}
   */
  deviceMetadata(response) {
    /** @type {string[]} */
    const features = [];
    /** @type {Record<string, Record<string, any>>} */
    const constraints = {};
    /** @type {Record<string, Record<string, any>>} */
    const commandMetadata = {};

    for (const feature of response.data) {
      if (feature.isEnabled && feature.properties?.status?.value !== 'notConnected') {
        features.push(feature.feature);
        if (feature.commands && typeof feature.commands === 'object') {
          commandMetadata[feature.feature] = feature.commands;
          /** @type {Record<string, any>} */
          const featureConstraints = {};
          constraints[feature.feature] = featureConstraints;
          Object.values(feature.commands).forEach((command) => {
            Object.entries(command?.params || {}).forEach(([paramName, param]) => {
              if (param?.constraints) featureConstraints[paramName] = param.constraints;
            });
          });
        }
      }
    }

    /** @type {ModeValue[]} */
    const operatingModes = [];
    try {
      const mainOpMode = response.data.find((item) => item.feature === this.PATHS.HEATING_CIRCUIT_0_MODE);
      if (mainOpMode?.isEnabled) {
        for (const mode of mainOpMode.commands?.setMode.params.mode.constraints.enum) {
          operatingModes.push({ id: mode, title: { en: modeTitle(mode) } });
        }
      }
    } catch (error) {
      // Not critical: the capability keeps the configured modes
    }
    return {
      features, constraints, operatingModes, commandMetadata,
    };
  }

}

/**
 * The values of the operating mode capability for a device: the current values the device
 * supports (in their current order), then the device's modes that are not there yet.
 * @param {ModeValue[]} currentValues
 * @param {ModeValue[]} deviceModes
 * @returns {ModeValue[]}
 */
function mergeOperatingModes(currentValues, deviceModes) {
  const supportedIds = new Set(deviceModes.map((mode) => mode.id));
  const values = currentValues.filter((mode) => supportedIds.has(mode.id));
  const presentIds = new Set(values.map((mode) => mode.id));
  for (const mode of deviceModes) {
    if (!presentIds.has(mode.id)) {
      values.push(mode);
      presentIds.add(mode.id);
    }
  }
  return values;
}

module.exports = {
  FeatureMapper,
  featureMapper: new FeatureMapper(),
  readPropertyValue,
  isConnected,
  mergeOperatingModes,
};
