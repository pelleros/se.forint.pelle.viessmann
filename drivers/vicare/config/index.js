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

// The feature configuration: which Viessmann feature paths the app polls and which Homey
// capabilities they become. One module per theme, so that changes to different themes touch
// different files:
//
//   thermostat.js    set points and modes (hot water, heating, one-time charge, fuel cell mode)
//   temperatures.js  temperature sensors outside the heating circuit
//   circuits.js      readings of the heating circuit
//   status.js        running states, load and modulation, fuel cell phase
//   energy.js        coefficients of performance and statistics counters
//   templates.js     shared option templates and factories
//   order.js         the order of PATHS (capability order of new devices)
//
// Everything else requires this index, which exports the combined PATHS and FEATURES.

/** @typedef {import('./types').ConfigModule} ConfigModule */
/** @typedef {import('./types').FeatureConfig} FeatureConfig */
/** @typedef {import('./types').CapabilityConfig} CapabilityConfig */

const ORDER = require('./order');
const thermostat = require('./thermostat');
const temperatures = require('./temperatures');
const circuits = require('./circuits');
const status = require('./status');
const energy = require('./energy');

// A new theme module is added here, at the end
/** @type {Record<string, ConfigModule>} */
const MODULES = {
  thermostat, temperatures, circuits, status, energy,
};

/**
 * Combines the theme modules into one PATHS and one FEATURES, both in the order of `order`
 * (unlisted paths after the listed ones, in module order). Throws when two modules define the
 * same constant or feature path, or a module configures a path that is not in its PATHS.
 * @param {Record<string, ConfigModule>} modules
 * @param {readonly string[]} order
 * @returns {{ PATHS: Record<string, string>, FEATURES: Record<string, FeatureConfig> }}
 */
function combine(modules, order) {
  /** @type {Map<string, { path: string, module: string }>} */
  const byKey = new Map();
  /** @type {Map<string, { feature: FeatureConfig | undefined, module: string }>} */
  const byPath = new Map();
  for (const [name, module] of Object.entries(modules)) {
    for (const [key, path] of Object.entries(module.PATHS)) {
      if (byKey.has(key)) throw new Error(`PATHS.${key} is defined in both ${byKey.get(key)?.module} and ${name}`);
      if (byPath.has(path)) throw new Error(`Feature path ${path} is defined in both ${byPath.get(path)?.module} and ${name}`);
      byKey.set(key, { path, module: name });
      byPath.set(path, { feature: module.FEATURES[path], module: name });
    }
    for (const path of Object.keys(module.FEATURES)) {
      if (!Object.values(module.PATHS).includes(path)) throw new Error(`${name} configures ${path}, which is not in its PATHS`);
    }
  }

  const keys = [...order.filter((key) => byKey.has(key)), ...[...byKey.keys()].filter((key) => !order.includes(key))];
  /** @type {Record<string, string>} */
  const paths = {};
  /** @type {Record<string, FeatureConfig>} */
  const features = {};
  for (const key of keys) {
    const { path } = /** @type {{ path: string }} */ (byKey.get(key));
    paths[key] = path;
    const feature = byPath.get(path)?.feature;
    if (feature) features[path] = feature;
  }
  return { PATHS: paths, FEATURES: features };
}

const { PATHS, FEATURES } = combine(MODULES, ORDER);

/**
 * The first capability of a feature path.
 * @param {string} featurePath
 * @returns {CapabilityConfig}
 */
const getCapability = (featurePath) => {
  const feature = module.exports.FEATURES[featurePath];
  if (!feature?.capabilities?.[0]) {
    throw new Error(`No capability found for feature: ${featurePath}`);
  }
  return feature.capabilities[0];
};

/**
 * All capabilities of a feature path.
 * @param {string} featurePath
 * @returns {CapabilityConfig[]}
 */
const getAllCapabilities = (featurePath) => {
  const feature = module.exports.FEATURES[featurePath];
  if (!feature?.capabilities) {
    throw new Error(`No capabilities found for feature: ${featurePath}`);
  }
  return feature.capabilities;
};

/**
 * The configured options of a capability (from the first feature path that has it).
 * @param {string} capabilityName
 * @returns {Record<string, any>}
 */
const getCapabilityOptions = (capabilityName) => {
  for (const feature of Object.values(module.exports.FEATURES)) {
    const capability = feature.capabilities?.find((cap) => cap.capabilityName === capabilityName);
    if (capability?.capabilityOptions) {
      return capability.capabilityOptions;
    }
  }
  throw new Error(`No capability options found for: ${capabilityName}`);
};

module.exports = {
  PATHS,
  FEATURES,
  MODULES,
  combine,
  getCapability,
  getAllCapabilities,
  getCapabilityOptions,
};
