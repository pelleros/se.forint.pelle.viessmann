/* eslint-env jest */

'use strict';

// The Flow cards with a kind (flowHandlers.js): registration, the triggers fired from polled
// values and the conditions that fail while a value is unknown.

const fs = require('fs');
const path = require('path');

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const ViessmannDriver = require('../driver');
const ViessmannDevice = require('../device');
const { FLOW_CONDITIONS, FLOW_ACTIONS, FLOW_TRIGGERS } = require('../flowCards');
const { polledFixtureDevice } = require('../../../test/helpers/polledFixtureDevice');
const {
  CONDITIONS, TRIGGERS, ACTIONS, AUTOCOMPLETE, checkCondition, fireValueTriggers, runAction,
} = require('../flowHandlers');

const FIXTURES_DIR = path.join(__dirname, '../../../test/fixtures');
const clone = (value) => JSON.parse(JSON.stringify(value));
const HEAT_PUMP = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'vitocal_222_features.json'), 'utf8'));
const HEAT_PUMP_ROLES = ['type:heating;integrated', 'type:dhw;integrated', 'type:heatpump'];

const PUMP = 'heating.circuits.0.circulation.pump';
const OUTSIDE = 'heating.sensors.temperature.outside';
const MODE = 'heating.circuits.0.operating.modes.active';

// A driver whose Flow cards record what is registered and fired
function driverWithFlow() {
  const driver = new ViessmannDriver();
  const cards = {};
  const card = (group, id) => {
    const key = `${group}/${id}`;
    if (!cards[key]) {
      cards[key] = {
        registerRunListener: jest.fn((listener) => {
          cards[key].run = listener;
        }),
        registerArgumentAutocompleteListener: jest.fn((arg, listener) => {
          cards[key].autocomplete = { arg, listener };
        }),
        trigger: jest.fn(async () => {}),
      };
    }
    return cards[key];
  };
  driver.homey.flow = {
    getConditionCard: jest.fn((id) => card('condition', id)),
    getActionCard: jest.fn((id) => card('action', id)),
    getDeviceTriggerCard: jest.fn((id) => card('trigger', id)),
  };
  return { driver, cards };
}

// The response with one feature's property changed
function withProperty(dump, featurePath, property, value) {
  const response = clone(dump);
  const item = response.data.find((candidate) => candidate.feature === featurePath);
  item.properties[property] = { ...item.properties[property], value };
  return response;
}

async function pairedHeatPump(driver) {
  const device = new ViessmannDevice();
  device.driver = driver;
  device._roles = HEAT_PUMP_ROLES;
  device._features = HEAT_PUMP.data.filter((feature) => feature.isEnabled).map((feature) => feature.feature);
  await device.initializeCapabilities();
  return device;
}

test('every card kind in flowCards.js has its handler, and every handler a card', () => {
  const kinds = (mappings) => Object.values(mappings).map((mapping) => mapping.kind).filter(Boolean);
  expect([...new Set(kinds(FLOW_CONDITIONS))].sort()).toEqual(Object.keys(CONDITIONS).sort());
  expect([...new Set(kinds(FLOW_TRIGGERS))].sort()).toEqual(Object.keys(TRIGGERS).sort());
  expect([...new Set(kinds(FLOW_ACTIONS))].sort()).toEqual(Object.keys(ACTIONS).sort());
  for (const kind of Object.keys(AUTOCOMPLETE)) expect(ACTIONS[kind] || CONDITIONS[kind]).toBeDefined();
});

