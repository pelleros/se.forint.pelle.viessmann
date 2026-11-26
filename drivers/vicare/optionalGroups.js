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

// Optional groups of values. A feature in config/ with `group: '<name>'` gets its capabilities
// only while the group's device setting is on. Turning the setting off removes those
// capabilities again (with their Insights history, which the setting's hint says); nothing else
// is removed. Capabilities that devices already had before a group existed are never put in a
// group. Adding a group: an entry here and a checkbox setting with the same id in
// driver.compose.json (registered in registry.json).

/**
 * @typedef {object} OptionalGroup
 * @property {string} setting the id of the device setting (a checkbox) that turns the group on
 * @property {boolean} enabledByDefault the setting's default value in driver.compose.json
 */

/** @type {Readonly<Record<string, OptionalGroup>>} */
const GROUPS = Object.freeze({
  diagnostic: { setting: 'diagnosticValues', enabledByDefault: false },
});

/**
 * True when the device setting `key` turns an optional group on or off.
 * @param {string} key
 * @returns {boolean}
 */
function isGroupSetting(key) {
  return Object.values(GROUPS).some((group) => group.setting === key);
}

/**
 * The groups that are on for these settings. A setting the device does not have yet (devices
 * from before the group existed) counts as its default.
 * @param {Record<string, any> | ((key: string) => any)} settings the settings, or a getter
 * @returns {string[]}
 */
function enabledGroups(settings) {
  const get = typeof settings === 'function' ? settings : (/** @type {string} */ key) => settings?.[key];
  return Object.entries(GROUPS)
    .filter(([, group]) => {
      const value = get(group.setting);
      return typeof value === 'boolean' ? value : group.enabledByDefault;
    })
    .map(([name]) => name);
}

module.exports = { GROUPS, isGroupSetting, enabledGroups };
