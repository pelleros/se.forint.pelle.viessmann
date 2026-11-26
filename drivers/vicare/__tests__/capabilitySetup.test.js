/* eslint-env jest */

'use strict';

// capabilitySetup.js: the rules for which capabilities a device has and how they are set up. What
// each installation type gets in the end is in the capability matrix (capabilityMatrix.json); the
// upgrade simulations start devices paired on 1.0.14 with the same functions.

const { PATHS, getCapability } = require('../config');
const { MODE_TITLES } = require('../config/modes');
const { featureMapper } = require('../featureMapper');
const {
  initializeCapabilities, updateCapabilityOptions, initializeOperatingModes, registerCapabilityListeners, optionsPath, withModeTitles,
} = require('../capabilitySetup');

const HOT_WATER = getCapability(PATHS.HOT_WATER_TEMP).capabilityName;
const OUTSIDE = getCapability(PATHS.OUTSIDE_TEMP).capabilityName;
const COMPRESSOR = getCapability(PATHS.COMPRESSOR).capabilityName;
const MODE = getCapability(PATHS.HEATING_CIRCUIT_0_MODE).capabilityName;

// A device with the parts of the Homey SDK that the setup uses, in memory
function fakeDevice({
  features = [], roles = ['type:heatpump'], capabilities = [], operatingModes, options = {}, values = {},
} = {}) {
  const shown = new Map(capabilities.map((name) => [name, values[name] ?? null]));
  const capabilityOptions = { ...options };
  const listeners = new Map();
  return {
    _features: features,
    _roles: roles,
    _constraints: {},
    _operatingModes: operatingModes,
    listeners,
    capabilityOptions,
    log: jest.fn(),
    error: jest.fn(),
    getRoles: () => roles,
    getEnabledGroups: () => [],
    deviceContext: () => ({
      features, operatingModes: operatingModes || [], commandMetadata: undefined, language: 'en', currentValue: () => undefined,
    }),
    getCapabilities: () => [...shown.keys()],
    hasCapability: (name) => shown.has(name),
    addCapability: jest.fn(async (name) => {
      shown.set(name, null);
    }),
    removeCapability: jest.fn(async (name) => {
      shown.delete(name);
    }),
    getCapabilityValue: (name) => shown.get(name),
    getCapabilityOptions: (name) => capabilityOptions[name],
    setCapabilityOptions: jest.fn(async (name, value) => {
      capabilityOptions[name] = value;
    }),
    registerCapabilityListener: jest.fn((name, listener) => listeners.set(name, listener)),
    writeCapability: jest.fn(async () => true),
  };
}

describe('capabilities', () => {
  test('a stored feature adds its capability with its options first; a capability nothing produces is removed', async () => {
    const device = fakeDevice({ features: [PATHS.HOT_WATER_TEMP], capabilities: [OUTSIDE] });
    await initializeCapabilities(device);

    expect(device.getCapabilities()).toContain(HOT_WATER);
    expect(device.getCapabilities()).not.toContain(OUTSIDE);
    expect(device.removeCapability).toHaveBeenCalledWith(OUTSIDE);
    const optionsSet = device.setCapabilityOptions.mock.calls.findIndex(([name]) => name === HOT_WATER);
    const added = device.addCapability.mock.calls.findIndex(([name]) => name === HOT_WATER);
    expect(device.setCapabilityOptions.mock.invocationCallOrder[optionsSet]).toBeLessThan(device.addCapability.mock.invocationCallOrder[added]);
  });

  test('without a stored feature list nothing is added or removed', async () => {
    const device = fakeDevice({ features: undefined, capabilities: [OUTSIDE] });
    device._features = undefined;
    await initializeCapabilities(device);
    expect(device.getCapabilities()).toEqual([OUTSIDE]);
    expect(device.error).toHaveBeenCalledWith('No stored feature list, capabilities are left unchanged');
  });

  test('roles that say what the device is remove what they do not allow; inferred roles only ever add', async () => {
    const boiler = fakeDevice({ features: [PATHS.COMPRESSOR], roles: ['type:boiler'], capabilities: [COMPRESSOR] });
    await initializeCapabilities(boiler);
    expect(boiler.getCapabilities()).not.toContain(COMPRESSOR);

    // No role tag of its own: the stored feature keeps the capability, whatever roles are inferred
    const unknown = fakeDevice({ features: [PATHS.COMPRESSOR], roles: [], capabilities: [COMPRESSOR] });
    await initializeCapabilities(unknown);
    expect(unknown.getCapabilities()).toContain(COMPRESSOR);
  });

  test('a capability that cannot be added is logged and the others are still added', async () => {
    const device = fakeDevice({ features: [PATHS.HOT_WATER_TEMP, PATHS.OUTSIDE_TEMP] });
    device.addCapability.mockImplementationOnce(async () => {
      throw new Error('refused');
    });
    await initializeCapabilities(device);
    expect(device.error).toHaveBeenCalledWith(expect.stringContaining('Error handling capability'), expect.any(Error));
    expect(device.addCapability.mock.calls.length).toBeGreaterThan(1);
  });
});