describe('registration', () => {
  test('every card gets one run listener; the generic cards get their autocomplete', async () => {
    const { driver, cards } = driverWithFlow();
    await driver.onOAuth2Init();

    for (const [group, mappings] of [['condition', FLOW_CONDITIONS], ['action', FLOW_ACTIONS]]) {
      for (const { id } of Object.values(mappings)) {
        expect([id, cards[`${group}/${id}`].registerRunListener.mock.calls.length]).toEqual([id, 1]);
      }
    }
    expect(cards['action/read-feature-number'].autocomplete.arg).toBe('feature');
    expect(cards['action/read-feature-text'].autocomplete.arg).toBe('feature');
    expect(cards['action/run-feature-command'].autocomplete.arg).toBe('command');
    expect(cards['condition/feature-value-is'].autocomplete.arg).toBe('feature');
    // A kind that several cards share takes the argument from the card's mapping
    expect(cards['action/set-device-operating-mode'].autocomplete.arg).toBe('mode');
    expect(cards['action/set-hot-water-mode'].autocomplete.arg).toBe('mode');
    for (const { id } of Object.values(FLOW_TRIGGERS)) expect(cards[`trigger/${id}`]).toBeDefined();
    expect(driver.getValueTriggers('measure_pump_active.circuit0').map(({ mapping }) => mapping.id))
      .toEqual(['circulation-pump-started', 'circulation-pump-stopped']);
    // The trigger of 1.0.16 keeps its own path
    expect(driver.getTriggerCard('thermostat_mode.heating')).toBe(cards['trigger/heating-mode-changed']);
    expect(driver.getValueTriggers('thermostat_mode.heating')).toEqual([]);
  });

  test('a card that cannot be registered is logged and the others still work', async () => {
    const { driver, cards } = driverWithFlow();
    const { getActionCard } = driver.homey.flow;
    driver.homey.flow.getActionCard = jest.fn((id) => {
      if (id === 'boost-hot-water') throw new Error('no such card');
      return getActionCard(id);
    });
    driver._registerFlowCards();
    expect(driver.error).toHaveBeenCalledWith('Failed to register action boost-hot-water:', expect.any(Error));
    expect(cards['action/end-boosts'].run).toBeDefined();
  });

  test('the condition and action listeners run the card', async () => {
    const { driver, cards } = driverWithFlow();
    await driver.onOAuth2Init();
    const device = await pairedHeatPump(driver);
    await device.onFeaturesUpdated(clone(HEAT_PUMP), false);

    await expect(cards['condition/outside-temperature-is'].run({ device, comparison: 'above', temperature: -50 })).resolves.toBe(true);
    await expect(cards['action/run-feature-command'].run({ device, command: undefined, parameters: '{}' }))
      .rejects.toThrow('Choose an entry from the list.');
  });
});

describe('triggers from polled values', () => {
  async function polledHeatPump() {
    const { driver, cards } = driverWithFlow();
    await driver.onOAuth2Init();
    const device = await pairedHeatPump(driver);
    return { device, cards };
  }

  test('the first value is no change, so nothing fires', async () => {
    const { device, cards } = await polledHeatPump();
    await device.onFeaturesUpdated(clone(HEAT_PUMP), false);
    expect(device.getCapabilityValue('measure_pump_active.circuit0')).toBe(true);
    for (const id of ['circulation-pump-started', 'circulation-pump-stopped', 'outside-temperature-changed']) {
      expect(cards[`trigger/${id}`].trigger).not.toHaveBeenCalled();
    }
  });

  test('a pump that stops and starts again fires stopped, then started', async () => {
    const { device, cards } = await polledHeatPump();
    await device.onFeaturesUpdated(clone(HEAT_PUMP), false);

    await device.onFeaturesUpdated(withProperty(HEAT_PUMP, PUMP, 'status', 'off'), false);
    expect(device.getCapabilityValue('measure_pump_active.circuit0')).toBe(false);
    expect(cards['trigger/circulation-pump-stopped'].trigger).toHaveBeenCalledTimes(1);
    expect(cards['trigger/circulation-pump-stopped'].trigger).toHaveBeenCalledWith(device, {}, {});
    expect(cards['trigger/circulation-pump-started'].trigger).not.toHaveBeenCalled();

    // The same state again is no change
    await device.onFeaturesUpdated(withProperty(HEAT_PUMP, PUMP, 'status', 'off'), false);
    expect(cards['trigger/circulation-pump-stopped'].trigger).toHaveBeenCalledTimes(1);

    await device.onFeaturesUpdated(clone(HEAT_PUMP), false);
    expect(cards['trigger/circulation-pump-started'].trigger).toHaveBeenCalledTimes(1);
  });

  test('a pump state is compared as the boolean it shows, so an unchanged pump writes nothing', async () => {
    const { device } = await polledHeatPump();
    await device.onFeaturesUpdated(clone(HEAT_PUMP), false);
    device.setCapabilityValue.mockClear();
    await device.onFeaturesUpdated(clone(HEAT_PUMP), false);
    expect(device.setCapabilityValue).not.toHaveBeenCalledWith('measure_pump_active.circuit0', expect.anything());
    // The one-time charge (mapped true/false → activate/deactivate) is not rewritten either
    expect(device.setCapabilityValue).not.toHaveBeenCalledWith('thermostat_mode.hotWaterOneTimeCharge', expect.anything());
  });

  test('a temperature change fires its trigger with the new value', async () => {
    const { device, cards } = await polledHeatPump();
    await device.onFeaturesUpdated(clone(HEAT_PUMP), false);
    await device.onFeaturesUpdated(withProperty(HEAT_PUMP, OUTSIDE, 'value', -3.5), false);
    expect(cards['trigger/outside-temperature-changed'].trigger).toHaveBeenCalledWith(device, { temperature: -3.5 }, {});
    expect(cards['trigger/hot-water-temperature-changed'].trigger).not.toHaveBeenCalled();
  });

  test('after a gap (value cleared) the first value again is no change', async () => {
    const { device, cards } = await polledHeatPump();
    await device.onFeaturesUpdated(clone(HEAT_PUMP), false);
    const gone = clone(HEAT_PUMP);
    gone.data = gone.data.filter((item) => item.feature !== OUTSIDE);
    await device.onFeaturesUpdated(gone, false);
    expect(device.getCapabilityValue('measure_temperature.outside')).toBeNull();
    await device.onFeaturesUpdated(withProperty(HEAT_PUMP, OUTSIDE, 'value', 9), false);
    expect(cards['trigger/outside-temperature-changed'].trigger).not.toHaveBeenCalled();
  });

  test('updates without triggers (a heating circuit switch) fire nothing', async () => {
    const { device, cards } = await polledHeatPump();
    await device.onFeaturesUpdated(clone(HEAT_PUMP), false);
    await device.onFeaturesUpdated(withProperty(HEAT_PUMP, PUMP, 'status', 'off'), false, { triggers: false });
    expect(cards['trigger/circulation-pump-stopped'].trigger).not.toHaveBeenCalled();
  });

  test('the operating mode trigger of 1.0.16 still fires with its mode token', async () => {
    const { device, cards } = await polledHeatPump();
    await device.onFeaturesUpdated(clone(HEAT_PUMP), false);
    await device.onFeaturesUpdated(withProperty(HEAT_PUMP, MODE, 'value', 'standby'), false);
    expect(cards['trigger/heating-mode-changed'].trigger).toHaveBeenCalledWith(device, { mode: 'standby' }, {});
  });
});

