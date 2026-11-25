/* eslint-env jest */

'use strict';

// A device paired on 1.0.14 already has the "running" and statistics capabilities, with the
// options 1.0.14 gave them: "Yes"/"No" on the timeline, English-only state texts and no
// Insights for the counters. Options only reach such a device through updateCapabilityOptions(),
// which runs on every start: these tests check that it gets the current options from config.js,
// without re-pairing and without losing a capability.

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const ViessmannDriver = require('../driver');
const ViessmannDevice = require('../device');
const { getCapabilityOptions } = require('../config');
const { loadPyViCareFixtures, identityOf } = require('../../../test/helpers/pyvicareFixtures');
const { pairedStore1014, capabilitiesFor1014, respond } = require('../../../test/helpers/upgradeFrom1014');

const clone = (value) => JSON.parse(JSON.stringify(value));

// The options 1.0.14 set on these capabilities (drivers/vicare/config.js in 1.0.14)
const COUNTER_1014 = { preventInsights: true, preventTag: true };
const OPTIONS_1014 = Object.freeze({
  measure_compressor_active: {
    title: { en: 'Compressor running' }, preventInsights: false, preventTag: false,
  },
  measure_burner_active: {
    title: { en: 'Burner running' },
    titleTrue: { en: 'Yes' },
    titleFalse: { en: 'No' },
    insightsTitleTrue: { en: 'Yes' },
    insightsTitleFalse: { en: 'No' },
    preventInsights: false,
    preventTag: false,
  },
  'measure_compressor_number.compressorHours': { title: { en: 'Compressor runtime' }, units: 'hours', ...COUNTER_1014 },
  'measure_compressor_number.compressorStarts': { title: { en: 'Compressor starts' }, units: 'times', ...COUNTER_1014 },
  'measure_burner_number.burnerHours': { title: { en: 'Burner runtime' }, units: 'hours', ...COUNTER_1014 },
  'measure_burner_number.burnerStarts': { title: { en: 'Burner starts' }, units: 'times', ...COUNTER_1014 },
  'measure_fuelcell_number.operationHours': { title: { en: 'Fuel cell operation hours' }, units: 'hours', ...COUNTER_1014 },
  'measure_fuelcell_number.productionHours': { title: { en: 'Fuel cell production hours' }, units: 'hours', ...COUNTER_1014 },
  'measure_fuelcell_number.productionStarts': { title: { en: 'Fuel cell starts' }, units: 'times', ...COUNTER_1014 },
});

const RUNNING = ['measure_compressor_active', 'measure_burner_active'];
const COUNTERS = Object.keys(OPTIONS_1014).filter((id) => !RUNNING.includes(id));

// PyViCare responses that between them have every capability above
const SCENARIOS = {
  'Vitocaldens222F.json': [
    'measure_compressor_active',
    'measure_compressor_number.compressorHours',
    'measure_compressor_number.compressorStarts',
    'measure_burner_active',
    'measure_burner_number.burnerHours',
    'measure_burner_number.burnerStarts',
  ],
  'VitovalorPT2.json': [
    'measure_burner_active',
    'measure_burner_number.burnerHours',
    'measure_burner_number.burnerStarts',
    'measure_fuelcell_number.operationHours',
    'measure_fuelcell_number.productionHours',
    'measure_fuelcell_number.productionStarts',
  ],
};

const fixtures = loadPyViCareFixtures();

// A device as 1.0.14 left it: paired from the response, with the capabilities 1.0.14 added and
// the options 1.0.14 set on them
function deviceFrom1014(dump) {
  const identity = identityOf(dump);
  const store = { ...identity, ...pairedStore1014(dump), version: '1.0.14' };
  const device = new ViessmannDevice();
  device.driver = new ViessmannDriver();
  device.__store = clone(store);
  device.__data = { id: `${identity.installationId}-${identity.gatewaySerial}-${identity.deviceId}` };
  device.__settings = { heatingCircuit: 'auto' };
  for (const id of capabilitiesFor1014(store)) {
    device.__values.set(id, null);
    if (OPTIONS_1014[id]) device.__options.set(id, clone(OPTIONS_1014[id]));
  }
  device.oAuth2Client = {
    getFeatures: jest.fn(async ({ filter }) => respond(dump, filter)),
    executeCommand: jest.fn(async () => ({ data: { success: true } })),
  };
  return device;
}

beforeEach(() => {
  jest.spyOn(Math, 'random').mockReturnValue(0.5); // regular (filtered) polls only
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('the 1.0.14 options cover every running and statistics capability', () => {
  expect(Object.values(SCENARIOS).flat().sort()).toEqual(expect.arrayContaining(Object.keys(OPTIONS_1014)));
});

test('every option 1.0.14 set is set again, so no old value stays behind if Homey merges options', () => {
  for (const [id, before] of Object.entries(OPTIONS_1014)) {
    expect(Object.keys(getCapabilityOptions(id))).toEqual(expect.arrayContaining(Object.keys(before)));
  }
});

describe.each(Object.entries(SCENARIOS))('a device paired on 1.0.14 from PyViCare %s', (name, capabilities) => {
  const { dump } = fixtures.find((fixture) => fixture.name === name);

  test('had the capabilities, with the 1.0.14 options', () => {
    const device = deviceFrom1014(dump);
    for (const id of capabilities) {
      expect(device.hasCapability(id)).toBe(true);
      expect(device.getCapabilityOptions(id)).toEqual(OPTIONS_1014[id]);
    }
  });

  test('updateCapabilityOptions() gives the existing capabilities the current options', async () => {
    const device = deviceFrom1014(dump);

    await device.updateCapabilityOptions();

    for (const id of capabilities) {
      expect(device.setCapabilityOptions).toHaveBeenCalledWith(id, getCapabilityOptions(id));
      expect(device.getCapabilityOptions(id)).toEqual(getCapabilityOptions(id));
    }
  });

  test('on its first start: translated state texts, Insights for the counters, nothing removed', async () => {
    const device = deviceFrom1014(dump);
    const capabilitiesBefore = device.getCapabilities();

    await device.onOAuth2Init();

    expect(device.removeCapability).not.toHaveBeenCalled();
    expect(device.getCapabilities()).toEqual(expect.arrayContaining(capabilitiesBefore));
    for (const id of capabilities) {
      // Already there: the options come from updateCapabilityOptions(), not from adding it
      expect(device.addCapability).not.toHaveBeenCalledWith(id);
      expect(device.getCapabilityOptions(id)).toEqual(getCapabilityOptions(id));
    }
    for (const id of capabilities.filter((capability) => RUNNING.includes(capability))) {
      const options = device.getCapabilityOptions(id);
      expect(options.insightsTitleTrue.en).toMatch(/ started$/);
      expect(options.insightsTitleFalse.en).toMatch(/ stopped$/);
      expect(Object.keys(options.insightsTitleTrue).sort()).toEqual(['de', 'en', 'fr', 'nl', 'sv']);
      expect(options.titleTrue.de).toBe('Ja');
    }
    for (const id of capabilities.filter((capability) => COUNTERS.includes(capability))) {
      const options = device.getCapabilityOptions(id);
      expect(options.preventInsights).toBe(false);
      expect(options.preventTag).toBe(true);
      expect(['hours', 'times']).not.toContain(options.units);
    }
  });
});
