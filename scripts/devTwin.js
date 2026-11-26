/* eslint-disable no-console */

'use strict';

/*
 * Builds a "dev twin" of this app: the same code under the app ID se.forint.pelle.viessmann.dev
 * and the name "ViCare (dev)", so it can be installed next to the App Store version on the same
 * Homey, with its own app settings (Client ID) and its own devices. See docs/TESTING.md.
 *
 *   node scripts/devTwin.js <build|install|run> [--ref <git-ref>] [--poll-minutes <n>] [--keep]
 *                           [--allow-default-poll] [--fixture <name>] [-- <extra Homey CLI arguments>]
 *
 * Steps:
 *  1. Export the committed tree of --ref (default HEAD) with `git archive` into a new temporary
 *     directory outside the repository. Untracked files (documentation/, CLAUDE.md, local
 *     node_modules) never end up in the twin.
 *  2. Patch the copy: app id and name in .homeycompose/app.json (and the root app.json), and the
 *     poll interval, because the twin polls the same Viessmann installation as the real app.
 *  3. `npm ci --ignore-scripts` in the copy. Old refs have an npm script named "install" that runs
 *     `homey app install`; --ignore-scripts makes sure it never runs. Then the ref's own
 *     scripts/generateFlowCompose.js, if it has one (never moveDocumentation.js).
 *  4. `homey app build` in the copy and a check of the built app.json and poll interval.
 *     `build` also runs `homey app validate --level publish`.
 *  5. install/run only: show the exact Homey CLI command, ask for confirmation, then run it.
 *
 * With --fixture <name>, the twin is the "fixture twin" (se.forint.pelle.viessmann.fixture,
 * "ViCare (fixture)"): after step 2 its OAuth client is replaced by one that answers from a
 * fixture in test/fixtures/ (taken from this checkout) instead of the Viessmann API, and pairing
 * asks for any user name and password instead of the Viessmann login. See
 * scripts/fixtureTwin/FixtureOAuth2Client.js.
 *
 * Nothing here talks to a Homey except step 5, and only after a "y" on stdin.
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const REPO_ROOT = path.resolve(__dirname, '..');
const APP_ID = 'se.forint.pelle.viessmann';
const TWIN_ID = `${APP_ID}.dev`;
const TWIN_NAME = 'ViCare (dev)';
const FIXTURE_TWIN_ID = `${APP_ID}.fixture`;
const FIXTURE_TWIN_NAME = 'ViCare (fixture)';
// The fixture twin's own files, and the marker scripts/checkPackage.js refuses in a store build
const FIXTURE_DIR = 'fixtureMode';
const FIXTURE_MARKER = 'vicare-dev-twin-fixture-mode';
const FIXTURE_CLIENT_SOURCE = path.join(__dirname, 'fixtureTwin', 'FixtureOAuth2Client.js');
const DEFAULT_POLL_MINUTES = 10;
const COMMANDS = ['build', 'install', 'run'];
const IS_WINDOWS = process.platform === 'win32';

// Directories (relative to the app root) searched for the poll interval, and the files skipped.
const POLL_SEARCH_DIRS = ['drivers', 'lib'];
const POLL_SKIP_DIRS = new Set(['__tests__', 'node_modules']);

// A definition `NAME = <product of integer literals>;`, also as `static`, `const`/`let`/`var` or
// `this.` (120000, 2 * 60_000, 2 * 60 * 1000, ...)
const definitionOf = (name) => new RegExp(
  `^([ \\t]*(?:static\\s+|const\\s+|let\\s+|var\\s+|this\\.)?${name}\\s*=\\s*)(\\d[\\d_]*(?:\\s*\\*\\s*\\d[\\d_]*)*)(\\s*;)`,
  'gm',
);

/*
 * Poll interval patterns, one entry per way a released or upcoming version defines it, newest
 * first. Only the newest pattern a ref has is patched (see patchPollIntervals): a ref can still
 * define an older constant that nothing reads any more.
 *
 *  - AUTO_INTERVAL_PER_DEVICE: from the first 2.0.0 builds with drivers/vicare/pollPlan.js. The
 *    automatic interval ("auto", the default of the device setting pollInterval) is
 *    AUTO_INTERVAL_PER_DEVICE × number of devices, and a chosen interval shorter than it counts
 *    as automatic. Until it was removed, those refs also define an unused MIN_POLL_INTERVAL in
 *    driver.js.
 *  - MIN_POLL_INTERVAL: up to v1.0.16 and the 2.0.0 builds before pollPlan.js, the class field in
 *    drivers/vicare/driver.js, with the same meaning.
 *
 * A ref that defines its interval another way fails loudly, so that the twin never silently polls
 * at the real app's rate; add a pattern here when that happens.
 */