describe('fireValueTriggers', () => {
  test('a failing trigger is logged and the others still run', async () => {
    const failing = {
      trigger: jest.fn(async () => {
        throw new Error('flow error');
      }),
    };
    const working = { trigger: jest.fn(async () => {}) };
    const device = {
      error: jest.fn(),
      driver: {
        getValueTriggers: () => [
          { card: failing, mapping: { id: 'a', kind: 'changed' } },
          { card: working, mapping: { id: 'b', kind: 'changed' } },
        ],
      },
    };
    await fireValueTriggers(device, 'measure_temperature.outside', 3, 2);
    expect(device.error).toHaveBeenCalledWith('Could not run the trigger a:', expect.any(Error));
    expect(working.trigger).toHaveBeenCalledWith(device, { temperature: 3 }, {});
  });

  test('a driver without value triggers (older test doubles) is fine', async () => {
    await expect(fireValueTriggers({ driver: {} }, 'x', 1, 2)).resolves.toBeUndefined();
  });

  test('valueChanged gives the new value as the card\'s token', async () => {
    const card = { trigger: jest.fn(async () => {}) };
    const device = { error: jest.fn(), driver: { getValueTriggers: () => [{ card, mapping: FLOW_TRIGGERS.OPERATING_STATE_CHANGED }] } };
    await fireValueTriggers(device, 'measure_operating_state', 'defrost', 'heating');
    expect(card.trigger).toHaveBeenCalledWith(device, { state: 'defrost' }, {});
    expect(TRIGGERS.valueChanged('comfort', 'normal', FLOW_TRIGGERS.HEATING_PROGRAM_CHANGED)).toEqual({ program: 'comfort' });
  });
});

describe('conditions', () => {
  const device = (value) => ({ getCapabilityValue: () => value });
  const IS_ON = FLOW_CONDITIONS.CIRCULATION_PUMP_RUNNING;
  const COMPARE = FLOW_CONDITIONS.OUTSIDE_TEMPERATURE_IS;

  test('isOn answers whether the state is on', () => {
    expect(checkCondition({ device: device(true) }, IS_ON)).toBe(true);
    expect(checkCondition({ device: device(false) }, IS_ON)).toBe(false);
  });

  test('compare answers above and below', () => {
    expect(checkCondition({ device: device(5), comparison: 'above', temperature: 4.5 }, COMPARE)).toBe(true);
    expect(checkCondition({ device: device(5), comparison: 'above', temperature: 5 }, COMPARE)).toBe(false);
    expect(checkCondition({ device: device(5), comparison: 'below', temperature: 5.5 }, COMPARE)).toBe(true);
    expect(checkCondition({ device: device(-2), comparison: 'below', temperature: -2 }, COMPARE)).toBe(false);
  });

  test('equals compares the value with the card\'s argument', () => {
    const { OPERATING_STATE_IS, HEATING_PROGRAM_IS } = FLOW_CONDITIONS;
    expect(checkCondition({ device: device('heating'), state: 'heating' }, OPERATING_STATE_IS)).toBe(true);
    expect(checkCondition({ device: device('defrost'), state: 'heating' }, OPERATING_STATE_IS)).toBe(false);
    expect(checkCondition({ device: device('eco'), program: 'eco' }, HEATING_PROGRAM_IS)).toBe(true);
    expect(() => checkCondition({ device: device(null), program: 'eco' }, HEATING_PROGRAM_IS)).toThrow('No current value from Viessmann yet');
  });

  test('an unknown value fails the card, in the user\'s language', () => {
    expect(() => checkCondition({ device: device(null) }, IS_ON)).toThrow('No current value from Viessmann yet');
    const translated = { getCapabilityValue: () => null, homey: { __: (key) => `[${key}]` } };
    expect(() => checkCondition({ device: translated, comparison: 'above', temperature: 1 }, COMPARE)).toThrow('[flow.value_unknown]');
  });
});

