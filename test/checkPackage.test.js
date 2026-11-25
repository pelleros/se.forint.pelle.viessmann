'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkPackage } = require('../scripts/checkPackage');

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
    });
    const { problems } = checkPackage(dir);
    expect(problems).toHaveLength(7);
    expect(problems.join('\n')).toMatch(/test\/fixtures\/a_features\.json/);
    expect(problems.join('\n')).toMatch(/package-lock\.json/);
    expect(problems.join('\n')).toMatch(/documentation\/dump\.json/);
  });

  test('fails clearly when the build directory is missing', () => {
    expect(() => checkPackage(path.join(os.tmpdir(), 'does-not-exist-vicare'))).toThrow(/homey app build/);
  });
});
