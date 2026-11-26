/* eslint-env jest */

'use strict';

// The store migration registry (migrations.js): one upgrade test per step, idempotence, and the
// same end result as the ad-hoc checks that 1.0.16 ran in checkUpgradeSpecifics.

const { MIGRATIONS, runMigrations, versionBefore } = require('../migrations');

const METADATA = {
  features: ['heating.dhw.temperature.main'],
  constraints: {},
  operatingModes: [{ id: 'dhw', title: { en: 'DHW' } }],
  commandMetadata: { 'heating.dhw.temperature.main': {} },
  heatingCircuitId: '0',
};
const IDS = { installationId: 900001, gatewaySerial: '9999000000000001', deviceId: '0' };

// A device as far as migrations see it; the metadata refresh succeeds unless told otherwise
function fakeDevice({ store = {}, data = {}, refreshFails = false } = {}) {
  const device = {
    store: JSON.parse(JSON.stringify(store)),
    getStoreValue: (key) => device.store[key],
    setStoreValue: jest.fn(async (key, value) => {
      device.store[key] = value;
    }),
    getData: () => data,
    refreshStoredMetadata: jest.fn(async () => {
      if (refreshFails) return; // logged by the device, retried on the next start
      for (const [key, value] of Object.entries(METADATA)) {
        if (key !== 'features' || !Array.isArray(device.store.features)) device.store[key] = value;
      }
    }),
  };
  return device;
}

const step = (version) => MIGRATIONS.find((migration) => migration.version === version);

// checkUpgradeSpecifics as it was in 1.0.16, before the registry
async function checkUpgradeSpecifics1016(device) {
  if (!device.getStoreValue('installationId')) {
    const {
      installationId, gatewaySerial, deviceId, roles, operatingModes,
    } = device.getData();
    await device.setStoreValue('installationId', installationId);
    await device.setStoreValue('gatewaySerial', gatewaySerial);
    await device.setStoreValue('deviceId', deviceId);
    if (!roles) {
      await device.setStoreValue('roles', ['type:heating', 'type:heatpump', 'type:dhw']);
      await device.setStoreValue('operatingModes', [
        { id: 'dhw', title: { en: 'Hot water' } },
        { id: 'dhwAndHeating', title: { en: 'Hot water and Heating' } },
        { id: 'standby', title: { en: 'Standby' } },
      ]);
    } else {
      await device.setStoreValue('roles', roles);
      await device.setStoreValue('operatingModes', operatingModes);
    }
  }
  if (device.getStoreValue('heatingCircuitId') == null || !device.getStoreValue('commandMetadata')) {
    await device.refreshStoredMetadata();
  }
  if (versionBefore(device.getStoreValue('version'), '1.0.9')) {
    await device.setStoreValue('version', '1.0.9');
  }
}

// Stores and device data as each version left them
const STARTS = {
  'paired on 1.0.2': { data: { ...IDS } },
  'paired on 1.0.3': {
    data: { ...IDS, roles: ['type:heating', 'type:boiler'], operatingModes: [{ id: 'heating', title: { en: 'Heating' } }] },
  },
  'paired on 1.0.8': { store: { ...IDS, roles: ['type:heatpump'], operatingModes: [] } },
  'paired on 1.0.14': {
    store: {
      ...IDS, roles: ['type:heatpump'], features: ['heating.dhw.sensors.temperature.dhwCylinder'], constraints: {}, operatingModes: [], version: '1.0.14',
    },
  },
  'paired on 1.0.15': {
    store: {
      ...IDS, roles: ['type:heatpump'], ...METADATA, version: '1.0.15',
    },
  },
};

describe('the registry', () => {
  test('has one step per version, oldest first, each with a description', () => {
    const versions = MIGRATIONS.map((migration) => migration.version);
    expect(versions).toEqual([...new Set(versions)]);
    expect([...versions].sort((a, b) => (versionBefore(a, b) ? -1 : 1))).toEqual(versions);
    for (const migration of MIGRATIONS) {
      expect(migration.description).toEqual(expect.any(String));
      expect(migration.description.length).toBeGreaterThan(20);
    }
  });

  test('versionBefore compares three-part versions; no version counts as 0.0.0', () => {
    expect(versionBefore(undefined, '1.0.9')).toBe(true);
    expect(versionBefore('1.0.4', '1.0.9')).toBe(true);
    expect(versionBefore('1.0.9', '1.0.9')).toBe(false);
    expect(versionBefore('1.0.10', '1.0.9')).toBe(false);
    expect(versionBefore('2.0.0', '1.0.15')).toBe(false);
    expect(versionBefore('1.0.15', '2.0.0')).toBe(true);
  });
});