test('a kind without a handler is refused', async () => {
  await expect(runAction({ device: {} }, { id: 'x', kind: 'nope' })).rejects.toThrow('Unknown Flow card kind: nope (x)');
  expect(() => checkCondition({ device: {} }, { id: 'y', kind: 'nope' })).toThrow('Unknown Flow card kind: nope (y)');
});

describe('the generic condition on any numeric value', () => {
  const { FEATURE_VALUE_IS } = FLOW_CONDITIONS;
  const outside = { name: 'heating.sensors.temperature.outside', path: 'heating.sensors.temperature.outside', property: 'value' };

  test('compares the value (Vitocal 222: outside -3.2 °C) without an API call for a polled value', async () => {
    const { device } = await polledFixtureDevice();
    await expect(checkCondition({
      device, feature: outside, comparison: 'above', value: -5,
    }, FEATURE_VALUE_IS)).resolves.toBe(true);
    await expect(checkCondition({
      device, feature: outside, comparison: 'below', value: -5,
    }, FEATURE_VALUE_IS)).resolves.toBe(false);
    expect(device.oAuth2Client.getFeatures).not.toHaveBeenCalled();
  });

  test('fails when the value is not a number, and offers numbers only', async () => {
    const { device } = await polledFixtureDevice();
    const pump = { name: 'pump', path: 'heating.circuits.0.circulation.pump', property: 'status' };
    await expect(checkCondition({
      device, feature: pump, comparison: 'above', value: 0,
    }, FEATURE_VALUE_IS)).rejects.toThrow('is not a number');
    // The outside sensor reports its value (a number) and its status (text): only the number
    const choices = await AUTOCOMPLETE.compareFeature.choices(device, 'sensors temperature outside');
    expect(choices.map((choice) => choice.name)).toEqual(['heating.sensors.temperature.outside']);
  });
});

describe('chosen values', () => {
  const MODES = [
    { id: 'dhw', title: { en: 'Hot water', sv: 'Varmvatten' } },
    { id: 'standby', title: { en: 'Standby' } },
    { id: 'heatingCooling' },
  ];
  const device = (language) => ({
    getCapabilityOptions: jest.fn(() => ({ values: MODES })),
    homeyLanguage: () => language,
    writeCapability: jest.fn(async () => true),
  });
  const { SET_DEVICE_OPERATING_MODE } = FLOW_ACTIONS;

  test('the choices are the capability\'s values in Homey\'s language, filtered by what was typed', () => {
    const { choices } = AUTOCOMPLETE.chooseValue;
    expect(choices(device('sv'), '', SET_DEVICE_OPERATING_MODE)).toEqual([
      { id: 'dhw', name: 'Varmvatten' }, { id: 'standby', name: 'Standby' }, { id: 'heatingCooling', name: 'heatingCooling' },
    ]);
    expect(choices(device('de'), 'hot', SET_DEVICE_OPERATING_MODE)).toEqual([{ id: 'dhw', name: 'Hot water' }]);
    expect(choices(device('en'), 'cool', SET_DEVICE_OPERATING_MODE).map((choice) => choice.id)).toEqual(['heatingCooling']);
    const without = {
      getCapabilityOptions: () => {
        throw new Error('no capability');
      },
    };
    expect(choices(without, '', SET_DEVICE_OPERATING_MODE)).toEqual([]);
    expect(choices(undefined, '', SET_DEVICE_OPERATING_MODE)).toEqual([]);
  });

  test('the action writes the chosen entry, and refuses text that is not from the list', async () => {
    const target = device('en');
    await runAction({ device: target, mode: { id: 'standby', name: 'Standby' } }, SET_DEVICE_OPERATING_MODE);
    expect(target.writeCapability).toHaveBeenCalledWith('thermostat_mode.heating', 'standby');
    await expect(runAction({ device: target, mode: 'standby' }, SET_DEVICE_OPERATING_MODE)).rejects.toThrow('Choose an entry from the list.');
    expect(target.writeCapability).toHaveBeenCalledTimes(1);
  });
});
