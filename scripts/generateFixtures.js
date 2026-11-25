/* eslint-disable no-console */

/*
 * Regenerate the anonymized fixtures in test/fixtures/ from raw Viessmann API dumps.
 *
 * Usage:
 *   node scripts/generateFixtures.js [sourceDir] [outputDir]
 *
 * sourceDir defaults to documentation/json-example-files (local only, never committed) and
 * outputDir to test/fixtures. All dumps go through one shared Anonymizer, so a features fixture
 * and the installations fixture of the same installation use the same fake ids. Installations
 * dumps that contain several installations are reduced to the installation that the paired
 * features dump belongs to.
 *
 * Most raw dumps from other users' installations are deleted on purpose once their fixtures
 * exist. When a raw dump of a fixture is missing, the committed fixture is kept as it is and a
 * note is printed. The fake values the kept fixtures use are reserved, so a regenerated or new
 * fixture never reuses them for another installation.
 *
 * Review the output (and run `npm test`, which includes the privacy check) before committing.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { Anonymizer, FAKE_PATTERNS } = require('../lib/anonymize');
const { writeJson } = require('./anonymizeDump');

const OLD = 'before api endpoint change';

// name -> raw source files (relative to sourceDir). The fixture files are <name>_features.json
// and <name>_installations.json.
const FIXTURES = [
  {
    name: 'vitocal_222',
    features: 'vitocal_222_2026-11-25_features.json',
    installations: 'vitocal_222_2026-11-25_installations.json',
  },
  { name: 'vitocal_222_2024', features: `${OLD}/vitocal_222_features.json` },
  {
    name: 'vitodens_200_e3',
    features: `${OLD}/vitodens_200_e3_features.json`,
    installations: `${OLD}/vitodens_200_e3_installations.json`,
  },
  {
    name: 'vitodens_200_2016',
    features: `${OLD}/vitodens_200_2016_features.json`,
    installations: `${OLD}/vitodens_200_2016_installations.json`,
  },
  {
    name: 'vitodens_200_dh',
    features: `${OLD}/vitodens_200_DH_features.json`,
    installations: `${OLD}/vitodens_200_Vitovalor_PT2_installations.json`,
  },
  {
    name: 'vitovalor_pt2',
    features: `${OLD}/vitovalor_PT2_features.json`,
    installations: `${OLD}/vitodens_200_Vitovalor_PT2_installations.json`,
  },
];

function installationIdsInFeatures(featuresDump) {
  const ids = new Set();
  for (const feature of featuresDump.data) {
    const match = /\/installations\/([^/]+)\//.exec(feature.uri || '');
    if (match) ids.add(match[1]);
  }
  return ids;
}

function onlyInstallations(installationsDump, ids) {
  const belongs = (installation) => ids.has(String(installation.id))
    || (installation.gateways || []).some((gateway) => ids.has(String(gateway.installationId)));
  if (Array.isArray(installationsDump)) return installationsDump.filter(belongs);
  return { ...installationsDump, data: installationsDump.data.filter(belongs) };
}

// Every fake value in a fixture (also inside URIs), so a new mapping can avoid handing it out again.
function fakeValuesIn(fixture) {
  const values = new Set();
  const visit = (node) => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === 'object') Object.values(node).forEach(visit);
    else if (typeof node === 'string' || typeof node === 'number') {
      for (const token of [String(node), ...String(node).split('/')]) {
        if (Object.values(FAKE_PATTERNS).some((pattern) => pattern.test(token))) values.add(token);
      }
    }
  };
  visit(fixture);
  return values;
}

function main([sourceDir = path.join(__dirname, '../documentation/json-example-files'), outputDir = path.join(__dirname, '../test/fixtures')]) {
  const raw = new Map();
  for (const file of FIXTURES.flatMap(({ features, installations }) => [features, installations].filter(Boolean))) {
    const fullPath = path.join(sourceDir, file);
    if (!raw.has(file) && fs.existsSync(fullPath)) raw.set(file, JSON.parse(fs.readFileSync(fullPath, 'utf8')));
  }

  // A fixture is regenerated only when all of its raw dumps are there; otherwise it is kept.
  const regenerate = [];
  const reserved = new Set();
  for (const fixture of FIXTURES) {
    const missing = [fixture.features, fixture.installations].filter((file) => file && !raw.has(file));
    if (missing.length === 0) {
      regenerate.push(fixture);
      continue;
    }
    const kept = [`${fixture.name}_features.json`, fixture.installations && `${fixture.name}_installations.json`]
      .filter(Boolean)
      .filter((file) => fs.existsSync(path.join(outputDir, file)));
    const what = kept.length > 0 ? `keeping ${kept.join(' and ')}` : `skipping ${fixture.name} (no committed fixture either)`;
    console.log(`Note: ${what}, raw dump not in ${sourceDir}: ${missing.join(', ')}`);
    for (const file of kept) {
      fakeValuesIn(JSON.parse(fs.readFileSync(path.join(outputDir, file), 'utf8'))).forEach((value) => reserved.add(value));
    }
  }

  const sources = [...new Set(regenerate.flatMap(({ features, installations }) => [features, installations].filter(Boolean)))];
  const anonymizer = new Anonymizer({ reserved });
  // First pass collects every identifier, so the safety net is complete in the second pass.
  sources.forEach((file) => anonymizer.anonymize(raw.get(file)));

  for (const { name, features, installations } of regenerate) {
    const featuresOut = anonymizer.anonymize(raw.get(features));
    writeJson(path.join(outputDir, `${name}_features.json`), featuresOut);
    console.log(`Wrote ${name}_features.json`);
    if (installations) {
      const installationsOut = onlyInstallations(anonymizer.anonymize(raw.get(installations)), installationIdsInFeatures(featuresOut));
      writeJson(path.join(outputDir, `${name}_installations.json`), installationsOut);
      console.log(`Wrote ${name}_installations.json`);
    }
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
