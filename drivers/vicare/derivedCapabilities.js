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

// Pure helpers for the capability order of new devices (config/order.js) and for derived
// capabilities (`DERIVED` in the config modules): capabilities computed from several features.
// featureMapper.js uses them; they have no Homey dependency.

/** @typedef {import('./config/types').DerivedCapabilityConfig} DerivedCapabilityConfig */
/** @typedef {import('./config/types').DeviceContext} DeviceContext */
/** @typedef {import('./config/types').FeatureReader} FeatureReader */
/** @typedef {{ value: any, gone: boolean }} Reading */

/**
 * The place of a capability in an order of IDs and prefixes ending in `*`: its exact entry, else
 * the first prefix that matches it, else after all entries.
 * @param {string} capabilityName
 * @param {readonly string[]} order
 * @returns {number}
 */
function capabilityRank(capabilityName, order) {
  const exact = order.indexOf(capabilityName);
  if (exact >= 0) return exact;
  const prefix = order.findIndex((entry) => entry.endsWith('*') && capabilityName.startsWith(entry.slice(0, -1)));
  return prefix >= 0 ? prefix : order.length;
}

/**
 * The entries sorted by the place of their capability in `order`; entries with the same place
 * keep their order (Array.prototype.sort is stable).
 * @template {{ capability: { capabilityName: string } }} T
 * @param {T[]} entries
 * @param {readonly string[]} order
 * @returns {T[]}
 */
function sortByCapabilityOrder(entries, order) {
  return [...entries].sort((a, b) => capabilityRank(a.capability.capabilityName, order)
    - capabilityRank(b.capability.capabilityName, order));
}

/**
 * The first source of a derived capability that is stored and allowed, when the capability is
 * available on a device with these features; otherwise undefined.
 * @param {DerivedCapabilityConfig} derived
 * @param {string[]} storedFeatures
 * @param {(path: string) => boolean} allowPath
 * @returns {string | undefined}
 */
function derivedSource(derived, storedFeatures, allowPath) {
  if (derived.available && !derived.available(storedFeatures)) return undefined;
  return derived.sources.find((path) => storedFeatures.includes(path) && allowPath(path));
}

/**
 * Adds the readings of the derived capabilities, in config order, so that each sees the
 * readings before it. A derive that throws gives no value. A derived capability is `gone` when
 * it gives no value, none of its sources is connected and the response counts absent features.
 * @param {DerivedCapabilityConfig[]} derivedCapabilities
 * @param {FeatureReader} read
 * @param {(path: string) => boolean} isConnectedPath
 * @param {Map<string, Reading>} readings
 * @param {{ context?: DeviceContext, absenceCounts: boolean }} options
 * @returns {Map<string, Reading>}
 */
function addDerivedReadings(derivedCapabilities, read, isConnectedPath, readings, { context = {}, absenceCounts }) {
  for (const derived of derivedCapabilities) {
    let value;
    try {
      value = derived.derive(read, { ...context, readings });
    } catch (error) {
      value = undefined;
    }
    const connected = derived.sources.some(isConnectedPath);
    readings.set(derived.capabilityName, { value, gone: value === undefined && !connected && absenceCounts });
  }
  return readings;
}

module.exports = {
  capabilityRank, sortByCapabilityOrder, derivedSource, addDerivedReadings,
};
