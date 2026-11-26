/* eslint-env jest */

'use strict';

// Simulates the update from 1.0.14 for every device response from PyViCare
// (test/fixtures/pyvicare/), like upgrade.simulation.test.js does for our own fixtures: a device
// paired on 1.0.14 from the response starts on this version against the same installation.
// Nothing may be removed, every capability ID must be a registered one, the device must reach
// polling even when the upgrade refresh fails, and it must work on a heating circuit that the
// installation reports.

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const { PATHS } = require('../config');
const { resolveCircuitPath } = require('../heatingCircuit');
const registry = require('./registry.json');
const { loadPyViCareFixtures, identityOf } = require('../../../test/helpers/pyvicareFixtures');
const {
  capabilitiesFor, respond, upgradeFrom1014, filteredPolls,
} = require('../../../test/helpers/upgradeFrom1014');

const fixtures = loadPyViCareFixtures();

// Capabilities of features mapped after 1.0.14 (COP, compressor load, top buffer sensor as a
// fallback), with the values these responses report
const ADDED_SINCE_1014 = {
  'Ecotronic.json': { 'measure_temperature.buffer': 62.1 },
  'Vitocal200S_AWB-M-E-AC-201.D10.json': {
    'measure_cop_number.total': 5.2,
    'measure_cop_number.heating': 5.2,
    'measure_cop_number.dhw': 0,
    'measure_compressor_number.compressorModulation': 0,
  },
  'Vitocal300G_CU401B.json': {
    'measure_cop_number.total': 4.7,
    'measure_cop_number.heating': 4.8,
    'measure_cop_number.dhw': 4,
    'measure_compressor_number.compressorModulation': 100,
  },
  'Vitocal333G-with-Vitovent300F.json': {
    'measure_cop_number.total': 5.3,
    'measure_cop_number.heating': 5.4,
    'measure_cop_number.dhw': 4.8,
  },
};

// The heating circuits the installation reports: the enabled list of `heating.circuits`, or
// else the circuits with an enabled operating mode
function reportedCircuits(dump) {
  const circuits = dump.data.find((feature) => feature.feature === 'heating.circuits' && feature.isEnabled);
  const enabled = circuits?.properties?.enabled?.value;
  if (Array.isArray(enabled)) return enabled.map(String);
  return dump.data
    .filter((feature) => feature.isEnabled)
    .map((feature) => feature.feature.match(/^heating\.circuits\.(\d+)\.operating\.modes\.active$/)?.[1])
    .filter((id) => id !== undefined);
}

const featureOf = (dump, name) => dump.data.find((feature) => feature.feature === name);

