'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkPackage, FIXTURE_MARKER } = require('../scripts/checkPackage');
const devTwin = require('../scripts/devTwin');

function makeBuild(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vicare-package-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

describe('checkPackage', () => {
  test('accepts a package with runtime files only', () => {
    const dir = makeBuild({
      'app.js': 'x',
      'app.json': '{}',
      'README.txt': 'store text',
      'drivers/vicare/device.js': 'x',
      'lib/anonymize.js': 'x',
      'node_modules/homey-oauth2app/README.md': 'dependencies are not checked',
    });
    const result = checkPackage(dir);
    expect(result.problems).toEqual([]);
    expect(result.fileCount).toBe(5);
    expect(result.depBytes).toBeGreaterThan(0);
  });

  test('reports development files', () => {
    const dir = makeBuild({
      'app.js': 'x',
      'test/fixtures/a_features.json': '{}',
      'drivers/vicare/__tests__/device.test.js': 'x',
      'docs/ROADMAP.md': 'x',
      'CONTRIBUTING.md': 'x',
      'scripts/devTwin.js': 'x',
      'package-lock.json': '{}',
      'documentation/dump.json': '{}',
      'tsconfig.check.json': '{}',
      'types/homey-oauth2app.d.ts': 'x',
    });
    const { problems } = checkPackage(dir);
    expect(problems).toHaveLength(9);
    expect(problems.join('\n')).toMatch(/test\/fixtures\/a_features\.json/);
    expect(problems.join('\n')).toMatch(/package-lock\.json/);
    expect(problems.join('\n')).toMatch(/documentation\/dump\.json/);
  });

  test('reports the dev twin\'s fixture mode and fixtures anywhere in the package', () => {
    const dir = makeBuild({
      'app.js': devTwin.FIXTURE_APP_JS,
      'app.store.js': 'x',
      'fixtureMode/FixtureOAuth2Client.js': 'x',
      'fixtureMode/fixture.json': '{}',
      'lib/fixtures/x.json': '{}',
      'drivers/vicare/vitocal_222_features.json': '{}',
      'lib/other.js': `// ${FIXTURE_MARKER}`,
      'lib/ok.js': 'module.exports = {};',
    });
    const { problems } = checkPackage(dir);
    expect(problems.map((problem) => problem.split(' ')[0]).sort()).toEqual([
      'app.js', 'app.store.js', 'drivers/vicare/vitocal_222_features.json', 'fixtureMode/FixtureOAuth2Client.js',
      'fixtureMode/fixture.json', 'lib/fixtures/x.json', 'lib/other.js',
    ]);
  });

  test('the marker is the one fixture mode writes', () => {
    expect(devTwin.FIXTURE_MARKER).toBe(FIXTURE_MARKER);
    expect(fs.readFileSync(path.join(__dirname, '../scripts/fixtureTwin/FixtureOAuth2Client.js'), 'utf8')).toContain(FIXTURE_MARKER);
  });

  test('fails clearly when the build directory is missing', () => {
    expect(() => checkPackage(path.join(os.tmpdir(), 'does-not-exist-vicare'))).toThrow(/homey app build/);
  });
});