describe('options', () => {
  test('a derived capability takes the options of its first source, a configured one those of the path it writes to', () => {
    expect(optionsPath('thermostat_mode', [])).toBe(featureMapper.derivedByName('thermostat_mode').sources[0]);
    expect(optionsPath('target_temperature', [PATHS.HEATING_CIRCUIT_0_TARGET_E3])).toBe(PATHS.HEATING_CIRCUIT_0_TARGET_E3);
    expect(optionsPath('target_temperature', [])).toBe(PATHS.HEATING_CIRCUIT_0_TARGET);
    expect(optionsPath('no_such_capability', [])).toBeUndefined();
  });

  test('every capability gets its options again; one that fails is logged', async () => {
    const device = fakeDevice({ features: [PATHS.HOT_WATER_TEMP], capabilities: [HOT_WATER, 'no_such_capability', OUTSIDE] });
    device.setCapabilityOptions.mockImplementationOnce(async () => {
      throw new Error('refused');
    });
    await updateCapabilityOptions(device);
    expect(device.setCapabilityOptions.mock.calls.map(([name]) => name)).toEqual([HOT_WATER, OUTSIDE]);
    expect(device.error).toHaveBeenCalledWith(`Could not update the options of ${HOT_WATER}:`, expect.any(Error));
  });
});

describe('operating modes', () => {
  test('modes the app knows get their translated titles; other modes keep theirs', () => {
    const quiet = { id: 'quiet', title: { en: 'Quiet' } };
    expect(withModeTitles([{ id: 'dhw', title: { en: 'Hot water only' } }, quiet])).toEqual([{ id: 'dhw', title: MODE_TITLES.dhw }, quiet]);
    expect(withModeTitles(undefined)).toEqual([]);
  });

  test('the mode capability offers the device\'s modes: the ones it had first, then the device\'s others', async () => {
    const current = ['dhw', 'dhwAndHeating', 'heating', 'standby'].map((id) => ({ id, title: MODE_TITLES[id] }));
    const quiet = { id: 'quiet', title: { en: 'Quiet' } };
    const device = fakeDevice({
      capabilities: [MODE], options: { [MODE]: { title: { en: 'Operating mode' }, values: current } }, operatingModes: [{ id: 'dhwAndHeating' }, { id: 'dhw' }, quiet],
    });
    await initializeOperatingModes(device);
    expect(device.capabilityOptions[MODE]).toEqual({ title: { en: 'Operating mode' }, values: [current[0], current[1], quiet] });
  });

  test('without known modes, or without the capability, nothing changes', async () => {
    const noModes = fakeDevice({ capabilities: [MODE], operatingModes: [] });
    await initializeOperatingModes(noModes);
    const noCapability = fakeDevice({ operatingModes: [{ id: 'dhw' }] });
    await initializeOperatingModes(noCapability);
    expect(noModes.setCapabilityOptions).not.toHaveBeenCalled();
    expect(noCapability.setCapabilityOptions).not.toHaveBeenCalled();
  });
});

describe('listeners', () => {
  test('one listener per writable capability the device has, registered once', async () => {
    const device = fakeDevice({ capabilities: ['target_temperature', HOT_WATER] });
    await registerCapabilityListeners(device);
    await registerCapabilityListeners(device);
    expect(device.registerCapabilityListener.mock.calls.map(([name]) => name)).toEqual(['target_temperature']);
    expect(device._listeners).toEqual(['target_temperature']);
  });

  test('a capability the device gets later gets its listener on the next run', async () => {
    const device = fakeDevice();
    await registerCapabilityListeners(device);
    expect(device.registerCapabilityListener).not.toHaveBeenCalled();
    await device.addCapability('target_temperature');
    await registerCapabilityListeners(device);
    expect(device.listeners.has('target_temperature')).toBe(true);
  });

  test('a value that equals the current one sends nothing; another value is written', async () => {
    const device = fakeDevice({ capabilities: ['target_temperature'], values: { target_temperature: 20 } });
    await registerCapabilityListeners(device);
    const listener = device.listeners.get('target_temperature');
    await listener(20);
    expect(device.writeCapability).not.toHaveBeenCalled();
    await listener(21);
    expect(device.writeCapability).toHaveBeenCalledWith('target_temperature', 21);
  });

  test('a listener that cannot be registered is logged and tried again on the next run', async () => {
    const device = fakeDevice({ capabilities: ['target_temperature'] });
    device.registerCapabilityListener.mockImplementationOnce(() => {
      throw new Error('refused');
    });
    await registerCapabilityListeners(device);
    expect(device.error).toHaveBeenCalledWith('Error setting up listener for target_temperature:', expect.any(Error));
    await registerCapabilityListeners(device);
    expect(device._listeners).toEqual(['target_temperature']);
  });
});
