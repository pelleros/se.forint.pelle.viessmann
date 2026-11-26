/* eslint-env jest */

'use strict';

// The capability matrix golden file (capabilityMatrix.json): what a newly paired device gets
// for every fixture in test/fixtures/ (capabilities, options and Flow cards). Any change to it
// fails here until the file is regenerated with `npm run matrix`, so every pull request shows
// its effect on each installation type as a diff of that file.

const fs = require('fs');

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const {
  MATRIX_FILE, buildMatrix, formatMatrix, matchesFilter, optionDifferences,
} = require('../../../test/helpers/capabilityMatrix');
const registry = require('./registry.json');

const UPDATE = process.env.UPDATE_CAPABILITY_MATRIX === '1';

let matrix;
beforeAll(async () => {
  matrix = await buildMatrix();
});

test('the capability matrix is up to date (regenerate it with `npm run matrix`)', () => {
  const text = formatMatrix(matrix);
  if (UPDATE) fs.writeFileSync(MATRIX_FILE, text);
  const golden = fs.existsSync(MATRIX_FILE) ? fs.readFileSync(MATRIX_FILE, 'utf8') : '';
  // Compared as parsed JSON first, for a readable diff of what changed
  expect(JSON.parse(text)).toEqual(golden ? JSON.parse(golden) : {});
  expect(text).toBe(golden);
});

test('the matrix covers every fixture, and every device gets only registered capabilities', () => {
  const devices = Object.entries(matrix.devices);
  expect(devices.length).toBeGreaterThan(50);
  for (const [, entry] of devices) {
    for (const capability of entry.capabilities) expect(registry.capabilities).toContain(capability);
  }
});

test('$filter matching follows Homey: any of the values, all of the keys', () => {
  expect(matchesFilter(undefined, [])).toBe(true);
  expect(matchesFilter('capabilities=a', ['a', 'b'])).toBe(true);
  expect(matchesFilter('capabilities=c|b', ['a', 'b'])).toBe(true);
  expect(matchesFilter('capabilities=c', ['a', 'b'])).toBe(false);
  expect(() => matchesFilter('class=heater', [])).toThrow('Unsupported $filter key');
});

test('option differences list changed and missing keys only', () => {
  expect(optionDifferences({ a: 1, b: 2 }, { a: 1, b: 2 })).toBeUndefined();
  expect(optionDifferences({ a: 1, b: 3, c: 4 }, { a: 1, b: 2, d: 5 })).toEqual({ b: 3, c: 4, d: null });
});
