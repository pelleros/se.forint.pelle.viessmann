/* eslint-env jest */

'use strict';

/*
 * Guards against real installation data ending up in test/fixtures/.
 *
 * Every committed fixture must be produced by scripts/anonymizeDump.js, which replaces every
 * identifier with a value from a recognizable fake range (FAKE_PATTERNS). This test walks each
 * fixture and fails if an identifying field holds anything other than a fake value, if any long
 * number that could be a serial is not a fake serial, or if personal data is left in place.
 * It works on patterns only, so it also catches identifiers from future dumps, and it never
 * needs (or stores) the original values. Failure messages mask the offending value.
 */

const fs = require('fs');
const path = require('path');
const {
  FAKE_PATTERNS, FAKE_TIMESTAMP, GENERIC_DEVICE_ID, ISO_TIMESTAMP, NEW_HOST, OLD_HOST, REDACTED,
} = require('../scripts/anonymizeDump');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const fixtureFiles = fs.readdirSync(FIXTURES_DIR).filter((file) => file.endsWith('.json')).sort();

const SERIAL_KEYS = new Set(['gatewaySerial', 'gatewayId', 'boilerSerial', 'bmuSerial', 'serial']);
const REDACT_KEYS = new Set(['description', 'buildingName', 'buildingEmail', 'buildingPhone', 'servicedBy', 'uid']);
const URI_IDS = /\/(installations|gateways|devices)\/([^/?#]+)/g;
// Integers of 10+ digits that are not the fraction of a decimal number or part of a word.
const LONG_NUMBER = /(?<![\w.])\d{10,}(?![\w])/g;

function mask(value) {
  return String(value).replace(/[A-Za-z]/g, 'x').replace(/\d/g, '#').slice(0, 40);
}

function isFakeDeviceId(value) {
  return GENERIC_DEVICE_ID.test(String(value)) || FAKE_PATTERNS.deviceId.test(String(value));
}

function isRedactedLeaf(value) {
  return value === null || value === '' || value === REDACTED || value === 0 || typeof value === 'boolean';
}

function checkUri(uri, at, problems) {
  if (!uri.startsWith(`https://${NEW_HOST}/`)) problems.push(`${at}: uri does not use ${NEW_HOST}`);
  for (const [, kind, id] of uri.matchAll(URI_IDS)) {
    const ok = {
      installations: () => FAKE_PATTERNS.installationId.test(id),
      gateways: () => FAKE_PATTERNS.serial.test(id),
      devices: () => isFakeDeviceId(id),
    }[kind]();
    if (!ok) problems.push(`${at}: uri contains a non-fake ${kind} id ${mask(id)}`);
  }
}

function checkFeature(feature, at, problems) {
  const value = feature.properties?.value?.value;
  if (feature.feature.endsWith('.serial') && value !== '' && !FAKE_PATTERNS.serial.test(String(value))) {
    problems.push(`${at}.properties.value.value: ${feature.feature} is not a fake serial (${mask(value)})`);
  }
  const name = feature.properties?.name?.value;
  if (/^heating\.circuits\.\d+(\.name)?$/.test(feature.feature) && typeof name === 'string' && name !== '' && !FAKE_PATTERNS.circuitName.test(name)) {
    problems.push(`${at}.properties.name.value: circuit name is not anonymized (${mask(name)})`);
  }
}

function checkField(key, value, context, at, problems) {
  if (value === null || value === undefined) return;
  const fail = (what) => problems.push(`${at}: ${what} (${mask(value)})`);

  if (key === 'address') {
    const leaves = [];
    (function collect(node) {
      if (node && typeof node === 'object') Object.values(node).forEach(collect);
      else leaves.push(node);
    }(value));
    if (!leaves.every(isRedactedLeaf)) problems.push(`${at}: address is not anonymized`);
    return;
  }
  if (typeof value === 'object') return;

  if (key === 'installationId' || (key === 'id' && context.isInstallation)) {
    if (!FAKE_PATTERNS.installationId.test(String(value))) fail('installation id is not fake');
  } else if (key === 'deviceId' || (key === 'id' && context.isDevice)) {
    if (!isFakeDeviceId(value)) fail('device id is not generic or fake');
  } else if (SERIAL_KEYS.has(key)) {
    if (!FAKE_PATTERNS.serial.test(String(value))) fail(`${key} is not a fake serial`);
  } else if (key === 'materialNumber') {
    if (!FAKE_PATTERNS.materialNumber.test(String(value))) fail('materialNumber is not fake');
  } else if (REDACT_KEYS.has(key)) {
    if (value !== '' && value !== REDACTED) fail(`${key} is not anonymized`);
  } else if (key === 'next' && context.containerKey === 'cursor') {
    if (value !== '') fail('pagination cursor is not empty');
  }

  if (typeof value === 'string') {
    if (ISO_TIMESTAMP.test(value) && value !== FAKE_TIMESTAMP) fail('timestamp is not normalized');
    if (value.includes('@')) fail('looks like an e-mail address');
    if (key === 'uri') checkUri(value, at, problems);
  }
}

function findProblems(node, at = '$', containerKey = null, problems = []) {
  if (Array.isArray(node)) {
    node.forEach((item, i) => findProblems(item, `${at}[${i}]`, containerKey, problems));
  } else if (node && typeof node === 'object') {
    const context = { containerKey, isInstallation: Array.isArray(node.gateways), isDevice: containerKey === 'devices' };
    if (typeof node.feature === 'string') checkFeature(node, at, problems);
    for (const [key, value] of Object.entries(node)) {
      checkField(key, value, context, `${at}.${key}`, problems);
      if (key !== 'address') findProblems(value, `${at}.${key}`, key, problems);
    }
  }
  return problems;
}

describe('test fixtures privacy', () => {
  test('there are fixtures to check', () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
  });

  describe.each(fixtureFiles)('%s', (file) => {
    const text = fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf8');

    test('follows the <model>_features.json / <model>_installations.json naming', () => {
      expect(file).toMatch(/^[a-z0-9_]+_(features|installations)\.json$/);
    });

    test('does not reference the old API host', () => {
      expect(text.includes(OLD_HOST)).toBe(false);
    });

    test('contains no long numbers other than fake serials', () => {
      const suspicious = (text.match(LONG_NUMBER) || []).filter((number) => !FAKE_PATTERNS.serial.test(number));
      expect(suspicious.map(mask)).toEqual([]);
    });

    test('contains only fake identifiers and no personal data', () => {
      expect(findProblems(JSON.parse(text))).toEqual([]);
    });
  });
});