beforeEach(() => {
  jest.spyOn(Math, 'random').mockReturnValue(0.5); // regular (filtered) polls only
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('test/fixtures/pyvicare provides responses with one and with several heating circuits', () => {
  const counts = fixtures.map(({ dump }) => reportedCircuits(dump).length);
  expect(counts).toContain(1);
  expect(counts.some((count) => count > 1)).toBe(true);
});

describe.each(Object.entries(ADDED_SINCE_1014))('upgrade from 1.0.14: PyViCare %s gets capabilities mapped since', (name, added) => {
  const { dump } = fixtures.find((fixture) => fixture.name === name);

  test.each([
    ['the refresh succeeds', false],
    ['the refresh call throws', true],
  ])('when %s: they are added with the reported values, and nothing is removed', async (_, refreshFails) => {
    const { device, capabilitiesBefore } = await upgradeFrom1014({ identity: identityOf(dump), before: dump, refreshFails });

    Object.keys(added).forEach((id) => expect(capabilitiesBefore).not.toContain(id));
    expect(device.removeCapability).not.toHaveBeenCalled();
    expect(device.getCapabilities()).toEqual(expect.arrayContaining([...capabilitiesBefore, ...Object.keys(added)]));
    for (const [id, value] of Object.entries(added)) expect(device.getCapabilityValue(id)).toBe(value);
  });
});

// A hot water heat pump whose roles say type:dhwHeatpump instead of type:heatpump: 1.0.14 gave
// it no compressor capabilities although it reports a compressor and its statistics
describe('upgrade from 1.0.14: PyViCare Vitocal262A_T2H-R290.json (type:dhwHeatpump)', () => {
  const { dump } = fixtures.find((fixture) => fixture.name === 'Vitocal262A_T2H-R290.json');
  const COMPRESSOR = {
    measure_compressor_active: false,
    'measure_compressor_number.compressorHours': 1256,
    'measure_compressor_number.compressorStarts': 330,
  };

  test('reports type:dhwHeatpump, not type:heatpump, and a compressor', () => {
    const { roles } = identityOf(dump);
    expect(roles).toContain('type:dhwHeatpump');
    expect(roles).not.toContain('type:heatpump');
    expect(featureOf(dump, PATHS.COMPRESSOR)?.isEnabled).toBe(true);
    expect(featureOf(dump, PATHS.COMPRESSOR_STATS)?.isEnabled).toBe(true);
  });

  test.each([
    ['the refresh succeeds', false],
    ['the refresh call throws', true],
  ])('when %s: gets measure_compressor_active and the compressor statistics, and nothing is removed', async (_, refreshFails) => {
    const { device, capabilitiesBefore } = await upgradeFrom1014({ identity: identityOf(dump), before: dump, refreshFails });

    Object.keys(COMPRESSOR).forEach((id) => expect(capabilitiesBefore).not.toContain(id));
    expect(device.removeCapability).not.toHaveBeenCalled();
    expect(device.getCapabilities()).toEqual(expect.arrayContaining([...capabilitiesBefore, ...Object.keys(COMPRESSOR)]));
    for (const [id, value] of Object.entries(COMPRESSOR)) expect(device.getCapabilityValue(id)).toBe(value);
  });
});

describe.each(fixtures.map(({ name, dump }) => [name, dump]))('upgrade from 1.0.14: PyViCare %s', (name, dump) => {
  const identity = identityOf(dump);

  test.each([
    ['the refresh succeeds', false],
    ['the refresh call throws', true],
  ])('when %s: nothing is removed, IDs are registered and polling starts', async (_, refreshFails) => {
    const {
      driver, device, store, data, capabilitiesBefore, pollingKey,
    } = await upgradeFrom1014({ identity, before: dump, refreshFails });

    // No capability removed, every ID one that this app has always shipped
    expect(device.removeCapability).not.toHaveBeenCalled();
    const capabilitiesAfter = device.getCapabilities().sort();
    expect(capabilitiesAfter).toEqual(expect.arrayContaining(capabilitiesBefore));
    capabilitiesAfter.forEach((id) => expect(registry.capabilities).toContain(id));
    // Exactly the capabilities of the stored (merged) features
    expect(capabilitiesAfter).toEqual(capabilitiesFor(device.getStore()));

    // Identity and stored features: unchanged or grown
    expect(device.getData()).toEqual(data);
    for (const key of ['installationId', 'gatewaySerial', 'deviceId', 'roles']) {
      expect(device.getStoreValue(key)).toEqual(store[key]);
    }
    expect(device.getStoreValue('features')).toEqual(expect.arrayContaining(store.features));

    // The device polls, is available, and the poll was processed without errors
    expect(driver._devicePollers.has(pollingKey)).toBe(true);
    expect(filteredPolls(device)).toHaveLength(1);
    expect(device.setUnavailable).not.toHaveBeenCalled();
    expect(device.getAvailable()).toBe(true);
    expect(device.error).not.toHaveBeenCalledWith(expect.stringContaining('Error processing features update'), expect.anything());

    if (refreshFails) {
      // The stored features unchanged; features mapped after 1.0.14 can add capabilities
      expect(device.getStoreValue('features')).toEqual(store.features);
      expect(capabilitiesAfter).toEqual(capabilitiesFor(store));
      expect(device.getStoreValue('heatingCircuitId')).toBeUndefined();
      expect(device.error).toHaveBeenCalledWith(expect.stringContaining('retrying on the next start'), expect.any(Error));
    } else {
      expect(device.getStoreValue('commandMetadata')).toEqual(expect.any(Object));
    }
  });

  test('the device works on a heating circuit the installation reports, circuit 0 when it can', async () => {
    const { device } = await upgradeFrom1014({ identity, before: dump });

    const circuit = device.getStoreValue('heatingCircuitId');
    const circuits = reportedCircuits(dump);
    if (circuits.length === 0) expect(circuit).toBe('0');
    else expect(circuits).toContain(circuit);
    if (circuits.includes('0')) expect(circuit).toBe('0');

    const [[poll]] = filteredPolls(device);
    expect(poll.filter).toBe(Object.values(PATHS).map((path) => resolveCircuitPath(path, circuit)).join(','));
  });

  test('a later unfiltered poll removes nothing and is processed without errors', async () => {
    const { device } = await upgradeFrom1014({ identity, before: dump });
    const capabilities = device.getCapabilities().sort();

    await device.onFeaturesUpdated(respond(dump), true);

    expect(device.removeCapability).not.toHaveBeenCalled();
    expect(device.getCapabilities().sort()).toEqual(capabilities);
    expect(device.error).not.toHaveBeenCalled();
    expect(device.getAvailable()).toBe(true);
  });

  if (reportedCircuits(dump).length > 1) {
    test('with several heating circuits, values and commands use the detected circuit only', async () => {
      const { device } = await upgradeFrom1014({ identity, before: dump });
      const circuit = device.getStoreValue('heatingCircuitId');

      const [[poll]] = filteredPolls(device);
      expect(poll.filter).toContain(`heating.circuits.${circuit}.operating.modes.active`);
      for (const other of reportedCircuits(dump).filter((id) => id !== circuit)) {
        expect(poll.filter).not.toContain(`heating.circuits.${other}.`);
      }

      const mode = featureOf(dump, `heating.circuits.${circuit}.operating.modes.active`);
      if (mode?.isEnabled) {
        expect(device.getCapabilityValue('thermostat_mode.heating')).toBe(mode.properties.value.value);
        // A mode other than the current one: writing the current value sends nothing
        const modes = device.getStoreValue('operatingModes');
        const { id } = modes.find((candidate) => candidate.id !== mode.properties.value.value) || modes[0];
        await device.__listeners.get('thermostat_mode.heating')(id);
        expect(device.oAuth2Client.executeCommand).toHaveBeenCalledWith(expect.objectContaining({
          feature: `heating.circuits.${circuit}.operating.modes.active`, command: 'setMode', body: { mode: id },
        }));
      }
    });
  }
});
