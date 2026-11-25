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
      expect(capabilitiesAfter).toEqual(capabilitiesBefore);
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
        const [{ id }] = device.getStoreValue('operatingModes');
        await device.__listeners.get('thermostat_mode.heating')(id);
        expect(device.oAuth2Client.executeCommand).toHaveBeenCalledWith(expect.objectContaining({
          feature: `heating.circuits.${circuit}.operating.modes.active`, command: 'setMode', body: { mode: id },
        }));
      }
    });
  }
});
