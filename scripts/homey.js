/* eslint-disable no-console */

/*
 * Wrapper around the Homey CLI for this app.
 *
 * Usage:
 *   node scripts/homey.js <install|run|validate|publish> [extra arguments for the Homey CLI]
 *   (npm run homey:install | homey:run | homey:validate | homey:publish)
 *
 * 1. Regenerates drivers/vicare/driver.flow.compose.json and driver.compose.json.
 * 2. Moves the local documentation/ folder out of the app so it is not packaged.
 * 3. Runs `homey app <command>` (validate runs with `--level publish`).
 * 4. Always moves documentation/ back, also when the Homey CLI fails or is interrupted.
 *
 * These steps used to be npm scripts named install/run/validate/publish with pre/post hooks.
 * npm treats those names as lifecycle scripts, so a plain `npm install` deployed the app.
 */

'use strict';

const { execFileSync, spawn } = require('child_process');
const os = require('os');
const path = require('path');
const documentation = require('./moveDocumentation');

const COMMANDS = {
  install: ['app', 'install'],
  run: ['app', 'run'],
  validate: ['app', 'validate', '--level', 'publish'],
  publish: ['app', 'publish'],
};
const GENERATORS = ['generateFlowCompose.js', 'generateDriverCompose.js'];
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

function runHomey(args) {
  return new Promise((resolve) => {
    const child = spawn('homey', args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', (error) => {
      console.error(error.code === 'ENOENT'
        ? 'Homey CLI not found. Install it with: npm install --global homey'
        : error.message);
      resolve(1);
    });
    child.on('exit', (code, signal) => {
      resolve(code ?? 128 + (os.constants.signals[signal] || 0));
    });
    // Stay alive until the CLI has exited so documentation/ can be restored afterwards.
    // Ctrl+C already reaches the CLI (same process group); other signals are passed on.
    const onSignal = (signal) => {
      if (signal !== 'SIGINT' && child.exitCode === null && child.signalCode === null) child.kill(signal);
    };
    SIGNALS.forEach((signal) => process.on(signal, onSignal));
    child.on('close', () => SIGNALS.forEach((signal) => process.off(signal, onSignal)));
  });
}

async function main([command, ...extraArgs]) {
  if (!COMMANDS[command]) {
    console.error(`Usage: node scripts/homey.js <${Object.keys(COMMANDS).join('|')}> [homey arguments]`);
    return 2;
  }

  for (const script of GENERATORS) {
    execFileSync(process.execPath, [path.join(__dirname, script)], { stdio: 'inherit' });
  }

  // Ignore signals while documentation/ is moved out; it is restored in the finally block.
  const ignore = () => {};
  SIGNALS.forEach((signal) => process.on(signal, ignore));
  try {
    documentation.backup();
    return await runHomey([...COMMANDS[command], ...extraArgs]);
  } finally {
    documentation.restore();
    SIGNALS.forEach((signal) => process.off(signal, ignore));
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
