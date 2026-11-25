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
 * Review the output (and run `npm test`, which includes the privacy check) before committing.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { Anonymizer, writeJson } = require('./anonymizeDump');

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

function main([sourceDir = path.join(__dirname, '../documentation/json-example-files'), outputDir = path.join(__dirname, '../test/fixtures')]) {
  const raw = new Map();
  const load = (file) => {
    if (!raw.has(file)) {
      const fullPath = path.join(sourceDir, file);
      if (!fs.existsSync(fullPath)) throw new Error(`Missing raw dump: ${fullPath}`);
      raw.set(file, JSON.parse(fs.readFileSync(fullPath, 'utf8')));
    }
    return raw.get(file);
  };
  const sources = FIXTURES.flatMap(({ features, installations }) => [features, installations].filter(Boolean));
  sources.forEach(load);

  const anonymizer = new Anonymizer();
  // First pass collects every identifier, so the safety net is complete in the second pass.
  sources.forEach((file) => anonymizer.anonymize(raw.get(file)));

  for (const { name, features, installations } of FIXTURES) {
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
