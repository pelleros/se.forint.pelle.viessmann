/* eslint-env jest */

'use strict';

/*
 * Keeps scripts/featureCoverage.js (used to refresh docs/DATAPOINTS.md) working against the
 * anonymized fixtures and the current drivers/vicare/config.js.
 */

const path = require('path');
const {
  analyse, collectFiles, loadDumps, normalise,
} = require('../scripts/featureCoverage');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

const feature = (name, overrides = {}) => ({
  feature: name,
  isEnabled: true,
  properties: { value: { type: 'number', value: 1 } },
  commands: {},
  ...overrides,
});

describe('featureCoverage', () => {
  describe('on test/fixtures', () => {
    const files = collectFiles([FIXTURES_DIR]);
    const report = analyse(loadDumps(files));
    const listed = report.features.map((r) => r.feature);

    it('reads every features fixture and skips the installations files', () => {
      expect(files.length).toBeGreaterThan(0);
      expect(files.every((file) => file.endsWith('_features.json'))).toBe(true);
      expect(report.dumps).toHaveLength(files.length);
    });

    it('lists usable features that config.js does not map', () => {
      expect(listed).toContain('heating.circuits.N.circulation.pump');
      expect(report.features.every((r) => !r.mapped && !r.deprecated && r.usableIn.length > 0)).toBe(true);
    });

    it('leaves out mapped features unless asked for all', () => {
      expect(listed).not.toContain('heating.dhw.sensors.temperature.dhwCylinder');
      const all = analyse(loadDumps(files), { all: true });
      const row = all.features.find((r) => r.feature === 'heating.dhw.sensors.temperature.dhwCylinder');
      expect(row).toMatchObject({ mapped: true });
    });
  });

  describe('rules', () => {
    const dumps = [
      {
        file: 'a',
        features: [
          feature('heating.example.usable'),
          feature('heating.example.deprecatedElsewhere'),
          feature('heating.example.notConnected', { properties: { status: { type: 'string', value: 'notConnected' } } }),
          feature('heating.example.disabled', { isEnabled: false }),
          feature('heating.example.officiallyDeprecated'),
          feature('heating.circuits.0.example'),
        ],
      },
      {
        file: 'b',
        features: [
          feature('heating.example.deprecatedElsewhere', { deprecated: { removalDate: '2024-09-15', info: 'replaced' } }),
          feature('heating.circuits.1.example'),
        ],
      },
    ];
    const officialFeatures = [
      { feature: 'heating.example.officiallyDeprecated', plans: ['View Basic Feature Data'], deprecated: true },
      { feature: 'heating.example.usable', plans: ['View Basic Feature Data'], deprecated: false },
    ];

    it('lists only features that are usable somewhere and deprecated nowhere', () => {
      const report = analyse(dumps, { officialFeatures, mappedPaths: [] });
      expect(report.features.map((r) => r.feature).sort()).toEqual(['heating.circuits.N.example', 'heating.example.usable']);
      expect(report.features.find((r) => r.feature === 'heating.example.usable')).toMatchObject({
        states: 'x.', plans: ['View Basic Feature Data'], inOfficialList: true,
      });
    });

    it('merges indexes by default and keeps them apart with exact', () => {
      expect(normalise('heating.circuits.1.operating.programs.active')).toBe('heating.circuits.N.operating.programs.active');
      const exact = analyse(dumps, { exact: true, mappedPaths: [] }).features.map((r) => r.feature);
      expect(exact).toEqual(expect.arrayContaining(['heating.circuits.0.example', 'heating.circuits.1.example']));
    });

    it('reports mapped paths that are flagged deprecated', () => {
      const report = analyse(dumps, { mappedPaths: ['heating.example.deprecatedElsewhere'] });
      expect(report.deprecatedMapped).toEqual(['heating.example.deprecatedElsewhere']);
    });
  });
});
