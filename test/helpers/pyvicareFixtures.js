'use strict';

// Loads the device responses from PyViCare in test/fixtures/pyvicare/ (see the README there).

const fs = require('fs');
const path = require('path');

const PYVICARE_DIR = path.join(__dirname, '../fixtures/pyvicare');

// The anonymizer's first fake values, for responses whose features carry no identifiers
const DEFAULT_IDENTITY = Object.freeze({ installationId: 900001, gatewaySerial: '9999000000000001', deviceId: '0' });

/**
 * Every fixture as `{ name, text, dump }`, sorted by file name.
 * @returns {{ name: string, text: string, dump: { data: object[], device?: object } }[]}
 */
function loadPyViCareFixtures() {
  return fs.readdirSync(PYVICARE_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const text = fs.readFileSync(path.join(PYVICARE_DIR, file), 'utf8');
      return { name: file, text, dump: JSON.parse(text) };
    });
}

/**
 * The device's roles: from the response's `device` block when it has one, otherwise inferred
 * from its features (a compressor makes it a heat pump, a burner a boiler).
 */
function rolesOf(dump) {
  if (Array.isArray(dump.device?.roles)) return dump.device.roles;
  const has = (name) => dump.data.some((feature) => feature.feature === name && feature.isEnabled);
  return [
    'type:heating',
    ...(has('heating.compressors.0') ? ['type:heatpump'] : []),
    ...(has('heating.burners.0') ? ['type:boiler'] : []),
  ];
}

/**
 * What pairing stores to identify the device: installation id, gateway serial and device id
 * from the first feature that has them, and the roles.
 */
function identityOf(dump) {
  const feature = dump.data.find((item) => item.uri) || {};
  const fromUri = (kind) => feature.uri?.match(new RegExp(`/${kind}/([^/]+)/`))?.[1];
  return {
    installationId: Number(fromUri('installations') ?? DEFAULT_IDENTITY.installationId),
    gatewaySerial: String(feature.gatewayId ?? fromUri('gateways') ?? DEFAULT_IDENTITY.gatewaySerial),
    deviceId: String(feature.deviceId ?? dump.device?.id ?? fromUri('devices') ?? DEFAULT_IDENTITY.deviceId),
    roles: rolesOf(dump),
  };
}

module.exports = {
  PYVICARE_DIR, loadPyViCareFixtures, rolesOf, identityOf,
};