const POLL_PATTERNS = [
  { name: 'AUTO_INTERVAL_PER_DEVICE', regex: definitionOf('AUTO_INTERVAL_PER_DEVICE') },
  { name: 'MIN_POLL_INTERVAL', regex: definitionOf('MIN_POLL_INTERVAL') },
];

const USAGE = `Usage: node scripts/devTwin.js <build|install|run> [options] [-- <Homey CLI arguments>]

Builds "${TWIN_NAME}" (${TWIN_ID}) from a git ref, to install next to the real app.

Commands:
  build     Export, patch, validate and build the twin locally. Nothing is installed.
  install   As build, then \`homey app install\` after confirmation (keeps the twin installed).
  run       As build, then \`homey app run\` after confirmation. The Homey CLI uninstalls the
            twin, and with it every device paired to it, when you stop it with Ctrl+C.

Options:
  --ref <git-ref>        Commit, tag or branch to build (default: HEAD). Only committed files.
  --poll-minutes <n>     Twin poll interval per device in minutes (default: ${DEFAULT_POLL_MINUTES}).
  --allow-default-poll   Continue when the ref's poll interval is not recognised (polls at the
                         real app's rate; mind the API quota).
  --fixture <name>       Build the fixture twin (${FIXTURE_TWIN_ID}, "${FIXTURE_TWIN_NAME}"), which answers
                         from a fixture in test/fixtures/ instead of the Viessmann API: no
                         account, no quota. Log in with any user name and password. Names such
                         as vitodens_200_e3 or pyvicare/Vitocal250A_TwoCircuits; an unknown name
                         lists them all.
  --keep                 Keep the temporary directory (it is printed). Otherwise it is removed.
  -h, --help             Show this help.

Arguments after -- are passed to \`homey app install|run\` (e.g. -- --remote).
See docs/TESTING.md.`;

class UsageError extends Error {}

/* ------------------------------------------------------------------------------------------ */
/* Pure functions (unit tested in test/devTwin.test.js)                                       */
/* ------------------------------------------------------------------------------------------ */

