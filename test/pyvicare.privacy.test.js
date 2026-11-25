/* eslint-env jest */

'use strict';

/*
 * Guards test/fixtures/pyvicare/ the way test/fixtures.privacy.test.js guards test/fixtures/:
 * every file must be the output of scripts/anonymizeDump.js, so running the anonymizer
 * (lib/anonymize.js, fixture style) again must not change anything. Failure messages name JSON
 * paths only, never values.
 */

const {
  anonymizeDumps, FAKE_PATTERNS, NEW_HOST, OLD_HOST,
} = require('../lib/anonymize');
const { loadPyViCareFixtures } = require('./helpers/pyvicareFixtures');

// Integers of 10+ digits that are not the fraction of a decimal number or part of a word.
const LONG_NUMBER = /(?<![\w.])\d{10,}(?![\w])/g;
// String values of exactly 16 hex digits: serials or zigbee hardware addresses (EUI-64)
const HEX_ID = /"([0-9A-Fa-f]{16})"/g;

const fixtures = loadPyViCareFixtures();

// JSON paths at which two values differ
function differences(a, b, at = '$', found = []) {
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) differences(a[key], b[key], `${at}.${key}`, found);
  } else if (a !== b) {
    found.push(at);
  }
  return found;
}

test('there are PyViCare fixtures to check', () => {
  expect(fixtures.length).toBeGreaterThan(0);
});

describe.each(fixtures.map(({ name, text, dump }) => [name, text, dump]))('test/fixtures/pyvicare/%s', (name, text, dump) => {
  test('has nothing left for scripts/anonymizeDump.js to replace', () => {
    const [anonymized] = anonymizeDumps([dump]);
    expect(differences(dump, anonymized)).toEqual([]);
  });

  test('contains no long numbers other than fake serials', () => {
    const suspicious = (text.match(LONG_NUMBER) || []).filter((number) => !FAKE_PATTERNS.serial.test(number));
    expect(suspicious).toHaveLength(0);
  });

  test('contains no 16-digit hex ids (serials, zigbee addresses) other than fake serials', () => {
    const suspicious = [...text.matchAll(HEX_ID)].map(([, id]) => id).filter((id) => !FAKE_PATTERNS.serial.test(id));
    expect(suspicious).toHaveLength(0);
  });

  test('uses only the current API host', () => {
    expect(text.includes(OLD_HOST)).toBe(false);
    const hosts = new Set(text.match(/https?:\/\/[^/"]+/g) || []);
    expect([...hosts].filter((host) => host !== `https://${NEW_HOST}`)).toEqual([]);
  });
});
