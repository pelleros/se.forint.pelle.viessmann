'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { FAKE_PATTERNS } = require('../lib/anonymize');

const SCRIPT = path.join(__dirname, '../scripts/generateFixtures.js');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

// Synthetic raw dumps for the first fixture only; every other raw dump is "missing".
const INSTALLATION_ID = 2345678;
const GATEWAY_SERIAL = '7637415022052208';
const BASE = `https://api.viessmann-climatesolutions.com/iot/v2/features/installations/${INSTALLATION_ID}/gateways/${GATEWAY_SERIAL}/devices/0/features`;
const RAW_FEATURES = {
  data: [{
    feature: 'heating.dhw.temperature.main',
    gatewayId: GATEWAY_SERIAL,
    deviceId: '0',
    isEnabled: true,
    uri: `${BASE}/heating.dhw.temperature.main`,
    properties: { value: { type: 'number', value: 50, unit: 'celsius' } },
    commands: {},
  }],
};
const RAW_INSTALLATIONS = {
  data: [{
    id: INSTALLATION_ID,
    address: { street: 'Example Street' },
    gateways: [{ serial: GATEWAY_SERIAL, installationId: INSTALLATION_ID, devices: [{ gatewaySerial: GATEWAY_SERIAL, id: '0', deviceType: 'heating' }] }],
  }],
};

function fakeValues(text) {
  return new Set((text.match(/[\w-]+/g) || []).filter((token) => Object.values(FAKE_PATTERNS).some((pattern) => pattern.test(token))));
}

describe('generateFixtures with missing raw dumps', () => {
  let dir;
  let result;
  let sourceDir;
  let outputDir;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'generate-fixtures-'));
    sourceDir = path.join(dir, 'raw');
    outputDir = path.join(dir, 'fixtures');
    fs.mkdirSync(sourceDir);
    fs.cpSync(FIXTURES_DIR, outputDir, { recursive: true });
    fs.rmSync(path.join(outputDir, 'vitodens_200_2016_features.json'));
    fs.rmSync(path.join(outputDir, 'vitodens_200_2016_installations.json'));
    fs.writeFileSync(path.join(sourceDir, 'vitocal_222_2026-11-25_features.json'), JSON.stringify(RAW_FEATURES));
    fs.writeFileSync(path.join(sourceDir, 'vitocal_222_2026-11-25_installations.json'), JSON.stringify(RAW_INSTALLATIONS));
    result = spawnSync(process.execPath, [SCRIPT, sourceDir, outputDir], { encoding: 'utf8' });
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('succeeds and says which fixtures it kept', () => {
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Note: keeping vitocal_222_2024_features.json, raw dump not in');
    expect(result.stdout).toContain('Note: keeping vitovalor_pt2_features.json and vitovalor_pt2_installations.json');
    expect(result.stdout).toContain('Note: skipping vitodens_200_2016 (no committed fixture either)');
    expect(result.stdout).toContain('Wrote vitocal_222_features.json');
  });

  test('leaves the kept fixtures untouched', () => {
    const kept = fs.readdirSync(outputDir).filter((file) => !file.startsWith('vitocal_222_') || file.startsWith('vitocal_222_2024'));
    expect(kept.length).toBeGreaterThan(0);
    for (const file of kept) {
      expect(fs.readFileSync(path.join(outputDir, file), 'utf8')).toBe(fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf8'));
    }
    expect(fs.existsSync(path.join(outputDir, 'vitodens_200_2016_features.json'))).toBe(false);
  });

  test('regenerates the fixtures whose raw dumps are there, without reusing the kept fixtures\' fake values', () => {
    const features = fs.readFileSync(path.join(outputDir, 'vitocal_222_features.json'), 'utf8');
    const installations = fs.readFileSync(path.join(outputDir, 'vitocal_222_installations.json'), 'utf8');
    for (const original of [String(INSTALLATION_ID), GATEWAY_SERIAL, 'Example Street']) {
      expect(features + installations).not.toContain(original);
    }
    expect(JSON.parse(features).data[0].properties).toEqual(RAW_FEATURES.data[0].properties);

    const keptText = fs.readdirSync(outputDir)
      .filter((file) => !['vitocal_222_features.json', 'vitocal_222_installations.json'].includes(file))
      .map((file) => fs.readFileSync(path.join(outputDir, file), 'utf8'))
      .join('\n');
    const reused = [...fakeValues(features + installations)].filter((value) => fakeValues(keptText).has(value));
    expect(reused).toEqual([]);
    expect(String(JSON.parse(installations).data[0].id)).toMatch(FAKE_PATTERNS.installationId);
  });
});
