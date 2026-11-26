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

// Store migrations: one step per release that changed what a device keeps in its store. Every
// device runs the steps it needs on each start (checkUpgradeSpecifics in device.js), oldest
// first. A step decides from the store itself whether it is needed, so it is idempotent: once
// it has succeeded it is not needed any more, and a step that fails (or is skipped by its own
// error handling) runs again on the next start. Store keys are frozen: a step adds or fills in
// keys, it never renames or removes one.
//
// Adding a step: append it with the version that introduces the change, and add its upgrade
// test to drivers/vicare/__tests__/migrations.test.js.

/**
 * The parts of a device a migration uses.
 * @typedef {object} MigratableDevice
 * @property {(key: string) => any} getStoreValue
 * @property {(key: string, value: any) => Promise<any>} setStoreValue
 * @property {() => Record<string, any>} getData
 * @property {() => Promise<void>} refreshStoredMetadata reads the device's metadata from the API
 *   and stores it; logs a failure instead of throwing
 */

/**
 * @typedef {object} StoreMigration
 * @property {string} version the release that introduced the change
 * @property {string} description
 * @property {(device: MigratableDevice) => boolean} isNeeded true while the store lacks the change
 * @property {(device: MigratableDevice) => Promise<void>} migrate
 */

/**
 * True when `version` (three-part, e.g. '1.0.14'; none counts as 0.0.0) is before `target`.
 * @param {string | undefined | null} version
 * @param {string} target
 * @returns {boolean}
 */
function versionBefore(version, target) {
  const current = (version || '0.0.0').split('.').map(Number);
  const wanted = target.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (current[i] > wanted[i]) return false;
    if (current[i] < wanted[i]) return true;
  }
  return false;
}

/** @type {readonly StoreMigration[]} */
const MIGRATIONS = Object.freeze([
  {
    version: '1.0.4',
    description: 'Pairings of 1.0.2 and 1.0.3: the ids move from the device data to the store, with roles and '
      + 'operating modes (1.0.2 stored none: a heat pump with three modes is assumed)',
    isNeeded: (device) => !device.getStoreValue('installationId'),
    async migrate(device) {
      const {
        installationId, gatewaySerial, deviceId, roles, operatingModes,
      } = device.getData();
      await device.setStoreValue('installationId', installationId);
      await device.setStoreValue('gatewaySerial', gatewaySerial);
      await device.setStoreValue('deviceId', deviceId);
      if (!roles) {
        // 1.0.2 => 1.0.4
        await device.setStoreValue('roles', ['type:heating', 'type:heatpump', 'type:dhw']);
        await device.setStoreValue('operatingModes', [
          { id: 'dhw', title: { en: 'Hot water' } },
          { id: 'dhwAndHeating', title: { en: 'Hot water and Heating' } },
          { id: 'standby', title: { en: 'Standby' } },
        ]);
      } else {
        // 1.0.3 => 1.0.4
        await device.setStoreValue('roles', roles);
        await device.setStoreValue('operatingModes', operatingModes);
      }
    },
  },
  {
    version: '1.0.9',
    description: 'The store records the version: pairings before 1.0.9 are marked 1.0.9',
    isNeeded: (device) => versionBefore(device.getStoreValue('version'), '1.0.9'),
    async migrate(device) {
      await device.setStoreValue('version', '1.0.9');
    },
  },
  {
    version: '1.0.15',
    description: 'Heating circuit and command metadata, read once from the API so that circuit support needs no '
      + 'new pairing; the stored feature list only grows. A failed read is retried on the next start',
    isNeeded: (device) => device.getStoreValue('heatingCircuitId') == null || !device.getStoreValue('commandMetadata'),
    async migrate(device) {
      await device.refreshStoredMetadata();
    },
  },
]);

/**
 * Runs every step the device needs, oldest first. An error in a step stops the run (and the
 * device's start); steps that are not needed are skipped.
 * @param {MigratableDevice} device
 * @param {readonly StoreMigration[]} [migrations]
 * @returns {Promise<string[]>} the versions of the steps that ran
 */
async function runMigrations(device, migrations = MIGRATIONS) {
  const ran = [];
  for (const migration of migrations) {
    if (!migration.isNeeded(device)) continue;
    await migration.migrate(device);
    ran.push(migration.version);
  }
  return ran;
}

module.exports = { MIGRATIONS, runMigrations, versionBefore };
