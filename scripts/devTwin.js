/* eslint-disable no-console */

'use strict';

/*
 * Builds a "dev twin" of this app: the same code under the app ID se.forint.pelle.viessmann.dev
 * and the name "ViCare (dev)", so it can be installed next to the App Store version on the same
 * Homey, with its own app settings (Client ID) and its own devices. See docs/TESTING.md.
 *
 *   node scripts/devTwin.js <build|install|run> [--ref <git-ref>] [--poll-minutes <n>] [--keep]
 *                           [--allow-default-poll] [-- <extra Homey CLI arguments>]
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
const DEFAULT_POLL_MINUTES = 10;
const COMMANDS = ['build', 'install', 'run'];
const IS_WINDOWS = process.platform === 'win32';

// Directories (relative to the app root) searched for the poll interval, and the files skipped.
const POLL_SEARCH_DIRS = ['drivers', 'lib'];
const POLL_SKIP_DIRS = new Set(['__tests__', 'node_modules']);

/*
 * Poll interval patterns, one entry per way a released or upcoming version defines it.
 * Up to v1.0.14 and on main (and in PR #6, whose lib/DevicePoller.js reads the interval from the
 * driver) drivers/vicare/driver.js has the class field
 *     MIN_POLL_INTERVAL = 2 * 60 * 1000;
 * and polls every MIN_POLL_INTERVAL × number of devices. The pattern also accepts `static`,
 * `const`/`let` and `this.` forms and any product of integer literals (120000, 2 * 60_000, ...).
 * A ref that defines its interval another way fails loudly (see patchPollIntervals) so that the
 * twin never silently polls at the real app's rate; add a pattern here when that happens.
 */
