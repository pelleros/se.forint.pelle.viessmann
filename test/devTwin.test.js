/* eslint-env jest */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const {
  APP_ID, TWIN_ID, TWIN_NAME, FIXTURE_TWIN_ID, FIXTURE_TWIN_NAME, FIXTURE_DIR, FIXTURE_MARKER, DEFAULT_POLL_MINUTES, UsageError,
  parseArgs, patchPollInterval, patchPollIntervals, patchManifest, isTwinManifest, isInside, readActiveHomey,
  installFixtureMode, patchLoginViews,
} = require('../scripts/devTwin');
const { findFixtureDevice } = require('./helpers/fixtureDevices');

const REPO_ROOT = path.join(__dirname, '..');
const V1_0_14_REF = '874e0df';
// Verbatim copy of `git show 874e0df:drivers/vicare/driver.js` (v1.0.14, the App Store version
// the upgrade test starts from). Stored as .txt so that ESLint and Jest leave it alone.
const V1_0_14_DRIVER = fs.readFileSync(path.join(__dirname, 'devTwin', 'driver-v1.0.14.js.txt'), 'utf8');
// The poll plan of the checked-out version: if a change moves or renames the poll interval, this
// test fails until scripts/devTwin.js learns the new pattern.
const CURRENT_POLL_PLAN = fs.readFileSync(path.join(REPO_ROOT, 'drivers', 'vicare', 'pollPlan.js'), 'utf8');
const MINUTE = 60 * 1000;

function compiles(source) {
  // Syntax check only; nothing is executed.
  return new vm.Script(source, { filename: 'source.js' }) instanceof vm.Script;
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'devtwin-test-'));
}

function writeFile(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

describe('patchPollInterval', () => {
  describe.each([
    ['v1.0.14 (874e0df), driver.js', V1_0_14_DRIVER, 'MIN_POLL_INTERVAL', 'MIN_POLL_INTERVAL'],
    ['the checked-out pollPlan.js', CURRENT_POLL_PLAN, 'AUTO_INTERVAL_PER_DEVICE', 'const AUTO_INTERVAL_PER_DEVICE'],
  ])('on %s', (label, source, pattern, definition) => {
    it(`rewrites the one ${pattern} definition from 2 to 10 minutes`, () => {
      const { source: patched, changes } = patchPollInterval(source, 10);

      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({
        pattern,
        before: `${definition} = 2 * 60 * 1000;`,
        after: `${definition} = 10 * 60 * 1000; // dev twin, was 2 * 60 * 1000`,
        fromMs: 2 * 60 * 1000,
        toMs: 10 * 60 * 1000,
      });
      expect(source.split('\n')[changes[0].line - 1].trim()).toBe(changes[0].before);
      expect(patched.split('\n')[changes[0].line - 1].trim()).toBe(changes[0].after);
    });

    it('changes nothing but that line and keeps the file valid JavaScript', () => {
      const { source: patched, changes } = patchPollInterval(source, 10);
      const before = source.split('\n');
      const after = patched.split('\n');

      expect(after).toHaveLength(before.length);
      const changedLines = after.map((line, index) => index).filter((index) => after[index] !== before[index]);
      expect(changedLines).toEqual([changes[0].line - 1]);
      expect(compiles(patched)).toBe(true);
    });

    it('is recognised again after patching, so the built value can be checked', () => {
      const { source: patched } = patchPollInterval(source, 10);
      const { changes } = patchPollInterval(patched, 10);

      expect(changes).toHaveLength(1);
      expect(changes[0].fromMs).toBe(10 * 60 * 1000);
    });

    it('refuses to make the twin poll more often than the real app', () => {
      expect(() => patchPollInterval(source, 1)).toThrow(/must not poll more often/);
    });
  });

  it('keeps the default of 10 minutes', () => {
    expect(DEFAULT_POLL_MINUTES).toBe(10);
  });

  it.each([
    ['  MIN_POLL_INTERVAL = 120000;', 'MIN_POLL_INTERVAL', 120000],
    ['  MIN_POLL_INTERVAL = 2 * 60_000;', 'MIN_POLL_INTERVAL', 120000],
    ['  static MIN_POLL_INTERVAL = 2 * 60 * 1000;', 'MIN_POLL_INTERVAL', 120000],
    ['const MIN_POLL_INTERVAL = 3 * 60 * 1000;', 'MIN_POLL_INTERVAL', 180000],
    ['    this.MIN_POLL_INTERVAL = 2 * 60 * 1000;', 'MIN_POLL_INTERVAL', 120000],
    ['const AUTO_INTERVAL_PER_DEVICE = 2 * 60 * 1000;', 'AUTO_INTERVAL_PER_DEVICE', 120000],
    ['let AUTO_INTERVAL_PER_DEVICE = 120_000;', 'AUTO_INTERVAL_PER_DEVICE', 120000],
  ])('recognises %s', (line, name, fromMs) => {
    const { source, changes } = patchPollInterval(`'use strict';\n${line}\n`, 15);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ pattern: name, fromMs });
    expect(source).toContain(`${name} = 15 * 60 * 1000;`);
  });

  it.each([
    ['a comment', '// MIN_POLL_INTERVAL = 2 * 60 * 1000;'],
    ['a computed value', 'MIN_POLL_INTERVAL = this.homey.settings.get("poll") * 60000;'],
    ['another name', 'POLL_INTERVAL = 2 * 60 * 1000;'],
    ['a usage', 'return this.MIN_POLL_INTERVAL * deviceCount;'],
    ['a usage of the automatic interval', 'return AUTO_INTERVAL_PER_DEVICE * Math.max(1, deviceCount);'],
  ])('ignores %s', (label, line) => {
    expect(patchPollInterval(`${line}\n`, 10).changes).toEqual([]);
  });

  it('rejects an invalid number of minutes', () => {
    expect(() => patchPollInterval(V1_0_14_DRIVER, 0)).toThrow(/Invalid poll interval/);
    expect(() => patchPollInterval(V1_0_14_DRIVER, 2.5)).toThrow(/Invalid poll interval/);
  });
});

