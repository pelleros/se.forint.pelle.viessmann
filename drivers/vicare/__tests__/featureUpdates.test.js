/* eslint-env jest */

'use strict';

// featureUpdates.js: what a device does with a features response, and how one value is shown.
// device.test.js and device.values.test.js run every fixture installation through it.

// The Flow handlers load homey-oauth2app through lib/apiError.js
// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const { PATHS, getCapability } = require('../config');
const { applyFeaturesResponse, showValue } = require('../featureUpdates');

const PUMP = getCapability(PATHS.HEATING_CIRCUIT_0_PUMP).capabilityName;
const OUTSIDE = getCapability(PATHS.OUTSIDE_TEMP).capabilityName;

// A device with the parts of the Homey SDK and of ViessmannDevice that an update uses
function fakeDevice({ capabilities = {}, readings = new Map(), heatingCircuitId = '0' } = {}) {
  const shown = new Map(Object.entries(capabilities));
  const triggerCard = { trigger: jest.fn(async () => {}) };
  const monitor = { onResponse: jest.fn(async () => {}) };
  return {
    shown,
    triggerCard,
    monitor,
    _heatingCircuitId: heatingCircuitId,
    _roles: ['type:heatpump'],
    _features: [],
    _commands: undefined,
    log: jest.fn(),
    error: jest.fn(),
    driver: { getTriggerCard: jest.fn(() => triggerCard), getValueTriggers: jest.fn(() => []) },
    getRoles: () => ['type:heatpump'],
    hasCapability: (name) => shown.has(name),
    getCapabilityValue: (name) => shown.get(name),
    setCapabilityValue: jest.fn(async (name, value) => {
      shown.set(name, value);
    }),
    setCapabilityValueIfPossible: jest.fn(async () => {}),
    readCapabilityValues: jest.fn(() => readings),
    getMonitor: () => monitor,
    setStoreValue: jest.fn(async () => {}),
    initializeCapabilities: jest.fn(async () => {}),
    registerCapabilityListeners: jest.fn(async () => {}),
    setAvailable: jest.fn(async () => {}),
    setUnavailable: jest.fn(async () => {}),
    setLastSeenAt: jest.fn(async () => {}),
  };
}

const SUPPLY_ON_CIRCUIT_1 = {
  feature: 'heating.circuits.1.sensors.temperature.supply', isEnabled: true, properties: { value: { value: 35 } }, commands: {},
};

describe('a features response', () => {
  test('goes to the device\'s circuit; values are shown with triggers, one no longer reported is cleared without', async () => {
    const readings = new Map([[OUTSIDE, { value: 5, gone: false }], [PUMP, { value: undefined, gone: true }], ['other', { value: undefined, gone: false }]]);
    const device = fakeDevice({ capabilities: { [PUMP]: true }, readings, heatingCircuitId: '1' });

    await applyFeaturesResponse(device, { data: [SUPPLY_ON_CIRCUIT_1] }, false);

    const normalized = { data: [{ ...SUPPLY_ON_CIRCUIT_1, feature: PATHS.HEATING_CIRCUIT_0_SUPPLY_TEMPERATURE }] };
    expect(device.readCapabilityValues).toHaveBeenCalledWith(normalized);
    expect(device._commands).toEqual({ [PATHS.HEATING_CIRCUIT_0_SUPPLY_TEMPERATURE]: {} });
    expect(device.setCapabilityValueIfPossible.mock.calls).toEqual([[OUTSIDE, 5, { trigger: true }], [PUMP, null, { trigger: false }]]);
    expect(device.monitor.onResponse).toHaveBeenCalledWith(normalized, { triggers: true });
    expect(device.setAvailable).toHaveBeenCalled();
    expect(device.setLastSeenAt).toHaveBeenCalled();
  });

  test('without triggers (a circuit switch) values are shown without firing anything', async () => {
    const device = fakeDevice({ readings: new Map([[OUTSIDE, { value: 5, gone: false }]]) });
    await applyFeaturesResponse(device, { data: [] }, false, { triggers: false });
    expect(device.setCapabilityValueIfPossible).toHaveBeenCalledWith(OUTSIDE, 5, { trigger: false });
    expect(device.monitor.onResponse).toHaveBeenCalledWith({ data: [] }, { triggers: false });
  });

  test('only an extended response stores the features it finds', async () => {
    const device = fakeDevice({ heatingCircuitId: '1' });
    await applyFeaturesResponse(device, { data: [SUPPLY_ON_CIRCUIT_1] }, false);
    expect(device.setStoreValue).not.toHaveBeenCalled();
    await applyFeaturesResponse(device, { data: [SUPPLY_ON_CIRCUIT_1] }, true);
    expect(device.setStoreValue).toHaveBeenCalledWith('features', [PATHS.HEATING_CIRCUIT_0_SUPPLY_TEMPERATURE]);
  });

  test('a response that is no feature list makes the device unavailable', async () => {
    const device = fakeDevice();
    await applyFeaturesResponse(device, { data: null }, false);
    expect(device.setUnavailable).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invalid features response: no feature list' }));
    expect(device.setAvailable).not.toHaveBeenCalled();
    expect(device.monitor.onResponse).not.toHaveBeenCalled();
  });

  test('a device deleted meanwhile is logged, never thrown', async () => {
    const device = fakeDevice();
    device.setAvailable.mockRejectedValueOnce(new Error('device_not_found'));
    device.setLastSeenAt.mockRejectedValueOnce(new Error('device_not_found'));
    await expect(applyFeaturesResponse(device, { data: [] }, false)).resolves.toBeUndefined();
    expect(device.error).toHaveBeenCalledWith('Could not mark device as available:', expect.any(Error));
    expect(device.error).toHaveBeenCalledWith('Could not set the last seen time:', expect.any(Error));
  });
});

