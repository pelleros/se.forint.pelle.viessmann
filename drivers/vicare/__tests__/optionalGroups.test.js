/* eslint-env jest */

'use strict';

// Optional groups of values behind device settings (optionalGroups.js): off by default, turning
// one on adds its capabilities, turning it off removes exactly those again.

const fs = require('fs');
const path = require('path');

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const ViessmannDevice = require('../device');
const { FEATURES } = require('../config');
const { GROUPS, isGroupSetting, enabledGroups } = require('../optionalGroups');
const { featureMapper } = require('../featureMapper');
const driverCompose = require('../driver.compose.json');

const FIXTURES_DIR = path.join(__dirname, '../../../test/fixtures');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8'));
const HEAT_PUMP = fixture('vitocal_222_features.json');
const HEAT_PUMP_ROLES = ['type:heating;integrated', 'type:dhw;integrated', 'type:heatpump'];

const DIAGNOSTIC_ON_HEAT_PUMP = [
  'measure_temperature.hotWaterTop',
  'measure_temperature.compressorInlet',
  'measure_temperature.compressorOutlet',
  'measure_temperature.compressorAmbient',
];

// Every capability released up to 1.0.16: these are never put in a group
const SHIPPED_1016 = [
  'measure_burner_active', 'measure_burner_number.burnerHours', 'measure_burner_number.burnerModulation',
  'measure_burner_number.burnerStarts', 'measure_compressor_active', 'measure_compressor_number.compressorHours',
  'measure_compressor_number.compressorModulation', 'measure_compressor_number.compressorStarts', 'measure_cop_number.dhw',
  'measure_cop_number.heating', 'measure_cop_number.total', 'measure_fuelcell_number.operationHours',
  'measure_fuelcell_number.productionHours', 'measure_fuelcell_number.productionStarts', 'measure_fuelcell_phase',
  'measure_temperature.boilerCommonSupply', 'measure_temperature.boiler_main', 'measure_temperature.buffer',
  'measure_temperature.circuit0', 'measure_temperature.circuit0_room', 'measure_temperature.circuit0_supply',
  'measure_temperature.fuelCellReturn', 'measure_temperature.fuelCellSupply', 'measure_temperature.hotWater',
  'measure_temperature.outside', 'measure_temperature.primaryReturn', 'measure_temperature.return',
  'measure_temperature.secondarySupply', 'measure_temperature.supply', 'target_temperature.heating',
  'target_temperature.hotWater', 'target_temperature.hotWater2', 'thermostat_mode.fuelCell', 'thermostat_mode.heating',
  'thermostat_mode.hotWaterOneTimeCharge',
];

const flatSettings = (settings) => settings.flatMap((setting) => (setting.type === 'group' ? flatSettings(setting.children) : [setting]));

async function heatPump(settings = {}) {
  const device = new ViessmannDevice();
  device.driver = { getTriggerCard: jest.fn(() => null) };
  device._roles = HEAT_PUMP_ROLES;
  device._features = HEAT_PUMP.data.filter((feature) => feature.isEnabled).map((feature) => feature.feature);
  device.__settings = { heatingCircuit: 'auto', ...settings };
  device.oAuth2Client = { getFeatures: jest.fn() };
  await device.initializeCapabilities();
  return device;
}

describe('the groups and their settings', () => {
  test('every group has a checkbox setting with its default in driver.compose.json', () => {
    const settings = flatSettings(driverCompose.settings);
    for (const group of Object.values(GROUPS)) {
      const setting = settings.find((candidate) => candidate.id === group.setting);
      expect(setting).toEqual(expect.objectContaining({ type: 'checkbox', value: group.enabledByDefault }));
      // The hint says plainly that turning it off removes the values with their history
      expect(setting.hint.en).toMatch(/removes .* history/);
      expect(Object.keys(setting.hint).sort()).toEqual(['de', 'en', 'fr', 'nl', 'sv']);
    }
  });

  test('the diagnostic group is off by default', () => {
    expect(GROUPS.diagnostic).toEqual({ setting: 'diagnosticValues', enabledByDefault: false });
    expect(enabledGroups({})).toEqual([]);
    expect(enabledGroups({ diagnosticValues: true })).toEqual(['diagnostic']);
    expect(enabledGroups((key) => (key === 'diagnosticValues' ? true : undefined))).toEqual(['diagnostic']);
    // A setting a device does not have yet, or an odd value, counts as the default
    expect(enabledGroups({ diagnosticValues: null })).toEqual([]);
    expect(enabledGroups(undefined)).toEqual([]);
  });

  test('isGroupSetting knows the group settings only', () => {
    expect(isGroupSetting('diagnosticValues')).toBe(true);
    expect(isGroupSetting('heatingCircuit')).toBe(false);
  });

  test('only features new in 2.0.0 are in a group, never one that devices already had', () => {
    const grouped = Object.entries(FEATURES).filter(([, feature]) => feature.group);
    expect(grouped.length).toBeGreaterThan(0);
    for (const [, feature] of grouped) {
      for (const { capabilityName } of feature.capabilities) expect(SHIPPED_1016).not.toContain(capabilityName);
      expect(Object.keys(GROUPS)).toContain(feature.group);
    }
  });

  test('capabilitiesFor leaves out the features of groups that are off', () => {
    const stored = Object.keys(FEATURES);
    const names = (groups) => featureMapper.capabilitiesFor(stored, HEAT_PUMP_ROLES, groups).map(({ capability }) => capability.capabilityName);
    expect(names([])).not.toContain('measure_temperature.compressorInlet');
    expect(names(['diagnostic'])).toContain('measure_temperature.compressorInlet');
  });
});

describe('a device', () => {
  test('gets no diagnostic values by default', async () => {
    const device = await heatPump();
    for (const id of DIAGNOSTIC_ON_HEAT_PUMP) expect(device.hasCapability(id)).toBe(false);
    expect(device.hasCapability('measure_pump_active.circuit0')).toBe(true);
  });

  test('gets them on start when the setting is on', async () => {
    const device = await heatPump({ diagnosticValues: true });
    for (const id of DIAGNOSTIC_ON_HEAT_PUMP) expect(device.hasCapability(id)).toBe(true);
  });

  test('turning the setting on adds the group, turning it off removes exactly the group', async () => {
    const device = await heatPump();
    const before = device.getCapabilities();

    await device.onSettings({ newSettings: { heatingCircuit: 'auto', diagnosticValues: true }, changedKeys: ['diagnosticValues'] });
    expect(device.getCapabilities()).toEqual([...before, ...DIAGNOSTIC_ON_HEAT_PUMP]);
    // No API call: the stored feature list says what the device has
    expect(device.oAuth2Client.getFeatures).not.toHaveBeenCalled();

    await device.onSettings({ newSettings: { heatingCircuit: 'auto', diagnosticValues: false }, changedKeys: ['diagnosticValues'] });
    expect(device.getCapabilities()).toEqual(before);
    expect(device.removeCapability.mock.calls.map(([id]) => id).sort()).toEqual([...DIAGNOSTIC_ON_HEAT_PUMP].sort());
  });

  test('other settings leave the groups alone', async () => {
    const device = await heatPump({ diagnosticValues: true });
    const before = device.getCapabilities();
    await device.onSettings({ newSettings: { heatingCircuit: 'auto', diagnosticValues: true, other: 1 }, changedKeys: ['other'] });
    expect(device.getCapabilities()).toEqual(before);
  });
});