describe('patchPollIntervals', () => {
  let dir;
  beforeEach(() => {
    dir = makeTempDir();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('patches app sources in drivers/ and lib/ and skips tests', () => {
    writeFile(dir, 'drivers/vicare/driver.js', V1_0_14_DRIVER);
    writeFile(dir, 'drivers/vicare/__tests__/driver.polling.test.js', '  MIN_POLL_INTERVAL = 2 * 60 * 1000;\n');
    writeFile(dir, 'lib/DevicePoller.js', 'module.exports = class DevicePoller {};\n');

    const changes = patchPollIntervals(dir, 10);

    expect(changes.map((change) => change.file)).toEqual(['drivers/vicare/driver.js']);
    expect(fs.readFileSync(path.join(dir, 'drivers/vicare/driver.js'), 'utf8')).toContain('MIN_POLL_INTERVAL = 10 * 60 * 1000;');
    expect(fs.readFileSync(path.join(dir, 'drivers/vicare/__tests__/driver.polling.test.js'), 'utf8'))
      .toContain('MIN_POLL_INTERVAL = 2 * 60 * 1000;');
  });

  it('patches only the newest interval a ref defines, not an older constant nothing reads', () => {
    // main from pollPlan.js until 2.0.0 removed the unused class field from driver.js
    writeFile(dir, 'drivers/vicare/driver.js', V1_0_14_DRIVER);
    writeFile(dir, 'drivers/vicare/pollPlan.js', CURRENT_POLL_PLAN);

    const changes = patchPollIntervals(dir, 10);

    expect(changes.map(({ file, pattern }) => [file, pattern])).toEqual([['drivers/vicare/pollPlan.js', 'AUTO_INTERVAL_PER_DEVICE']]);
    expect(fs.readFileSync(path.join(dir, 'drivers/vicare/driver.js'), 'utf8')).toBe(V1_0_14_DRIVER);
  });

  it('gives the checked-out app an automatic interval of 10 minutes per device', () => {
    fs.cpSync(path.join(REPO_ROOT, 'drivers'), path.join(dir, 'drivers'), { recursive: true });
    fs.cpSync(path.join(REPO_ROOT, 'lib'), path.join(dir, 'lib'), { recursive: true });

    const changes = patchPollIntervals(dir, 10);

    expect(changes.map(({ file, pattern }) => [file, pattern])).toEqual([['drivers/vicare/pollPlan.js', 'AUTO_INTERVAL_PER_DEVICE']]);
    // The patched copy, as the twin runs it
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const { pollInterval } = require(path.join(dir, 'drivers/vicare/pollPlan.js'));
    expect(pollInterval('auto', 3)).toBe(30 * MINUTE);
    expect(pollInterval(undefined, 1)).toBe(10 * MINUTE);
    expect(pollInterval('15', 3)).toBe(15 * MINUTE);
    // A shorter chosen interval counts as automatic: the twin never polls more often
    expect(pollInterval('2', 1)).toBe(10 * MINUTE);
  });

  it('fails with a clear error when no poll interval is recognised', () => {
    writeFile(dir, 'drivers/vicare/driver.js', 'POLL_EVERY = 2 * 60 * 1000;\n');

    expect(() => patchPollIntervals(dir, 10))
      .toThrow(/No poll interval definition recognised.*AUTO_INTERVAL_PER_DEVICE, MIN_POLL_INTERVAL.*--allow-default-poll/s);
  });

  it('continues without a patch when --allow-default-poll is given', () => {
    writeFile(dir, 'drivers/vicare/driver.js', 'POLL_EVERY = 2 * 60 * 1000;\n');

    expect(patchPollIntervals(dir, 10, { allowDefaultPoll: true })).toEqual([]);
    expect(fs.readFileSync(path.join(dir, 'drivers/vicare/driver.js'), 'utf8')).toBe('POLL_EVERY = 2 * 60 * 1000;\n');
  });
});

describe('patchManifest', () => {
  const manifest = {
    id: APP_ID,
    version: '1.0.14',
    name: {
      en: 'Viessmann ViCare', de: 'Viessmann ViCare', nl: 'Viessmann ViCare', fr: 'Viessmann ViCare', sv: 'Viessmann ViCare',
    },
    description: { en: 'Save time and energy' },
  };

  it('sets the twin id and the twin name in every language and keeps the rest', () => {
    const patched = patchManifest(manifest);

    expect(patched.id).toBe(TWIN_ID);
    expect(patched.name).toEqual({
      en: TWIN_NAME, de: TWIN_NAME, nl: TWIN_NAME, fr: TWIN_NAME, sv: TWIN_NAME,
    });
    expect(patched.version).toBe('1.0.14');
    expect(patched.description).toBe(manifest.description);
    expect(Object.keys(patched)).toEqual(Object.keys(manifest));
    expect(isTwinManifest(patched)).toBe(true);
    expect(isTwinManifest(manifest)).toBe(false);
  });

  it('only adds the languages the manifest has', () => {
    expect(patchManifest({ id: APP_ID, name: { en: 'Viessmann ViCare' } }).name).toEqual({ en: TWIN_NAME });
  });

  it('is idempotent', () => {
    expect(patchManifest(patchManifest(manifest))).toEqual(patchManifest(manifest));
  });

  it('refuses the manifest of another app', () => {
    expect(() => patchManifest({ ...manifest, id: 'com.example.other' })).toThrow(/Unexpected app id/);
  });

  it('patches the real compose manifest', () => {
    const compose = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.homeycompose', 'app.json'), 'utf8'));
    expect(isTwinManifest(patchManifest(compose))).toBe(true);
  });

  it('gives the fixture twin its own id and name, apart from the twin', () => {
    const identity = { id: FIXTURE_TWIN_ID, name: FIXTURE_TWIN_NAME };
    const patched = patchManifest(manifest, identity);

    expect(patched.id).toBe('se.forint.pelle.viessmann.fixture');
    expect(Object.values(patched.name)).toEqual(Array(5).fill(FIXTURE_TWIN_NAME));
    expect(isTwinManifest(patched, identity)).toBe(true);
    expect(isTwinManifest(patched)).toBe(false);
    expect(isTwinManifest(patchManifest(manifest), identity)).toBe(false);
  });
});

describe('fixture mode', () => {
  // The files of this checkout that fixture mode changes, in a temporary app directory
  function exportedApp() {
    const dir = makeTempDir();
    for (const file of ['app.js', 'lib/ViessmannOAuth2Client.js', 'drivers/vicare/driver.compose.json', 'drivers/hot-water/driver.compose.json']) {
      writeFile(dir, file, fs.readFileSync(path.join(REPO_ROOT, file)));
    }
    return dir;
  }

  it('bundles the client and the fixture, wraps app.js and switches to the credentials login', () => {
    const dir = exportedApp();
    const originalApp = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
    const fixture = findFixtureDevice('vitodens_200_e3');

    expect(installFixtureMode(dir, fixture)).toEqual({ fixture: 'vitodens_200_e3', features: fixture.features.data.length });

    expect(fs.readFileSync(path.join(dir, 'app.store.js'), 'utf8')).toBe(originalApp);
    const appJs = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
    expect(appJs).toContain(FIXTURE_MARKER);
    expect(appJs).toContain("require('./app.store')");
    expect(compiles(appJs)).toBe(true);
    expect(fs.readFileSync(path.join(dir, FIXTURE_DIR, 'FixtureOAuth2Client.js'), 'utf8')).toContain(FIXTURE_MARKER);
    const bundled = JSON.parse(fs.readFileSync(path.join(dir, FIXTURE_DIR, 'fixture.json'), 'utf8'));
    expect(bundled).toEqual({ name: 'vitodens_200_e3', installations: fixture.installations, features: fixture.features });
    const driverCompose = JSON.parse(fs.readFileSync(path.join(dir, 'drivers/vicare/driver.compose.json'), 'utf8'));
    expect(driverCompose.pair.find((view) => view.template === 'login_credentials')).toEqual({
      id: 'login_credentials', template: 'login_credentials', navigation: { next: 'pair_check' },
    });
    expect(driverCompose.repair).toEqual([{ id: 'login_credentials', template: 'login_credentials' }]);
    expect(driverCompose.pair.map((view) => view.id)).toEqual(['client_id', 'login_credentials', 'pair_check', 'list_devices', 'add_devices']);
    // The Client ID view leads to the credentials login (the twin saves a Client ID of its own)
    expect(driverCompose.pair[0].navigation).toEqual({ next: 'login_credentials' });
    expect(JSON.stringify(driverCompose)).not.toContain('login_oauth2');
    // The extra devices' drivers too
    const extraCompose = JSON.parse(fs.readFileSync(path.join(dir, 'drivers/hot-water/driver.compose.json'), 'utf8'));
    expect(extraCompose.pair.map((view) => view.id)).toEqual(['intro', 'client_id', 'login_credentials', 'list_devices', 'add_devices']);
    expect(JSON.stringify(extraCompose)).not.toContain('login_oauth2');
  });

  it('refuses a ref whose app does not use ViessmannOAuth2Client', () => {
    const dir = exportedApp();
    writeFile(dir, 'app.js', 'module.exports = class {};\n');
    expect(() => installFixtureMode(dir, findFixtureDevice('vitodens_200_e3'))).toThrow(/OAUTH2_CLIENT/);
  });

  it('keeps views other than the OAuth login', () => {
    expect(patchLoginViews({ pair: [{ id: 'list_devices', template: 'list_devices' }] }))
      .toEqual({ pair: [{ id: 'list_devices', template: 'list_devices' }], repair: [] });
  });

  it('finds fixtures by name and lists them for an unknown one', () => {
    expect(findFixtureDevice('pyvicare/Vitocal250A_TwoCircuits.json').name).toBe('pyvicare/Vitocal250A_TwoCircuits');
    expect(findFixtureDevice('VITODENS_200_E3').name).toBe('vitodens_200_e3');
    expect(() => findFixtureDevice('no-such-fixture')).toThrow(/Known fixtures:[\s\S]*vitocal_222/);
  });
});

describe('parseArgs', () => {
  it('uses HEAD, 10 minutes and no --keep by default', () => {
    expect(parseArgs(['build'])).toEqual({
      command: 'build',
      ref: 'HEAD',
      pollMinutes: 10,
      keep: false,
      allowDefaultPoll: false,
      fixture: null,
      help: false,
      homeyArgs: [],
    });
  });

  it('reads --fixture', () => {
    expect(parseArgs(['install', '--fixture', 'vitodens_200_e3']).fixture).toBe('vitodens_200_e3');
    expect(parseArgs(['build', '--fixture=pyvicare/Vitocal250A_TwoCircuits']).fixture).toBe('pyvicare/Vitocal250A_TwoCircuits');
    expect(() => parseArgs(['build', '--fixture'])).toThrow(/--fixture needs a value/);
  });

  it('reads every option, in both --flag value and --flag=value form', () => {
    expect(parseArgs(['install', '--ref', V1_0_14_REF, '--poll-minutes=15', '--keep', '--allow-default-poll', '--', '--remote']))
      .toMatchObject({
        command: 'install', ref: V1_0_14_REF, pollMinutes: 15, keep: true, allowDefaultPoll: true, homeyArgs: ['--remote'],
      });
    expect(parseArgs(['--ref=main', 'run'])).toMatchObject({ command: 'run', ref: 'main' });
  });

  it.each([
    [[], /Missing command/],
    [['deploy'], /Unknown command/],
    [['build', 'install'], /Unexpected argument/],
    [['build', '--force'], /Unknown option/],
    [['build', '--ref'], /--ref needs a value/],
    [['build', '--poll-minutes', '0'], /whole number/],
    [['build', '--poll-minutes', '2.5'], /whole number/],
    [['build', '--', '--remote'], /only used with install and run/],
  ])('rejects %j', (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(UsageError);
    expect(() => parseArgs(argv)).toThrow(message);
  });

  it('accepts --help without a command', () => {
    expect(parseArgs(['--help']).help).toBe(true);
  });
});

describe('readActiveHomey', () => {
  let dir;
  beforeEach(() => {
    dir = makeTempDir();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads the selected Homey from the Homey CLI settings file', () => {
    writeFile(dir, 'settings.json', JSON.stringify({ activeHomey: { id: 'abc', name: 'Test Homey', platform: 'local' } }));
    expect(readActiveHomey({ HOMEY_HOME: dir })).toEqual({ id: 'abc', name: 'Test Homey' });
  });

  it('returns null without a settings file or a selection', () => {
    expect(readActiveHomey({ HOMEY_HOME: dir })).toBeNull();
    writeFile(dir, 'settings.json', '{}');
    expect(readActiveHomey({ HOMEY_HOME: dir })).toBeNull();
  });
});

describe('isInside', () => {
  it('tells whether a directory is inside another', () => {
    expect(isInside('/repo', '/repo/a/b')).toBe(true);
    expect(isInside('/repo', '/repo')).toBe(true);
    expect(isInside('/repo', '/tmp/twin')).toBe(false);
    expect(isInside('/repo', '/repository')).toBe(false);
  });
});

const hasV1014 = spawnSync('git', ['cat-file', '-e', `${V1_0_14_REF}^{commit}`], { cwd: REPO_ROOT }).status === 0;
(hasV1014 ? it : it.skip)('the v1.0.14 driver fixture is a verbatim copy of the v1.0.14 commit', () => {
  const original = spawnSync('git', ['show', `${V1_0_14_REF}:drivers/vicare/driver.js`], { cwd: REPO_ROOT, encoding: 'utf8' });
  expect(original.status).toBe(0);
  expect(V1_0_14_DRIVER).toBe(original.stdout);
});