function parseArgs(argv) {
  const options = {
    command: null,
    ref: 'HEAD',
    pollMinutes: DEFAULT_POLL_MINUTES,
    keep: false,
    allowDefaultPoll: false,
    fixture: null,
    help: false,
    homeyArgs: [],
  };
  const args = [...argv];
  const takeValue = (flag, inline) => {
    if (inline !== undefined) return inline;
    const value = args.shift();
    if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} needs a value`);
    return value;
  };

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '--') {
      options.homeyArgs = args.splice(0);
      break;
    }
    const [flag, inline] = arg.startsWith('--') && arg.includes('=')
      ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]
      : [arg, undefined];
    switch (flag) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '--ref':
        options.ref = takeValue(flag, inline);
        break;
      case '--poll-minutes': {
        const value = takeValue(flag, inline);
        const minutes = Number(value);
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(minutes) || minutes < 1) {
          throw new UsageError(`--poll-minutes must be a whole number of minutes (got "${value}")`);
        }
        options.pollMinutes = minutes;
        break;
      }
      case '--keep':
        options.keep = true;
        break;
      case '--allow-default-poll':
        options.allowDefaultPoll = true;
        break;
      case '--fixture':
        options.fixture = takeValue(flag, inline);
        break;
      default:
        if (flag.startsWith('-')) throw new UsageError(`Unknown option ${flag}`);
        if (options.command) throw new UsageError(`Unexpected argument ${arg}`);
        if (!COMMANDS.includes(arg)) throw new UsageError(`Unknown command "${arg}" (use ${COMMANDS.join(', ')})`);
        options.command = arg;
    }
  }

  if (!options.help && !options.command) throw new UsageError(`Missing command (${COMMANDS.join(', ')})`);
  if (options.homeyArgs.length > 0 && options.command === 'build') {
    throw new UsageError('Arguments after -- are only used with install and run');
  }
  return options;
}

// Evaluates a product of integer literals such as "2 * 60 * 1000" or "120_000".
function evaluateProduct(expression) {
  return expression
    .split('*')
    .map((factor) => Number(factor.trim().replace(/_/g, '')))
    .reduce((product, factor) => product * factor, 1);
}

/*
 * Rewrites every definition of the given poll interval patterns (default: all) in one source file
 * to `minutes` minutes. Returns the new source and one change record per definition. Throws if the
 * new interval would be shorter than the one in the source: the twin must never poll more often
 * than the real app.
 */
function patchPollInterval(source, minutes, patterns = POLL_PATTERNS) {
  if (!Number.isSafeInteger(minutes) || minutes < 1) throw new Error(`Invalid poll interval: ${minutes} minutes`);
  const toMs = minutes * 60 * 1000;
  const changes = [];
  let patched = source;

  for (const { name, regex } of patterns) {
    patched = patched.replace(regex, (match, head, expression, tail, offset) => {
      const fromMs = evaluateProduct(expression);
      if (toMs < fromMs) {
        throw new Error(`The twin must not poll more often than the real app: ${name} is ${fromMs / 60000} minutes, `
          + `--poll-minutes is ${minutes}`);
      }
      const after = `${head}${minutes} * 60 * 1000${tail} // dev twin, was ${expression}`;
      changes.push({
        pattern: name,
        line: source.slice(0, offset).split('\n').length,
        before: match.trim(),
        after: after.trim(),
        fromMs,
        toMs,
      });
      return after;
    });
  }

  return { source: patched, changes };
}

function listJsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (POLL_SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listJsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) files.push(full);
  }
  return files.sort();
}

/*
 * Patches the poll interval in the app source files of `appDir` (drivers/ and lib/, tests
 * excluded) and writes the changed files. Only the newest pattern in POLL_PATTERNS that the ref
 * defines is patched; older constants it still has are left alone. Throws when no definition is
 * recognised, unless allowDefaultPoll is set. Returns the change records, each with the relative
 * file path.
 */
function patchPollIntervals(appDir, minutes, { allowDefaultPoll = false } = {}) {
  const files = POLL_SEARCH_DIRS.flatMap((dir) => listJsFiles(path.join(appDir, dir)))
    .map((file) => ({ file, source: fs.readFileSync(file, 'utf8') }));

  for (const pattern of POLL_PATTERNS) {
    const patched = files.map(({ file, source }) => ({ file, ...patchPollInterval(source, minutes, [pattern]) }))
      .filter((result) => result.changes.length > 0);
    if (patched.length === 0) continue;
    const changes = [];
    for (const result of patched) {
      fs.writeFileSync(result.file, result.source);
      const relative = path.relative(appDir, result.file).split(path.sep).join('/');
      changes.push(...result.changes.map((change) => ({ file: relative, ...change })));
    }
    return changes;
  }

  if (!allowDefaultPoll) {
    throw new Error('No poll interval definition recognised in drivers/ or lib/ of this ref '
      + `(known patterns: ${POLL_PATTERNS.map((pattern) => pattern.name).join(', ')}). The twin would poll the `
      + 'Viessmann API as often as the real app. Add the pattern to POLL_PATTERNS in scripts/devTwin.js, or pass '
      + '--allow-default-poll to build it anyway.');
  }
  return [];
}

// The id and name of the twin, or of the fixture twin
const twinIdentity = (fixture) => (fixture ? { id: FIXTURE_TWIN_ID, name: FIXTURE_TWIN_NAME } : { id: TWIN_ID, name: TWIN_NAME });

