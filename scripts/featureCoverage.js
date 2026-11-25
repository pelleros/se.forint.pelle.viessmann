/*
 *
 *  Copyright (C) 2024 Per Rosengren
 *  This file is part of se.forint.pelle.viessmann project.
 *
 *  se.forint.pelle.viessmann project is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  se.forint.pelle.viessmann project is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with se.forint.pelle.viessmann project.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

/* eslint-disable no-console */

'use strict';

/*
 * Feature coverage report, used to refresh docs/DATAPOINTS.md.
 *
 * Reads Viessmann feature dumps (the JSON returned by the features endpoint, `{ "data": [...] }`)
 * and lists every feature that is usable in at least one dump but not mapped in
 * drivers/vicare/config.js. "Usable" means: isEnabled, not flagged deprecated, status not
 * "notConnected", and at least one property. A feature flagged deprecated in any dump (or in the
 * official list) is never listed.
 *
 * Usage:
 *   node scripts/featureCoverage.js [<dir-or-file>...] [--official <datapoints.json>] [--no-official]
 *                                   [--exact] [--all] [--json]
 *
 *   <dir>          scanned recursively for files named *_features.json
 *   <file>         used as given, whatever its name
 *                  Without inputs, the anonymized fixtures in test/fixtures/ are used. Raw dumps
 *                  (e.g. the untracked documentation/json-example-files/) can be passed instead
 *                  or in addition.
 *   --official     Viessmann's datapoint list ({ "features": [{ feature, plans, deprecated }] });
 *                  adds the plan column and treats officially deprecated features as deprecated.
 *                  Default: the newest documentation/viessmann-datapoints-*.json, if present.
 *   --no-official  do not use an official list
 *   --exact        compare exact feature names (default: indexes are normalised to N, so
 *                  heating.circuits.1.x and heating.circuits.0.x are one row)
 *   --all          also list features that are already mapped
 *   --json         machine-readable output
 *
 * Only feature names are printed, never property values, so the output is safe to share.
 * No dependencies; plain Node.
 */

const fs = require('fs');
const path = require('path');
const { PATHS } = require('../drivers/vicare/config');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_INPUT = path.join(REPO_ROOT, 'test', 'fixtures');
const LOCAL_DOCUMENTATION = path.join(REPO_ROOT, 'documentation');

const USAGE = 'Usage: node scripts/featureCoverage.js [<dir-or-file>...] [--official <datapoints.json>] '
  + '[--no-official] [--exact] [--all] [--json]';

const normalise = (feature) => feature.replace(/\.(\d+)(?=\.|$)/g, '.N');

