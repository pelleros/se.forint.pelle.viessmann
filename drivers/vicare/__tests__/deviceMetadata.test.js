/* eslint-env jest */

'use strict';

// deviceMetadata.js: what a device stores from its features, and that the stored feature list
// only ever grows (CONTRIBUTING.md, ground rule 2). The 1.0.15 store migration and the upgrade
// simulations run the refresh on whole devices.

const { readFixture, clone } = require('../../../test/helpers/polledFixtureDevice');
const {
  readDeviceMetadata, mergeMetadata, mergeWithStored, refreshStoredMetadata, applyMetadata, addNewFeatures, addInferredRoles,
} = require('../deviceMetadata');

const VITOCAL = readFixture('vitocal_222_features.json');

// A device with a store and the setup steps the metadata functions run afterwards
function fakeDevice({ store = {}, features, roles = ['type:heatpump'] } = {}) {
  const stored = { ...store };
  const device = {
    stored,
    _features: features,
    _roles: roles,
    log: jest.fn(),
    error: jest.fn(),
    getStoreValue: (key) => stored[key],
    setStoreValue: jest.fn(async (key, value) => {
      stored[key] = value;
    }),
    getSetting: jest.fn(() => 'auto'),
    getRoles: () => [...(device._roles || []), ...(device._responseRoles || [])],
    mergeRefreshedMetadata: (metadata) => mergeWithStored(device, metadata),
    initializeCapabilities: jest.fn(async () => {}),
    updateCapabilityOptions: jest.fn(async () => {}),
    initializeOperatingModes: jest.fn(async () => {}),
    registerCapabilityListeners: jest.fn(async () => {}),
  };
  return device;
}

const enabled = (feature, properties = {}) => ({ feature, isEnabled: true, properties });

describe('reading metadata', () => {
  test('a features response gives the features, limits, commands and modes of the detected circuit', () => {
    const metadata = readDeviceMetadata(clone(VITOCAL));
    expect(metadata.heatingCircuitId).toBe('0');
    expect(metadata.features).toContain('heating.dhw.sensors.temperature.dhwCylinder');
    expect(metadata.operatingModes.length).toBeGreaterThan(0);
    expect(Object.keys(metadata)).toEqual(['features', 'constraints', 'operatingModes', 'heatingCircuitId', 'commandMetadata']);
  });

  test('a circuit the installation does not have is refused with the circuits it has', () => {
    expect(() => readDeviceMetadata(clone(VITOCAL), '3')).toThrow(expect.objectContaining({
      code: 'heating_circuit_not_available', circuit: '3', available: ['0'],
    }));
  });
});

describe('merging a fresh read with the stored metadata', () => {
  test('the feature list only grows, limits merge per feature, and stored modes stay when none are reported', () => {
    const stored = { features: ['a', 'b'], constraints: { a: { min: 1 }, b: { min: 2 } }, operatingModes: [{ id: 'dhw' }] };
    const fresh = {
      features: ['b', 'c'], constraints: { b: { min: 3 }, c: { min: 4 } }, operatingModes: [], commandMetadata: { c: {} }, heatingCircuitId: '1',
    };
    expect(mergeMetadata(stored, fresh)).toEqual({
      features: ['a', 'b', 'c'],
      constraints: { a: { min: 1 }, b: { min: 3 }, c: { min: 4 } },
      operatingModes: [{ id: 'dhw' }],
      commandMetadata: { c: {} },
      heatingCircuitId: '1',
    });
  });

  test('reported modes replace the stored ones; nothing stored or nothing read still gives a feature list', () => {
    expect(mergeMetadata({ operatingModes: [{ id: 'dhw' }] }, { operatingModes: [{ id: 'standby' }] }).operatingModes).toEqual([{ id: 'standby' }]);
    expect(mergeMetadata({}, { features: ['a'] }).features).toEqual(['a']);
    expect(mergeMetadata({ features: ['a'] }, undefined)).toEqual({ features: ['a'], constraints: {}, operatingModes: undefined });
  });

  test('the device merges with what its store holds', () => {
    const device = fakeDevice({ store: { features: ['a'], constraints: { a: {} }, operatingModes: [{ id: 'dhw' }] } });
    expect(mergeWithStored(device, { features: ['b'] })).toEqual({ features: ['a', 'b'], constraints: { a: {} }, operatingModes: [{ id: 'dhw' }] });
  });
});