/*
 * Returns a copy of an app manifest (.homeycompose/app.json or app.json) with the twin's id and
 * name in every language the manifest has. Refuses manifests of other apps.
 */
function patchManifest(manifest, { id = TWIN_ID, name: twinName = TWIN_NAME } = {}) {
  if (![APP_ID, TWIN_ID, FIXTURE_TWIN_ID].includes(manifest.id)) {
    throw new Error(`Unexpected app id "${manifest.id}" (expected ${APP_ID})`);
  }
  let name;
  if (manifest.name && typeof manifest.name === 'object') {
    name = Object.fromEntries(Object.keys(manifest.name).map((language) => [language, twinName]));
  } else {
    name = { en: twinName };
  }
  return { ...manifest, id, name };
}

function isTwinManifest(manifest, { id = TWIN_ID, name = TWIN_NAME } = {}) {
  return manifest.id === id
    && Boolean(manifest.name)
    && Object.values(manifest.name).length > 0
    && Object.values(manifest.name).every((value) => value === name);
}

// The fixture twin's app.js: the ref's app (moved to app.store.js) with the fixture client
const FIXTURE_APP_JS = `'use strict';

// ${FIXTURE_MARKER}: written by scripts/devTwin.js --fixture. The app of app.store.js, with an
// OAuth client that answers from ${FIXTURE_DIR}/fixture.json instead of the Viessmann API.

const App = require('./app.store');
const ViessmannOAuth2Client = require('./lib/ViessmannOAuth2Client');
const { createFixtureClient } = require('./${FIXTURE_DIR}/FixtureOAuth2Client');
const fixture = require('./${FIXTURE_DIR}/fixture.json');

class FixtureApp extends App {

  static OAUTH2_CLIENT = createFixtureClient(ViessmannOAuth2Client, fixture);

  async onInit() {
    // Pairing refuses to start without a Client ID; the fixture needs none
    if (!this.homey.settings.get('clientId')) this.homey.settings.set('clientId', 'fixture-mode');
    await super.onInit();
  }

}

module.exports = FixtureApp;
`;

// Pairing and Repair ask for any user name and password instead of the Viessmann login (views
// that lead to the Viessmann login lead there instead)
function patchLoginViews(driverCompose) {
  const credentials = (view) => {
    const navigation = view.navigation && Object.fromEntries(Object.entries(view.navigation)
      .map(([direction, target]) => [direction, target === 'login_oauth2' ? 'login_credentials' : target]));
    const patched = view.template === 'login_oauth2' ? { id: 'login_credentials', template: 'login_credentials' } : { ...view };
    if (navigation) patched.navigation = navigation;
    return patched;
  };
  return {
    ...driverCompose,
    pair: (driverCompose.pair || []).map(credentials),
    repair: (driverCompose.repair || []).map(credentials),
  };
}

/*
 * Turns the exported app in appDir into the fixture twin's: copies the fixture client and the
 * fixture (installation and features, from test/fixtures/ of this checkout) into fixtureMode/,
 * moves app.js to app.store.js and writes an app.js that uses the fixture client, and switches
 * pairing and Repair to the user name/password view. Returns what it did.
 */
