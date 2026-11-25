/* eslint-disable no-console */

/*
 * Anonymize raw Viessmann API dumps (a features response or an installations response)
 * so they can be committed as test fixtures.
 *
 * Usage:
 *   node scripts/anonymizeDump.js <input.json> <output.json> [<input.json> <output.json> ...]
 *
 * All input/output pairs given in one invocation share one mapping, so an installation id or
 * gateway serial gets the same fake value in a features dump and in the installations dump of
 * the same installation. Fake values are assigned in order of first appearance, so the output
 * is deterministic for a given list of inputs.
 *
 * The rules live in lib/anonymize.js, which the app also uses for its troubleshooting data.
 * This script uses its FIXTURE_STYLE: realistic fake values (`900001`, `9999000000000001`, ...)
 * and timestamps set to FAKE_TIMESTAMP. Troubleshooting data copied from the app's settings page
 * can be used as input too; its placeholders are turned into fixture fake values.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const anonymize = require('../lib/anonymize');

const { anonymizeDumps } = anonymize;

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function main(args) {
  if (args.length === 0 || args.length % 2 !== 0 || args.includes('--help') || args.includes('-h')) {
    console.error('Usage: node scripts/anonymizeDump.js <input.json> <output.json> [<input.json> <output.json> ...]');
    return 1;
  }
  const pairs = [];
  for (let i = 0; i < args.length; i += 2) {
    if (path.resolve(args[i]) === path.resolve(args[i + 1])) {
      console.error(`Refusing to overwrite the input file ${args[i]}`);
      return 1;
    }
    pairs.push({ input: args[i], output: args[i + 1] });
  }
  const results = anonymizeDumps(pairs.map(({ input }) => JSON.parse(fs.readFileSync(input, 'utf8'))));
  pairs.forEach(({ output }, i) => {
    writeJson(output, results[i]);
    console.log(`Wrote ${output}`);
  });
  return 0;
}

module.exports = {
  ...anonymize,
  writeJson,
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