describe('refreshing the stored metadata', () => {
  test('reads the device\'s features once and stores the merged metadata, circuit and commands last', async () => {
    const device = fakeDevice({
      store: {
        installationId: 'installation', gatewaySerial: 'gateway', deviceId: '0', features: ['old'],
      },
    });
    device.getSetting.mockReturnValue('1');
    const read = jest.fn(async () => ({
      features: ['new'], constraints: {}, operatingModes: [{ id: 'dhw' }], heatingCircuitId: '1', commandMetadata: {},
    }));
    device.driver = { _getEnabledFeaturesAndOpModes: read };
    device.oAuth2Client = {};

    await refreshStoredMetadata(device);

    expect(read).toHaveBeenCalledWith(device.oAuth2Client, 'installation', 'gateway', '0', '1');
    expect(device.setStoreValue.mock.calls.map(([key]) => key)).toEqual(['features', 'constraints', 'operatingModes', 'commandMetadata', 'heatingCircuitId']);
    expect(device.stored.features).toEqual(['old', 'new']);
  });

  test('a failed read is logged and stores nothing (the next start tries again)', async () => {
    const device = fakeDevice();
    device.driver = { _getEnabledFeaturesAndOpModes: jest.fn().mockRejectedValue(new Error('offline')) };
    await expect(refreshStoredMetadata(device)).resolves.toBeUndefined();
    expect(device.setStoreValue).not.toHaveBeenCalled();
    expect(device.error).toHaveBeenCalledWith('Could not refresh the device metadata, retrying on the next start:', expect.any(Error));
  });

  test('applying metadata stores it and sets the device up again', async () => {
    const device = fakeDevice();
    const metadata = {
      features: ['a'], constraints: { a: {} }, operatingModes: [], heatingCircuitId: '1', commandMetadata: { a: {} },
    };
    await applyMetadata(device, metadata);
    expect(device.stored).toEqual(metadata);
    expect(device).toMatchObject({
      _heatingCircuitId: '1', _features: ['a'], _constraints: { a: {} }, _operatingModes: [], _commands: { a: {} },
    });
    for (const step of ['initializeCapabilities', 'updateCapabilityOptions', 'initializeOperatingModes', 'registerCapabilityListeners']) {
      expect(device[step]).toHaveBeenCalledTimes(1);
    }
  });
});

describe('features and roles found while polling', () => {
  test('an extended poll appends the enabled, connected features the device does not know', async () => {
    const device = fakeDevice({ features: ['a'] });
    await addNewFeatures(device, {
      data: [enabled('a'), enabled('b'), enabled('c', { status: { value: 'notConnected' } }), { feature: 'd', isEnabled: false }],
    });
    expect(device._features).toEqual(['a', 'b']);
    expect(device.stored.features).toEqual(['a', 'b']);
    expect(device.initializeCapabilities).toHaveBeenCalled();
    expect(device.registerCapabilityListeners).toHaveBeenCalled();
  });

  test('nothing new changes nothing; a failure is logged and keeps the device running', async () => {
    const device = fakeDevice({ features: ['a'] });
    await addNewFeatures(device, { data: [enabled('a')] });
    expect(device.setStoreValue).not.toHaveBeenCalled();

    device.setStoreValue.mockRejectedValueOnce(new Error('store'));
    await expect(addNewFeatures(device, { data: [enabled('b')] })).resolves.toBeUndefined();
    expect(device.error).toHaveBeenCalledWith('Error adding new features:', expect.any(Error));
  });

  test('a compressor in a response makes a heat pump of a device whose roles say nothing, once', async () => {
    const compressors = enabled('heating.compressors', { enabled: { value: ['0'] } });
    const device = fakeDevice({ roles: ['type:heating'] });
    await addInferredRoles(device, [compressors]);
    await addInferredRoles(device, [compressors]);
    expect(device._responseRoles).toEqual(['type:heatpump']);
    expect(device.initializeCapabilities).toHaveBeenCalledTimes(1);

    const tagged = fakeDevice({ roles: ['type:boiler'] });
    await addInferredRoles(tagged, [compressors]);
    expect(tagged._responseRoles).toBeUndefined();
  });
});
