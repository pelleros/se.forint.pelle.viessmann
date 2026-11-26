'use strict';

/*
 * Regenerates drivers/vicare/__tests__/capabilityMatrix.json, the golden file of what a newly
 * paired device gets for every fixture (see test/helpers/capabilityMatrix.js):
 *
 *   npm run matrix
 *
 * Commit the result together with the change that caused it.
 */

const path = require('path');
const { spawnSync } = require('child_process');

// jest is a development dependency, like this script
// eslint-disable-next-line node/no-unpublished-require
const JEST = require.resolve('jest/bin/jest');

const result = spawnSync(process.execPath, [
  JEST, '--config', 'jest.config.js', '--runTestsByPath', 'drivers/vicare/__tests__/capabilityMatrix.test.js',
], {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  env: { ...process.env, UPDATE_CAPABILITY_MATRIX: '1' },
});
process.exitCode = result.status ?? 1;