describe('1.0.4: ids, roles and operating modes move to the store', () => {
  test('a 1.0.2 pairing gets the default heat pump roles and three modes', async () => {
    const device = fakeDevice(STARTS['paired on 1.0.2']);
    expect(step('1.0.4').isNeeded(device)).toBe(true);

    await step('1.0.4').migrate(device);

    expect(device.store).toMatchObject({ ...IDS, roles: ['type:heating', 'type:heatpump', 'type:dhw'] });
    expect(device.store.operatingModes.map((mode) => mode.id)).toEqual(['dhw', 'dhwAndHeating', 'standby']);
    expect(step('1.0.4').isNeeded(device)).toBe(false);
  });

  test('a 1.0.3 pairing keeps its own roles and modes', async () => {
    const device = fakeDevice(STARTS['paired on 1.0.3']);

    await step('1.0.4').migrate(device);

    expect(device.store).toEqual({
      ...IDS, roles: ['type:heating', 'type:boiler'], operatingModes: [{ id: 'heating', title: { en: 'Heating' } }],
    });
  });

  test('a store that has the ids does not need it', () => {
    expect(step('1.0.4').isNeeded(fakeDevice(STARTS['paired on 1.0.8']))).toBe(false);
  });
});

describe('1.0.9: the store records its version', () => {
  test.each([
    [undefined, '1.0.9'],
    ['1.0.4', '1.0.9'],
    ['1.0.14', '1.0.14'],
    ['2.0.0', '2.0.0'],
  ])('version %s becomes %s', async (version, expected) => {
    const device = fakeDevice({ store: { ...IDS, version } });
    if (step('1.0.9').isNeeded(device)) await step('1.0.9').migrate(device);
    expect(device.store.version).toBe(expected);
    expect(step('1.0.9').isNeeded(device)).toBe(false);
  });
});

describe('1.0.15: heating circuit and command metadata are read once', () => {
  test('a store without them reads them; afterwards the step is not needed', async () => {
    const device = fakeDevice(STARTS['paired on 1.0.14']);
    expect(step('1.0.15').isNeeded(device)).toBe(true);

    await step('1.0.15').migrate(device);

    expect(device.refreshStoredMetadata).toHaveBeenCalledTimes(1);
    expect(device.store).toMatchObject({ heatingCircuitId: '0', commandMetadata: METADATA.commandMetadata });
    expect(step('1.0.15').isNeeded(device)).toBe(false);
  });

  test('a failed read leaves the step needed, so the next start tries again', async () => {
    const device = fakeDevice({ ...STARTS['paired on 1.0.14'], refreshFails: true });

    await runMigrations(device);
    await runMigrations(device);

    expect(device.refreshStoredMetadata).toHaveBeenCalledTimes(2);
    expect(step('1.0.15').isNeeded(device)).toBe(true);
  });

  test('a store that has both does not read anything', async () => {
    const device = fakeDevice(STARTS['paired on 1.0.15']);
    await expect(runMigrations(device)).resolves.toEqual([]);
    expect(device.refreshStoredMetadata).not.toHaveBeenCalled();
    expect(device.setStoreValue).not.toHaveBeenCalled();
  });
});

describe.each(Object.entries(STARTS))('%s', (name, start) => {
  test.each([false, true])('ends with the same store as 1.0.16\'s checks (refresh fails: %s)', async (refreshFails) => {
    const before = fakeDevice({ ...start, refreshFails });
    const after = fakeDevice({ ...start, refreshFails });

    await checkUpgradeSpecifics1016(before);
    await runMigrations(after);

    expect(after.store).toEqual(before.store);
    expect(after.refreshStoredMetadata.mock.calls.length).toBe(before.refreshStoredMetadata.mock.calls.length);
  });

  test('is idempotent: a second start changes nothing', async () => {
    const device = fakeDevice(start);
    await runMigrations(device);
    const migrated = JSON.parse(JSON.stringify(device.store));
    device.setStoreValue.mockClear();

    await expect(runMigrations(device)).resolves.toEqual([]);
    expect(device.store).toEqual(migrated);
    expect(device.setStoreValue).not.toHaveBeenCalled();
  });
});

test('an error in a step stops the run', async () => {
  const failing = {
    version: '9.9.9',
    description: 'fails',
    isNeeded: () => true,
    migrate: jest.fn(async () => {
      throw new Error('store full');
    }),
  };
  const later = {
    version: '9.9.10', description: 'later', isNeeded: () => true, migrate: jest.fn(async () => {}),
  };
  await expect(runMigrations(fakeDevice(), [failing, later])).rejects.toThrow('store full');
  expect(later.migrate).not.toHaveBeenCalled();
});