function installFixtureMode(appDir, fixture) {
  for (const required of ['app.js', 'lib/ViessmannOAuth2Client.js', 'drivers/vicare/driver.compose.json']) {
    if (!fs.existsSync(path.join(appDir, required))) throw new Error(`Fixture mode needs ${required}, which this ref does not have`);
  }
  const appJs = fs.readFileSync(path.join(appDir, 'app.js'), 'utf8');
  if (!/OAUTH2_CLIENT\s*=\s*ViessmannOAuth2Client/.test(appJs)) {
    throw new Error('Fixture mode needs an app.js with `static OAUTH2_CLIENT = ViessmannOAuth2Client`');
  }
  const fixtureDir = path.join(appDir, FIXTURE_DIR);
  fs.mkdirSync(fixtureDir, { recursive: true });
  fs.copyFileSync(FIXTURE_CLIENT_SOURCE, path.join(fixtureDir, 'FixtureOAuth2Client.js'));
  fs.writeFileSync(path.join(fixtureDir, 'fixture.json'), JSON.stringify({
    name: fixture.name, installations: fixture.installations, features: fixture.features,
  }));
  fs.renameSync(path.join(appDir, 'app.js'), path.join(appDir, 'app.store.js'));
  fs.writeFileSync(path.join(appDir, 'app.js'), FIXTURE_APP_JS);
  const driverComposeFile = path.join(appDir, 'drivers', 'vicare', 'driver.compose.json');
  const driverCompose = JSON.parse(fs.readFileSync(driverComposeFile, 'utf8'));
  fs.writeFileSync(driverComposeFile, `${JSON.stringify(patchLoginViews(driverCompose), null, 2)}\n`);
  return { fixture: fixture.name, features: fixture.features.data.length };
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/*
 * The Homey selected in the Homey CLI, read from its local settings file (never from the
 * network). Returns { id, name } or null.
 */
function readActiveHomey(env = process.env) {
  const directory = env.HOMEY_HOME
    || (IS_WINDOWS ? path.join(env.APPDATA || '', 'athom-cli') : path.join(env.HOME || os.homedir(), '.athom-cli'));
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(directory, 'settings.json'), 'utf8'));
    const active = settings.activeHomey;
    return active && active.id ? { id: active.id, name: active.name || active.id } : null;
  } catch (error) {
    return null;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Side effects                                                                               */
/* ------------------------------------------------------------------------------------------ */

function git(args, { cwd = REPO_ROOT } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || '').trim() || `exit ${result.status}`}`);
  }
  return result.stdout.trim();
}

function step(message) {
  console.log(`\n▸ ${message}`);
}

function runSync(command, args, cwd) {
  console.log(`  $ ${[command, ...args].join(' ')}   (in ${cwd})`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: IS_WINDOWS });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
}

function resolveRef(ref) {
  let sha;
  try {
    sha = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  } catch (error) {
    throw new UsageError(`Unknown git ref "${ref}"`);
  }
  return { sha, shortSha: git(['rev-parse', '--short', sha]) };
}

function exportRef(sha, destination) {
  const archive = spawnSync('git', ['archive', '--format=tar', sha], { cwd: REPO_ROOT, maxBuffer: 1024 * 1024 * 1024 });
  if (archive.status !== 0) throw new Error(`git archive failed: ${archive.stderr.toString().trim()}`);
  const untar = spawnSync('tar', ['-x', '-f', '-', '-C', destination], { input: archive.stdout });
  if (untar.status !== 0) throw new Error(`tar failed: ${untar.stderr.toString().trim()}`);
}

function patchManifestFile(file, identity) {
  if (!fs.existsSync(file)) return false;
  const text = fs.readFileSync(file, 'utf8');
  const patched = patchManifest(JSON.parse(text), identity);
  fs.writeFileSync(file, `${JSON.stringify(patched, null, 2)}${text.endsWith('\n') ? '\n' : ''}`);
  return true;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// The Homey CLI runs `npm run build` for TypeScript apps; make sure that can't reach a Homey.
function assertSafeBuildScripts(appDir) {
  const pkg = readJson(path.join(appDir, 'package.json'));
  if (!pkg.devDependencies || !pkg.devDependencies.typescript) return;
  for (const name of ['prebuild', 'build', 'postbuild']) {
    const script = pkg.scripts && pkg.scripts[name];
    if (script && /\bhomey\b/.test(script)) {
      throw new Error(`package.json script "${name}" of this ref calls the Homey CLI ("${script}"); refusing to build`);
    }
  }
}

function verifyBuild(appDir, pollChanges, { fixture = null } = {}) {
  const buildDir = path.join(appDir, '.homeybuild');
  const manifest = readJson(path.join(buildDir, 'app.json'));
  if (!isTwinManifest(manifest, twinIdentity(fixture))) {
    throw new Error(`Built app.json has id "${manifest.id}" and name ${JSON.stringify(manifest.name)}, not the twin's`);
  }
  if (fixture && (!fs.existsSync(path.join(buildDir, FIXTURE_DIR, 'fixture.json'))
    || !fs.readFileSync(path.join(buildDir, 'app.js'), 'utf8').includes(FIXTURE_MARKER))) {
    throw new Error('The built fixture twin does not contain the fixture client');
  }
  for (const change of pollChanges) {
    const built = fs.readFileSync(path.join(buildDir, change.file), 'utf8');
    if (!built.includes(change.after)) throw new Error(`Built ${change.file} does not contain the patched poll interval`);
  }
  return { buildDir, manifest };
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    let answered = false;
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolve(answer);
    });
    rl.on('close', () => {
      if (!answered) resolve('');
    });
  });
}

