/* eslint-disable no-console */

'use strict';

/**
 * Checks the app package that `homey app build` writes to .homeybuild/: only runtime files may
 * end up in it. Fails when development files (tests, fixtures, docs, scripts, Markdown, local
 * dumps) or the dev twin's fixture mode are packaged, and prints the package size.
 *
 *   npx homey app build && node scripts/checkPackage.js [buildDir]
 */

const fs = require('fs');
const path = require('path');

// Paths relative to the build directory (forward slashes). node_modules is filled by the Homey
// CLI with production dependencies only and is not checked here.
const FORBIDDEN = [
  { pattern: /(^|\/)__tests__(\/|$)/, reason: 'test directory' },
  { pattern: /(^|\/)__mocks__(\/|$)/, reason: 'test mocks' },
  { pattern: /^test(\/|$)/, reason: 'tests and fixtures' },
  { pattern: /^docs(\/|$)/, reason: 'documentation' },
  { pattern: /^documentation(\/|$)/, reason: 'local API dumps' },
  { pattern: /^scripts(\/|$)/, reason: 'development scripts' },
  { pattern: /^coverage(\/|$)/, reason: 'coverage report' },
  { pattern: /\.md$/i, reason: 'Markdown file' },
  { pattern: /^jest\.config\.js$/, reason: 'test configuration' },
  { pattern: /^package-lock\.json$/, reason: 'lockfile (not used at runtime)' },
  { pattern: /\.test\.js$/, reason: 'test file' },
  { pattern: /^fixtureMode(\/|$)/, reason: 'dev twin fixture mode' },
  { pattern: /(^|\/)fixtures?(\/|$)/, reason: 'test fixtures' },
  { pattern: /_(features|installations)\.json$/, reason: 'API dump' },
  { pattern: /^app\.store\.js$/, reason: 'dev twin fixture mode' },
];

// Text in a packaged file that only the dev twin's fixture mode has (scripts/devTwin.js)
const FIXTURE_MARKER = 'vicare-dev-twin-fixture-mode';
const TEXT_FILE = /\.(js|json|html|txt)$/i;

function listFiles(dir, base = dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).split(path.sep).join('/');
    if (rel === 'node_modules') continue;
    if (entry.isDirectory()) files.push(...listFiles(full, base));
    else files.push({ rel, size: fs.statSync(full).size });
  }
  return files;
}

function dirSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => {
    const full = path.join(dir, entry.name);
    return sum + (entry.isDirectory() ? dirSize(full) : fs.statSync(full).size);
  }, 0);
}

function checkPackage(buildDir) {
  if (!fs.existsSync(buildDir)) throw new Error(`${buildDir} does not exist; run \`homey app build\` first`);
  const files = listFiles(buildDir);
  const problems = [];
  for (const { rel } of files) {
    const hit = FORBIDDEN.find(({ pattern }) => pattern.test(rel));
    if (hit) problems.push(`${rel} (${hit.reason})`);
    else if (TEXT_FILE.test(rel) && fs.readFileSync(path.join(buildDir, rel), 'utf8').includes(FIXTURE_MARKER)) {
      problems.push(`${rel} (dev twin fixture mode code)`);
    }
  }
  const appBytes = files.reduce((sum, { size }) => sum + size, 0);
  const depBytes = dirSize(path.join(buildDir, 'node_modules'));
  return {
    problems, fileCount: files.length, appBytes, depBytes,
  };
}

module.exports = { checkPackage, FORBIDDEN, FIXTURE_MARKER };

if (require.main === module) {
  const buildDir = path.resolve(process.argv[2] || path.join(__dirname, '..', '.homeybuild'));
  try {
    const {
      problems, fileCount, appBytes, depBytes,
    } = checkPackage(buildDir);
    const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;
    console.log(`App package: ${fileCount} files, ${kb(appBytes)} + ${kb(depBytes)} dependencies`);
    if (problems.length > 0) {
      console.error(`Files that must not be packaged (fix .homeyignore):\n  ${problems.join('\n  ')}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
