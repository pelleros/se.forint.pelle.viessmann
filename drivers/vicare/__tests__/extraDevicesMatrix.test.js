/* eslint-env jest */

'use strict';

// The extra devices' matrix golden file (extraDevicesMatrix.json): what pairing lists for every
// fixture in test/fixtures/ as heating circuits, hot water and rooms, and what each of those
// devices gets (capabilities, options, values). Any change fails here until the file is
// regenerated with `npm run matrix`, so every pull request shows its effect as a diff.

const fs = require('fs');

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const { EXTRA_MATRIX_FILE, buildExtraMatrix, formatExtraMatrix } = require('../../../test/helpers/extraDevicesMatrix');
const registry = require('./registry.json');

const UPDATE = process.env.UPDATE_CAPABILITY_MATRIX === '1';

let matrix;
beforeAll(async () => {
  matrix = await buildExtraMatrix();
});

test('the extra devices\' matrix is up to date (regenerate it with `npm run matrix`)', () => {
  const text = formatExtraMatrix(matrix);
  if (UPDATE) fs.writeFileSync(EXTRA_MATRIX_FILE, text);
  const golden = fs.existsSync(EXTRA_MATRIX_FILE) ? fs.readFileSync(EXTRA_MATRIX_FILE, 'utf8') : '';
  expect(JSON.parse(text)).toEqual(golden ? JSON.parse(golden) : {});
  expect(text).toBe(golden);
});

test('extra devices get only the registered capabilities of their driver', () => {
  const drivers = { circuit: 'heating-circuit', hotWater: 'hot-water', room: 'room' };
  for (const kinds of Object.values(matrix.devices)) {
    for (const [kind, devices] of Object.entries(kinds)) {
      for (const device of devices) {
        for (const capability of device.capabilities) expect(registry.drivers[drivers[kind]].capabilities).toContain(capability);
      }
    }
  }
});

test('the matrix has circuits, hot water and rooms', () => {
  const kinds = Object.values(matrix.devices).flatMap((entry) => Object.keys(entry));
  expect(new Set(kinds)).toEqual(new Set(['circuit', 'hotWater', 'room']));
});
