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
 * "notConnected", and at least one property.
 *
 * Usage:
 *   node scripts/featureCoverage.js <dir-or-file>... [--official <datapoints.json>] [--exact] [--all] [--json]
 *
 *   <dir>       scanned recursively for files named *_features.json
 *   <file>      used as given, whatever its name
 *   --official  Viessmann's datapoint list ({ "features": [{ feature, plans, deprecated }] });
 *               adds the plan column and treats officially deprecated features as deprecated
 *   --exact     compare exact feature names (default: indexes are normalised to N, so
 *               heating.circuits.1.x and heating.circuits.0.x are one row)
 *   --all       also list features that are already mapped
 *   --json      machine-readable output
 *
 * Only feature names are printed, never property values, so the output is safe to share.
 * No dependencies; plain Node.
 */

const fs = require('fs');
const path = require('path');
const { PATHS } = require('../drivers/vicare/config');

const normalise = (feature) => feature.replace(/\.(\d+)(?=\.|$)/g, '.N');

function parseArgs(argv) {
  const args = {
    inputs: [], official: null, exact: false, all: false, json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--official') args.official = argv[++i];
    else if (arg === '--exact') args.exact = true;
    else if (arg === '--all') args.all = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
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

function featureList(file) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = Array.isArray(json) ? json : json.data;
  if (!Array.isArray(list)) throw new Error(`${file}: expected { "data": [...] } or an array`);
  return list;
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.inputs.length === 0) {
    console.log('Usage: node scripts/featureCoverage.js <dir-or-file>... [--official <datapoints.json>] [--exact] [--all] [--json]');
    process.exit(args.help ? 0 : 1);
  }

  const key = args.exact ? (f) => f : normalise;
  const files = collectFiles(args.inputs);
  if (files.length === 0) {
    console.error('No feature dumps found.');
    process.exit(1);
  }

  const official = {};
  if (args.official) {
    for (const entry of JSON.parse(fs.readFileSync(args.official, 'utf8')).features) {
      official[key(entry.feature)] = entry;
    }
  }

  const mapped = new Set(Object.values(PATHS).map(key));
  const dumps = files.map((file, index) => ({
    id: `D${index + 1}`,
    file: path.relative(process.cwd(), file),
  }));

  // rows[featureKey] = { states: { D1: 'x', ... }, deprecated: bool }
  const rows = {};
  dumps.forEach((dump, index) => {
    for (const feature of featureList(files[index])) {
      const k = key(feature.feature);
      rows[k] = rows[k] || { states: {}, deprecated: false };
      const state = stateOf(feature);
      const previous = rows[k].states[dump.id] || '.';
      if (RANK[state] > RANK[previous]) rows[k].states[dump.id] = state;
      if (feature.deprecated) rows[k].deprecated = true;
    }
  });
  for (const [k, row] of Object.entries(rows)) {
    if (official[k]?.deprecated) row.deprecated = true;
  }

  const result = Object.entries(rows)
    .map(([feature, row]) => ({
      feature,
      mapped: mapped.has(feature),
      deprecated: row.deprecated,
      usableIn: dumps.filter((d) => row.states[d.id] === 'x').map((d) => d.id),
      states: dumps.map((d) => row.states[d.id] || '.').join(''),
      plans: official[feature]?.plans || null,
      inOfficialList: args.official ? Boolean(official[feature]) : null,
    }))
    .filter((r) => r.usableIn.length > 0 && !r.deprecated && (args.all || !r.mapped))
    .sort((a, b) => b.usableIn.length - a.usableIn.length || a.feature.localeCompare(b.feature));

  const perDump = dumps.map((d) => {
    const usable = Object.entries(rows).filter(([, row]) => row.states[d.id] === 'x' && !row.deprecated);
    const unmapped = usable.filter(([feature]) => !mapped.has(feature));
    return {
      ...d, usable: usable.length, mapped: usable.length - unmapped.length, unmapped: unmapped.length,
    };
  });

  const deprecatedMapped = [...mapped].filter((feature) => rows[feature]?.deprecated);

  if (args.json) {
    console.log(JSON.stringify({ dumps: perDump, features: result, deprecatedMapped }, null, 2));
    return;
  }

  console.log('Dumps');
  for (const d of perDump) {
    console.log(`  ${d.id}  usable ${String(d.usable).padStart(3)}  mapped ${String(d.mapped).padStart(3)}  unmapped ${String(d.unmapped).padStart(3)}  ${d.file}`);
  }
  console.log('');
  console.log(`States per dump (${dumps.map((d) => d.id).join(' ')}): x usable, d deprecated, n notConnected, - disabled, e empty, . absent`);
  console.log('');
  const planText = (plans) => (plans ? plans.map((p) => p.replace(/^(View|Control) (Basic|Advanced).*$/, '$1 $2')).join(', ') : '');
  const width = Math.max(...result.map((r) => r.feature.length), 10);
  for (const r of result) {
    const flags = [
      r.mapped ? 'mapped' : '',
      r.inOfficialList === false ? 'not in official list' : '',
      planText(r.plans),
    ].filter(Boolean).join('; ');
    console.log(`  ${r.feature.padEnd(width)}  ${r.states}  ${String(r.usableIn.length).padStart(2)}  ${flags}`);
  }
  console.log('');
  console.log(`${result.length} feature(s) listed${args.all ? '' : ' (usable, not deprecated, not mapped in config.js)'}.`);
  if (deprecatedMapped.length > 0) {
    console.log(`WARNING: mapped feature(s) flagged deprecated: ${deprecatedMapped.join(', ')}`);
  }
}

main();