const POLL_PATTERNS = [
  {
    name: 'MIN_POLL_INTERVAL',
    regex: /^([ \t]*(?:static\s+|const\s+|let\s+|var\s+|this\.)?MIN_POLL_INTERVAL\s*=\s*)(\d[\d_]*(?:\s*\*\s*\d[\d_]*)*)(\s*;)/gm,
  },
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
 * Rewrites every recognised poll interval definition in one source file to `minutes` minutes.
 * Returns the new source and one change record per definition. Throws if the new interval would
 * be shorter than the one in the source: the twin must never poll more often than the real app.
 */
function patchPollInterval(source, minutes) {
  if (!Number.isSafeInteger(minutes) || minutes < 1) throw new Error(`Invalid poll interval: ${minutes} minutes`);
  const toMs = minutes * 60 * 1000;
  const changes = [];
  let patched = source;

  for (const { name, regex } of POLL_PATTERNS) {
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
 * Patches the poll interval in every app source file of `appDir` (drivers/ and lib/, tests
 * excluded) and writes the changed files. Throws when no definition is recognised, unless
 * allowDefaultPoll is set. Returns the change records, each with the relative file path.
 */
function patchPollIntervals(appDir, minutes, { allowDefaultPoll = false } = {}) {
  const changes = [];
  for (const file of POLL_SEARCH_DIRS.flatMap((dir) => listJsFiles(path.join(appDir, dir)))) {
    const source = fs.readFileSync(file, 'utf8');
    const result = patchPollInterval(source, minutes);
    if (result.changes.length === 0) continue;
    fs.writeFileSync(file, result.source);
    const relative = path.relative(appDir, file).split(path.sep).join('/');
    changes.push(...result.changes.map((change) => ({ file: relative, ...change })));
  }

  if (changes.length === 0 && !allowDefaultPoll) {
    throw new Error('No poll interval definition recognised in drivers/ or lib/ of this ref '
      + `(known patterns: ${POLL_PATTERNS.map((pattern) => pattern.name).join(', ')}). The twin would poll the `
      + 'Viessmann API as often as the real app. Add the pattern to POLL_PATTERNS in scripts/devTwin.js, or pass '
      + '--allow-default-poll to build it anyway.');
  }
  return changes;
}

/*
 * Returns a copy of an app manifest (.homeycompose/app.json or app.json) with the twin's id and
 * name in every language the manifest has. Refuses manifests of other apps.
 */
function patchManifest(manifest) {
  if (manifest.id !== APP_ID && manifest.id !== TWIN_ID) {
    throw new Error(`Unexpected app id "${manifest.id}" (expected ${APP_ID})`);
  }
  let name;
  if (manifest.name && typeof manifest.name === 'object') {
    name = Object.fromEntries(Object.keys(manifest.name).map((language) => [language, TWIN_NAME]));
  } else {
    name = { en: TWIN_NAME };
  }
  return { ...manifest, id: TWIN_ID, name };
}

function isTwinManifest(manifest) {
  return manifest.id === TWIN_ID
    && Boolean(manifest.name)
    && Object.values(manifest.name).length > 0
    && Object.values(manifest.name).every((value) => value === TWIN_NAME);
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

function patchManifestFile(file) {
  if (!fs.existsSync(file)) return false;
  const text = fs.readFileSync(file, 'utf8');
  const patched = patchManifest(JSON.parse(text));
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

function verifyBuild(appDir, pollChanges) {
  const buildDir = path.join(appDir, '.homeybuild');
  const manifest = readJson(path.join(buildDir, 'app.json'));
  if (!isTwinManifest(manifest)) {
    throw new Error(`Built app.json has id "${manifest.id}" and name ${JSON.stringify(manifest.name)}, not the twin's`);
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

  if (options.ref === 'HEAD' && git(['status', '--porcelain', '--untracked-files=no']) !== '') {
    console.log('Note: the working tree has uncommitted changes; the twin is built from the last commit only.');
  }

  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), `vicare-dev-twin-${shortSha}-`));
  if (isInside(REPO_ROOT, appDir)) throw new Error(`Temporary directory ${appDir} is inside the repository`);
  let succeeded = false;

  try {
    step(`Exporting ${options.ref} (${shortSha}) to ${appDir}`);
    exportRef(sha, appDir);

    step(`Patching app id → ${TWIN_ID}, name → "${TWIN_NAME}"`);
    const composeManifest = path.join(appDir, '.homeycompose', 'app.json');
    const patchedCompose = patchManifestFile(composeManifest);
    const patchedRoot = patchManifestFile(path.join(appDir, 'app.json'));
    if (!patchedCompose && !patchedRoot) throw new Error('This ref has neither .homeycompose/app.json nor app.json');
    console.log(`  ${[patchedCompose && '.homeycompose/app.json', patchedRoot && 'app.json'].filter(Boolean).join(', ')}`);

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
    const { buildDir, manifest } = verifyBuild(appDir, pollChanges);

    console.log(`\n✔ ${manifest.name.en || TWIN_NAME} ${manifest.version} (${manifest.id}) built from ${options.ref} (${shortSha})`);
    console.log(`  Poll interval: ${pollChanges.length > 0 ? `${options.pollMinutes} minutes per device` : 'unchanged (not recognised)'}`);
    if (options.keep || options.command !== 'build') {
      console.log(`  Source: ${appDir}\n  Build:  ${buildDir}`);
    }

    if (options.command !== 'build') {
      // Last line of defence: the CLI installs whatever .homeycompose/app.json says.
      if (patchedCompose && !isTwinManifest(readJson(composeManifest))) throw new Error('The copy is not the twin; refusing to install');
      const homeyArgs = ['app', options.command, ...options.homeyArgs];
      const active = readActiveHomey();
      console.log(`\nAbout to run:\n\n    ${[homey, ...homeyArgs].join(' ')}\n\n  in ${appDir}`);
      console.log(`  Target: ${active ? `"${active.name}" (the Homey selected in the Homey CLI)` : 'no Homey selected yet; the Homey CLI will ask'}`);
      console.log(`  This installs "${TWIN_NAME}" (${TWIN_ID}). The App Store app ${APP_ID} and its devices are not touched.`);
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