function parseArgs(argv) {
  const args = {
    inputs: [], official: null, noOfficial: false, exact: false, all: false, json: false, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--official') args.official = argv[++i];
    else if (arg === '--no-official') args.noOfficial = true;
    else if (arg === '--exact') args.exact = true;
    else if (arg === '--all') args.all = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}\n${USAGE}`);
    else args.inputs.push(arg);
  }
  return args;
}

function collectFiles(inputs) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('_features.json')) files.push(full);
    }
  };
  for (const input of inputs) {
    if (fs.statSync(input).isDirectory()) walk(input);
    else files.push(input);
  }
  return files.sort();
}

function loadDumps(files) {
  return files.map((file) => {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const features = Array.isArray(json) ? json : json.data;
    if (!Array.isArray(features)) throw new Error(`${file}: expected { "data": [...] } or an array`);
    return { file: path.relative(process.cwd(), file), features };
  });
}

// The newest local copy of Viessmann's datapoint list, if there is one (documentation/ is untracked).
function findOfficialList() {
  if (!fs.existsSync(LOCAL_DOCUMENTATION)) return null;
  const candidates = fs.readdirSync(LOCAL_DOCUMENTATION)
    .filter((name) => /^viessmann-datapoints-.*\.json$/.test(name))
    .sort();
  return candidates.length > 0 ? path.join(LOCAL_DOCUMENTATION, candidates[candidates.length - 1]) : null;
}

// One letter per dump: x usable, d deprecated, n notConnected, - disabled, e enabled but empty, . absent
function stateOf(feature) {
  if (feature.deprecated) return 'd';
  if (!feature.isEnabled) return '-';
  if (feature.properties?.status?.value === 'notConnected') return 'n';
  if (!feature.properties || Object.keys(feature.properties).length === 0) return 'e';
  return 'x';
}

const RANK = {
  x: 5, d: 4, n: 3, e: 2, '-': 1, '.': 0,
};

/**
 * @param {{ file: string, features: object[] }[]} dumps
 * @param {object} [options]
 * @param {object[]|null} [options.officialFeatures] entries of Viessmann's datapoint list
 * @param {boolean} [options.exact] compare exact names instead of normalising indexes to N
 * @param {boolean} [options.all] also return mapped features
 * @param {string[]} [options.mappedPaths] defaults to the PATHS of drivers/vicare/config.js
 */
function analyse(dumps, options = {}) {
  const {
    officialFeatures = null, exact = false, all = false, mappedPaths = Object.values(PATHS),
  } = options;
  const key = exact ? (feature) => feature : normalise;

  const official = {};
  for (const entry of officialFeatures || []) official[key(entry.feature)] = entry;

  const mapped = new Set(mappedPaths.map(key));
  const ids = dumps.map((dump, index) => `D${index + 1}`);

  // rows[featureKey] = { states: { D1: 'x', ... }, deprecated: bool }
  const rows = {};
  dumps.forEach((dump, index) => {
    const id = ids[index];
    for (const feature of dump.features) {
      const k = key(feature.feature);
      rows[k] = rows[k] || { states: {}, deprecated: false };
      const state = stateOf(feature);
      const previous = rows[k].states[id] || '.';
      if (RANK[state] > RANK[previous]) rows[k].states[id] = state;
      if (feature.deprecated) rows[k].deprecated = true;
    }
  });
  for (const [k, row] of Object.entries(rows)) {
    if (official[k]?.deprecated) row.deprecated = true;
  }

  const features = Object.entries(rows)
    .map(([feature, row]) => ({
      feature,
      mapped: mapped.has(feature),
      deprecated: row.deprecated,
      usableIn: ids.filter((id) => row.states[id] === 'x'),
      states: ids.map((id) => row.states[id] || '.').join(''),
      plans: official[feature]?.plans || null,
      inOfficialList: officialFeatures ? Boolean(official[feature]) : null,
    }))
    .filter((r) => r.usableIn.length > 0 && !r.deprecated && (all || !r.mapped))
    .sort((a, b) => b.usableIn.length - a.usableIn.length || a.feature.localeCompare(b.feature));

  const perDump = dumps.map((dump, index) => {
    const id = ids[index];
    const usable = Object.entries(rows).filter(([, row]) => row.states[id] === 'x' && !row.deprecated);
    const unmapped = usable.filter(([feature]) => !mapped.has(feature));
    return {
      id, file: dump.file, usable: usable.length, mapped: usable.length - unmapped.length, unmapped: unmapped.length,
    };
  });

  const deprecatedMapped = [...mapped].filter((feature) => rows[feature]?.deprecated);

  return { dumps: perDump, features, deprecatedMapped };
}

function printReport(report, { all, officialFile }) {
  console.log(`Official list: ${officialFile ? path.relative(process.cwd(), officialFile) : 'none'}`);
  console.log('');
  console.log('Dumps');
  for (const d of report.dumps) {
    console.log(`  ${d.id}  usable ${String(d.usable).padStart(3)}  mapped ${String(d.mapped).padStart(3)}  unmapped ${String(d.unmapped).padStart(3)}  ${d.file}`);
  }
  console.log('');
  console.log(`States per dump (${report.dumps.map((d) => d.id).join(' ')}): x usable, d deprecated, n notConnected, - disabled, e empty, . absent`);
  console.log('');
  const planText = (plans) => (plans ? plans.map((p) => p.replace(/^(View|Control) (Basic|Advanced).*$/, '$1 $2')).join(', ') : '');
  const width = Math.max(...report.features.map((r) => r.feature.length), 10);
  for (const r of report.features) {
    const flags = [
      r.mapped ? 'mapped' : '',
      r.inOfficialList === false ? 'not in official list' : '',
      planText(r.plans),
    ].filter(Boolean).join('; ');
    console.log(`  ${r.feature.padEnd(width)}  ${r.states}  ${String(r.usableIn.length).padStart(2)}  ${flags}`);
  }
  console.log('');
  console.log(`${report.features.length} feature(s) listed${all ? '' : ' (usable, not deprecated, not mapped in config.js)'}.`);
  if (report.deprecatedMapped.length > 0) {
    console.log(`WARNING: mapped feature(s) flagged deprecated: ${report.deprecatedMapped.join(', ')}`);
  }
}

function main(argv) {
  try {
    const args = parseArgs(argv);
    if (args.help) {
      console.log(USAGE);
      return 0;
    }

    const files = collectFiles(args.inputs.length > 0 ? args.inputs : [DEFAULT_INPUT]);
    if (files.length === 0) {
      console.error('No feature dumps found.');
      return 1;
    }

    const officialFile = args.noOfficial ? null : (args.official || findOfficialList());
    const officialFeatures = officialFile ? JSON.parse(fs.readFileSync(officialFile, 'utf8')).features : null;

    const report = analyse(loadDumps(files), { officialFeatures, exact: args.exact, all: args.all });
    if (args.json) {
      console.log(JSON.stringify({ officialList: officialFile ? path.relative(process.cwd(), officialFile) : null, ...report }, null, 2));
    } else {
      printReport(report, { all: args.all, officialFile });
    }
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

module.exports = {
  analyse, collectFiles, loadDumps, normalise,
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
