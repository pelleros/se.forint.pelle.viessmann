'use strict';

// Every fixture device in test/fixtures/ (our own anonymized dumps and the PyViCare responses),
// with what pairing needs: the features response, the installation it belongs to and the
// device's identity and roles. Used by the capability matrix and the dev twin's fixture mode.

const fs = require('fs');
const path = require('path');
const { PYVICARE_DIR, identityOf } = require('./pyvicareFixtures');

const FIXTURES_DIR = path.join(__dirname, '../fixtures');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/**
 * The installations dump that belongs to a features dump of our own: same prefix, or the same
 * prefix without a trailing year (vitocal_222_2024_features.json → vitocal_222_installations.json).
 * @param {string} featuresFile e.g. 'vitocal_222_features.json'
 * @returns {string | null}
 */
function installationsFileFor(featuresFile) {
  const prefix = featuresFile.replace(/_features\.json$/, '');
  for (const candidate of [prefix, prefix.replace(/_\d{4}$/, '')]) {
    const file = `${candidate}_installations.json`;
    if (fs.existsSync(path.join(FIXTURES_DIR, file))) return file;
  }
  return null;
}

/**
 * Installation id, gateway serial and device id from the feature URIs, roles from the
 * installations dump (the gateway with that serial, else the first heating device).
 * @param {{ data: object[] }} featuresDump
 * @param {object} installationsDump
 */
function deviceIdentity(featuresDump, installationsDump) {
  const uri = featuresDump.data.find((feature) => feature.uri)?.uri || '';
  const [, installationId, gatewaySerial, deviceId] = uri.match(/installations\/(\d+)\/gateways\/(\w+)\/devices\/(\w+)/) || [];
  const gateways = [];
  const collect = (value) => {
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') {
      if (Array.isArray(value.devices) && value.serial) gateways.push(value);
      Object.values(value).forEach(collect);
    }
  };
  collect(installationsDump);
  const heatingDevices = gateways.flatMap((gateway) => gateway.devices
    .filter((device) => device.deviceType === 'heating')
    .map((device) => ({ gateway, device })));
  const match = heatingDevices.find(({ gateway, device }) => gateway.serial === gatewaySerial && String(device.id) === deviceId)
    || heatingDevices[0];
  return {
    installationId: Number(installationId) || match.gateway.installationId,
    gatewaySerial: gatewaySerial || match.gateway.serial,
    deviceId: deviceId || String(match.device.id),
    roles: match.device.roles,
  };
}

/**
 * A minimal installations response with one heating device, for a PyViCare response (which
 * comes without one).
 * @param {{ installationId: number, gatewaySerial: string, deviceId: string, roles: string[] }} identity
 * @param {string} modelId
 */
function syntheticInstallations(identity, modelId) {
  return {
    data: [{
      id: identity.installationId,
      description: 'Fixture installation',
      gateways: [{
        serial: identity.gatewaySerial,
        installationId: identity.installationId,
        gatewayType: 'VitoconnectOpto1',
        aggregatedStatus: 'WorksProperly',
        devices: [{
          id: identity.deviceId,
          gatewaySerial: identity.gatewaySerial,
          modelId,
          deviceType: 'heating',
          status: 'Online',
          roles: identity.roles,
        }],
      }],
    }],
  };
}

/**
 * @typedef {object} FixtureDevice
 * @property {string} name e.g. 'vitocal_222' or 'pyvicare/Vitocal200'
 * @property {{ data: object[] }} features the device's features response
 * @property {object} installations the installations response it is paired from
 * @property {{ installationId: number, gatewaySerial: string, deviceId: string, roles: string[] }} identity
 */

/**
 * Every fixture device, sorted by name: ours first, then PyViCare's.
 * @returns {FixtureDevice[]}
 */
function loadFixtureDevices() {
  const own = fs.readdirSync(FIXTURES_DIR)
    .filter((file) => file.endsWith('_features.json'))
    .sort()
    .map((file) => {
      const features = readJson(path.join(FIXTURES_DIR, file));
      const installationsFile = installationsFileFor(file);
      if (!installationsFile) throw new Error(`No installations dump for ${file}`);
      const installations = readJson(path.join(FIXTURES_DIR, installationsFile));
      return {
        name: file.replace(/_features\.json$/, ''), features, installations, identity: deviceIdentity(features, installations),
      };
    });
  const pyvicare = fs.readdirSync(PYVICARE_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const features = readJson(path.join(PYVICARE_DIR, file));
      const identity = identityOf(features);
      const name = `pyvicare/${path.basename(file, '.json')}`;
      return {
        name, features, installations: syntheticInstallations(identity, path.basename(file, '.json')), identity,
      };
    });
  return [...own, ...pyvicare];
}

/**
 * One fixture device by name (as in loadFixtureDevices); throws with the known names otherwise.
 * @param {string} name
 * @returns {FixtureDevice}
 */
function findFixtureDevice(name) {
  const devices = loadFixtureDevices();
  const wanted = name.replace(/\.json$/, '').replace(/_features$/, '');
  const device = devices.find((candidate) => candidate.name === wanted)
    || devices.find((candidate) => candidate.name.toLowerCase() === wanted.toLowerCase());
  if (!device) {
    throw new Error(`Unknown fixture "${name}". Known fixtures:\n  ${devices.map((candidate) => candidate.name).join('\n  ')}`);
  }
  return device;
}

module.exports = {
  FIXTURES_DIR, loadFixtureDevices, findFixtureDevice, deviceIdentity, installationsFileFor, syntheticInstallations,
};