// Runs a Homey CLI command in the foreground. Ctrl+C goes to the CLI, which cleans up itself
// (`homey app run` uninstalls the app and exits); this process waits for it.
function runInteractive(command, args, cwd, { ctrlCEnds = false } = {}) {
  return new Promise((resolve, reject) => {
    const ignoreSignal = () => {};
    process.on('SIGINT', ignoreSignal);
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: IS_WINDOWS });
    child.on('error', (error) => {
      process.off('SIGINT', ignoreSignal);
      reject(error);
    });
    child.on('exit', (code, signal) => {
      process.off('SIGINT', ignoreSignal);
      if (code === 0 || (ctrlCEnds && signal === 'SIGINT')) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with ${signal || `code ${code}`}`));
    });
  });
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(USAGE);
    return;
  }

  const npm = IS_WINDOWS ? 'npm.cmd' : 'npm';
  const homey = IS_WINDOWS ? 'homey.cmd' : 'homey';
  const { sha, shortSha } = resolveRef(options.ref);
  // From this checkout's test/fixtures/ (like this script), whatever the ref
  // eslint-disable-next-line global-require
  const fixture = options.fixture ? require('../test/helpers/fixtureDevices').findFixtureDevice(options.fixture) : null;
  const identity = twinIdentity(fixture);

  if (options.ref === 'HEAD' && git(['status', '--porcelain', '--untracked-files=no']) !== '') {
    console.log('Note: the working tree has uncommitted changes; the twin is built from the last commit only.');
  }

  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), `vicare-dev-twin-${shortSha}-`));
  if (isInside(REPO_ROOT, appDir)) throw new Error(`Temporary directory ${appDir} is inside the repository`);
  let succeeded = false;

  try {
    step(`Exporting ${options.ref} (${shortSha}) to ${appDir}`);
    exportRef(sha, appDir);

    step(`Patching app id → ${identity.id}, name → "${identity.name}"`);
    const composeManifest = path.join(appDir, '.homeycompose', 'app.json');
    const patchedCompose = patchManifestFile(composeManifest, identity);
    const patchedRoot = patchManifestFile(path.join(appDir, 'app.json'), identity);
    if (!patchedCompose && !patchedRoot) throw new Error('This ref has neither .homeycompose/app.json nor app.json');
    console.log(`  ${[patchedCompose && '.homeycompose/app.json', patchedRoot && 'app.json'].filter(Boolean).join(', ')}`);

    if (fixture) {
      step(`Fixture mode: answering from fixture "${fixture.name}" instead of the Viessmann API`);
      const installed = installFixtureMode(appDir, fixture);
      console.log(`  ${FIXTURE_DIR}/ with ${installed.features} features; app.js → app.store.js; pairing with any user name and password`);
    }

    step(`Patching the poll interval → ${options.pollMinutes} minutes per device`);
    const pollChanges = patchPollIntervals(appDir, options.pollMinutes, { allowDefaultPoll: options.allowDefaultPoll });
    if (pollChanges.length === 0) console.log('  WARNING: not recognised; the twin polls at the real app\'s rate (--allow-default-poll)');
    for (const change of pollChanges) console.log(`  ${change.file}:${change.line}: ${change.before}  →  ${change.after}`);

    step('Installing dependencies (lifecycle scripts disabled)');
    if (!fs.existsSync(path.join(appDir, 'package-lock.json'))) throw new Error('This ref has no package-lock.json');
    runSync(npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], appDir);

    if (fs.existsSync(path.join(appDir, 'scripts', 'generateFlowCompose.js'))) {
      step('Generating driver.flow.compose.json with the ref\'s own generator');
      runSync(process.execPath, ['scripts/generateFlowCompose.js'], appDir);
    }

    assertSafeBuildScripts(appDir);
    if (options.command === 'build') {
      step('Validating (homey app validate --level publish, local only)');
      runSync(homey, ['app', 'validate', '--level', 'publish'], appDir);
    }
    step('Building (homey app build, local only)');
    runSync(homey, ['app', 'build'], appDir);
    const { buildDir, manifest } = verifyBuild(appDir, pollChanges, { fixture });

    console.log(`\n✔ ${manifest.name.en || identity.name} ${manifest.version} (${manifest.id}) built from ${options.ref} (${shortSha})`);
    if (fixture) console.log(`  Fixture: ${fixture.name} (no Viessmann account or API calls)`);
    console.log(`  Poll interval: ${pollChanges.length > 0 ? `${options.pollMinutes} minutes per device` : 'unchanged (not recognised)'}`);
    if (options.keep || options.command !== 'build') {
      console.log(`  Source: ${appDir}\n  Build:  ${buildDir}`);
    }

    if (options.command !== 'build') {
      // Last line of defence: the CLI installs whatever .homeycompose/app.json says.
      if (patchedCompose && !isTwinManifest(readJson(composeManifest), identity)) throw new Error('The copy is not the twin; refusing to install');
      const homeyArgs = ['app', options.command, ...options.homeyArgs];
      const active = readActiveHomey();
      console.log(`\nAbout to run:\n\n    ${[homey, ...homeyArgs].join(' ')}\n\n  in ${appDir}`);
      console.log(`  Target: ${active ? `"${active.name}" (the Homey selected in the Homey CLI)` : 'no Homey selected yet; the Homey CLI will ask'}`);
      console.log(`  This installs "${identity.name}" (${identity.id}). The App Store app ${APP_ID} and its devices are not touched.`);
      if (options.command === 'run') {
        console.log('  Note: `homey app run` uninstalls the twin, and every device paired to it, when you stop it with Ctrl+C.');
        console.log('        Use `install` for anything that must survive (the upgrade test).');
      }
      if (options.homeyArgs.includes('--clean')) {
        console.log('  Note: --clean first deletes the twin\'s paired devices and app settings (Client ID).');
      }
      const answer = await ask('\nContinue? [y/N] ');
      if (!/^y(es)?$/i.test(answer.trim())) {
        console.log('Cancelled. Nothing was installed.');
        succeeded = true;
        return;
      }
      await runInteractive(homey, homeyArgs, appDir, { ctrlCEnds: options.command === 'run' });
    }
    succeeded = true;
  } finally {
    if (options.keep || !succeeded) {
      console.log(`\nKept ${appDir}${succeeded ? '' : ' (for inspection after the error)'}`);
    } else {
      fs.rmSync(appDir, { recursive: true, force: true });
      console.log(`\nRemoved ${appDir}`);
    }
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`\n✖ ${error.message}`);
    if (error instanceof UsageError) console.error(`\n${USAGE}`);
    process.exitCode = 1;
  });
}

module.exports = {
  APP_ID,
  TWIN_ID,
  TWIN_NAME,
  FIXTURE_TWIN_ID,
  FIXTURE_TWIN_NAME,
  FIXTURE_DIR,
  FIXTURE_MARKER,
  FIXTURE_APP_JS,
  installFixtureMode,
  patchLoginViews,
  DEFAULT_POLL_MINUTES,
  POLL_PATTERNS,
  UsageError,
  parseArgs,
  patchPollInterval,
  patchPollIntervals,
  patchManifest,
  isTwinManifest,
  isInside,
  readActiveHomey,
};