describe('showing a value', () => {
  test('the value is shown as the capability shows it; a change fires its triggers and tells the boosts', async () => {
    const device = fakeDevice({ capabilities: { [PUMP]: false } });
    device._boosts = { valueChanged: jest.fn(async () => {}) };
    await showValue(device, PUMP, 'on');
    expect(device.setCapabilityValue).toHaveBeenCalledWith(PUMP, true);
    expect(device._boosts.valueChanged).toHaveBeenCalledWith(PUMP, true);
    expect(device.driver.getValueTriggers).toHaveBeenCalledWith(PUMP);
    expect(device.triggerCard.trigger).toHaveBeenCalledWith(device, { mode: 'on' }, {});
  });

  test('the same value sets nothing; `trigger: false` sets the value without firing anything', async () => {
    const device = fakeDevice({ capabilities: { [PUMP]: true, [OUTSIDE]: 1 } });
    await showValue(device, PUMP, 'on');
    expect(device.setCapabilityValue).not.toHaveBeenCalled();
    await showValue(device, OUTSIDE, 3, { trigger: false });
    expect(device.setCapabilityValue).toHaveBeenCalledWith(OUTSIDE, 3);
    expect(device.triggerCard.trigger).not.toHaveBeenCalled();
  });

  test('a capability the device does not have, or that no config knows, is left alone', async () => {
    const device = fakeDevice({ capabilities: { unknown_capability: 1 } });
    await showValue(device, OUTSIDE, 3);
    await showValue(device, 'unknown_capability', 2);
    expect(device.setCapabilityValue).not.toHaveBeenCalled();
    expect(device.error).toHaveBeenCalledWith('No configuration found for capability: unknown_capability');
  });

  test('a capability without a trigger card is fine; a value Homey refuses is logged', async () => {
    const device = fakeDevice({ capabilities: { [OUTSIDE]: 1 } });
    device.driver.getTriggerCard.mockImplementation(() => {
      throw new Error('No trigger card');
    });
    await showValue(device, OUTSIDE, 2);
    expect(device.shown.get(OUTSIDE)).toBe(2);
    expect(device.error).not.toHaveBeenCalled();

    device.setCapabilityValue.mockRejectedValueOnce(new Error('refused'));
    await expect(showValue(device, OUTSIDE, 3)).resolves.toBeUndefined();
    expect(device.error).toHaveBeenCalledWith(`Failed to set capability ${OUTSIDE}:`, expect.any(Error));
  });
});
