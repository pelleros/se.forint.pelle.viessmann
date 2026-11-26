/* eslint-env jest */

'use strict';

// The standard thermostat, the program picker, holiday, hot water settings, what the device is
// doing now (heating now, operating state, status text) and that writes count against the
// account's allowance: per fixture
// device, through the real driver, device and config. The modules have their own tests
// (config.modes, config.program, config.state, derivedCapabilities, capabilityWrites, holiday,
// commands, flowHandlers).

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const ViessmannDriver = require('../driver');
const ViessmannDevice = require('../device');
const config = require('../config');
const { programsFor, PROGRAMS, ECO_PROGRAM } = require('../config/program');
const { featureMapper } = require('../featureMapper');
const { findFixtureDevice } = require('../../../test/helpers/fixtureDevices');
const en = require('../../../locales/en.json');
const { WRITE_BURST_LIMIT } = require('../../../lib/apiQuota');

const { PATHS } = config;
const clone = (value) => JSON.parse(JSON.stringify(value));

// Returns only the requested features, like the API does for ?filter=
function respond(dump, filter) {
  if (filter === undefined) return clone(dump);
  const requested = filter.split(',');
  return { ...clone(dump), data: dump.data.filter((item) => requested.includes(item.feature)).map(clone) };
}

// A translation lookup like Homey's, from the English locale file
const translate = (key) => key.split('.').reduce((node, part) => node?.[part], en) ?? key;

/*
  Pairs a fixture device the way pairing does and starts it (including its first, filtered poll),
  with a driver whose Flow cards record their calls.
*/
async function pairedDevice(name, { language = 'en', change } = {}) {
  const { features, identity } = findFixtureDevice(name);
  const dump = clone(features);
  if (change) change(dump);
  const driver = new ViessmannDriver();
  driver.homey.manifest = { version: '2.0.0' };
  const cards = {};
  const listeners = {};
  const card = (id) => {
    cards[id] = {
      trigger: jest.fn(async () => {}),
      registerRunListener: (listener) => {
        listeners[id] = listener;
      },
      registerArgumentAutocompleteListener: (arg, listener) => {
        listeners[`${id}:${arg}`] = listener;
      },
    };
    return cards[id];
  };
  driver.homey.flow = { getDeviceTriggerCard: card, getConditionCard: card, getActionCard: card };
  await driver._registerTriggerCards();
  driver._registerFlowCards();

  const device = new ViessmannDevice();
  device.driver = driver;
  device.__store = {
    installationId: identity.installationId,
    gatewaySerial: identity.gatewaySerial,
    deviceId: identity.deviceId,
    roles: identity.roles,
    ...driver._readDeviceMetadata(clone(dump)),
    version: '2.0.0',
  };
  device.__data = { id: `${identity.installationId}-${identity.gatewaySerial}-${identity.deviceId}` };
  device.__settings = { heatingCircuit: 'auto' };
  device.oAuth2Client = {
    getFeatures: jest.fn(async ({ filter }) => respond(dump, filter)),
    executeCommand: jest.fn(async () => ({ data: { success: true } })),
  };
  device.homey = { __: translate, i18n: { getLanguage: () => language } };
  await device.onOAuth2Init();
  await driver._stopPolling(device.getPollingKey());
  return {
    driver, device, cards, listeners, dump,
  };
}

const commandsSent = (device) => device.oAuth2Client.executeCommand.mock.calls.map(([call]) => [call.feature, call.command, call.body]);

afterEach(() => {
  jest.useRealTimers();
});

describe('standard thermostat mode', () => {
  test('off keeps hot water on where the device can, and is standby only where it cannot', async () => {
    const { device } = await pairedDevice('vitocal_222');
    expect(device.getCapabilityValue('thermostat_mode')).toBe('heat');
    expect(device.getCapabilityOptions('thermostat_mode').values.map((value) => value.id)).toEqual(['heat', 'off']);
    expect(device.getCapabilityOptions('thermostat_mode').uiComponent).toBeNull();

    await device.__listeners.get('thermostat_mode')('off');

    expect(commandsSent(device)).toEqual([['heating.circuits.0.operating.modes.active', 'setMode', { mode: 'dhw' }]]);
    expect(device.getCapabilityValue('thermostat_mode')).toBe('off');
    expect(device.getCapabilityValue('thermostat_mode.heating')).toBe('dhw');

    const { device: boiler } = await pairedDevice('vitodens_200_e3');
    await boiler.__listeners.get('thermostat_mode')('off');
    expect(commandsSent(boiler)).toEqual([['heating.circuits.0.operating.modes.active', 'setMode', { mode: 'standby' }]]);
  });

  test('heat sets hot water and heating, and keeps a mode that already heats', async () => {
    const { device } = await pairedDevice('vitocal_222');
    await device.writeCapability('thermostat_mode', 'heat');
    expect(commandsSent(device)).toEqual([]);

    device.__values.set('thermostat_mode.heating', 'dhw');
    device.__values.set('thermostat_mode', 'off');
    await device.__listeners.get('thermostat_mode')('heat');
    expect(commandsSent(device)).toEqual([['heating.circuits.0.operating.modes.active', 'setMode', { mode: 'dhwAndHeating' }]]);
  });

  test('a mode the device does not have is refused in the user\'s language, and nothing is sent', async () => {
    const { device } = await pairedDevice('vitocal_222');
    await expect(device.writeCapability('thermostat_mode', 'cool')).rejects.toThrow(en.flow.mode_not_available);
    await expect(device.writeCapability('thermostat_mode', 'party')).rejects.toThrow('Unknown thermostat mode: party');
    expect(commandsSent(device)).toEqual([]);
  });

  test('setting the operating mode shows the standard mode at once, without an API call', async () => {
    const { device, listeners } = await pairedDevice('vitocal_222');
    device.oAuth2Client.getFeatures.mockClear();

    await listeners['set-operating-mode']({ device, mode: 'dhw' });
    expect(device.getCapabilityValue('thermostat_mode.heating')).toBe('dhw');
    expect(device.getCapabilityValue('thermostat_mode')).toBe('off');
    expect(device.getCapabilityValue('measure_status_text')).toBe('Heating · compressor 42 % · hot water 49.4 °C');

    await device.__listeners.get('thermostat_mode.heating')('dhwAndHeating');
    expect(device.getCapabilityValue('thermostat_mode')).toBe('heat');
    expect(device.oAuth2Client.getFeatures).not.toHaveBeenCalled();
  });

  test('setting the standard mode shows the operating mode at once, and keeps one that already fits', async () => {
    const { device } = await pairedDevice('vitocal_222');
    await device.writeCapability('thermostat_mode', 'off');
    expect(device.getCapabilityValue('thermostat_mode.heating')).toBe('dhw');

    device.__values.set('thermostat_mode.heating', 'standby');
    await device.writeCapability('thermostat_mode', 'off');
    expect(device.getCapabilityValue('thermostat_mode.heating')).toBe('standby');
    expect(commandsSent(device)).toHaveLength(1);
  });

  test('a mode without a standard equivalent shows the standard mode the next poll will show', async () => {
    const { device, listeners, dump } = await pairedDevice('vitocal_222', {
      change: (features) => {
        const mode = features.data.find((item) => item.feature === PATHS.HEATING_CIRCUIT_0_MODE);
        mode.commands.setMode.params.mode.constraints.enum.push('quiet');
      },
    });
    await listeners['set-operating-mode']({ device, mode: 'quiet' });
    expect(device.getCapabilityValue('thermostat_mode.heating')).toBe('quiet');
    const shownAtOnce = device.getCapabilityValue('thermostat_mode');

    const polled = clone(dump);
    polled.data.find((item) => item.feature === PATHS.HEATING_CIRCUIT_0_MODE).properties.value.value = 'quiet';
    await device.onFeaturesUpdated(polled, false);
    expect(device.getCapabilityValue('thermostat_mode')).toBe(shownAtOnce);
    expect(shownAtOnce).toBeNull();
  });
});

describe('standard thermostat set point and room temperature', () => {
  test('mirror the heating set point (with the API\'s limits) and the room sensor; the room value logs no Insights', async () => {
    const { device } = await pairedDevice('vitodens_200_e3');
    expect(device.getCapabilityValue('target_temperature')).toBe(device.getCapabilityValue('target_temperature.heating'));
    expect(device.getCapabilityOptions('target_temperature')).toMatchObject({ min: 3, max: 37, step: 1 });
    expect(device.getCapabilityValue('measure_temperature')).toBe(device.getCapabilityValue('measure_temperature.circuit0_room'));
    expect(device.getCapabilityOptions('measure_temperature')).toMatchObject({ preventInsights: true, preventTag: true });

    await device.__listeners.get('target_temperature')(19);
    expect(commandsSent(device)).toEqual([['heating.circuits.0.operating.programs.normal', 'setTemperature', { targetTemperature: 19 }]]);
    // Both show the new set point right away
    expect(device.getCapabilityValue('target_temperature')).toBe(19);
    expect(device.getCapabilityValue('target_temperature.heating')).toBe(19);
  });

  test('a device without a room sensor gets no room temperature (never a supply or outside temperature)', async () => {
    const { device } = await pairedDevice('vitocal_222');
    expect(device.hasCapability('target_temperature')).toBe(true);
    expect(device.hasCapability('measure_temperature')).toBe(false);
  });

  test('newer devices write the set point to their own program', async () => {
    jest.useFakeTimers();
    const { device, listeners } = await pairedDevice('pyvicare/Vitocal250A');
    expect(device.getCapabilityValue('target_temperature.heating')).toBe(20);
    expect(device.getCapabilityOptions('target_temperature.heating')).toMatchObject({ min: 3, max: 37 });

    await device.__listeners.get('target_temperature')(21);
    // The same command again: sent 10 seconds after the first (see "write limits")
    const flow = listeners['set-heating-thermostat']({ device, temperature: 22 });
    await jest.advanceTimersByTimeAsync(10 * 1000);
    await flow;

    expect(commandsSent(device)).toEqual([
      ['heating.circuits.0.operating.programs.normalHeating', 'setTemperature', { targetTemperature: 21 }],
      ['heating.circuits.0.operating.programs.normalHeating', 'setTemperature', { targetTemperature: 22 }],
    ]);
  });

  test('a write that does not change the value sends nothing (e.g. a voice assistant repeating it)', async () => {
    const { device } = await pairedDevice('vitocal_222');
    await device.__listeners.get('target_temperature')(device.getCapabilityValue('target_temperature'));
    await device.__listeners.get('target_temperature.hotWater')(device.getCapabilityValue('target_temperature.hotWater'));
    expect(commandsSent(device)).toEqual([]);
  });
});

describe('program picker', () => {
  test('offers only the programs the device has', async () => {
    expect(programsFor([PATHS.HEATING_CIRCUIT_0_TARGET_E3, PATHS.HEATING_CIRCUIT_0_COMFORT_E3]).map((program) => program.id))
      .toEqual(['normal', 'comfort']);
    expect(programsFor([])).toEqual([]);
    const { device } = await pairedDevice('vitocal_222');
    expect(device.getCapabilityOptions('thermostat_mode.heatingProgram').values.map((value) => value.id))
      .toEqual(['normal', 'reduced', 'comfort', 'eco']);
    expect(device.getCapabilityValue('thermostat_mode.heatingProgram')).toBe('normal');
    for (const program of PROGRAMS) expect(Object.keys(program.title).sort()).toEqual(['de', 'en', 'fr', 'nl', 'sv']);
  });

  test('switching to comfort ends eco first, and back to normal ends comfort', async () => {
    const { device, listeners } = await pairedDevice('vitocal_222');
    device.__values.set('thermostat_mode.heatingProgram', 'eco');

    await device.__listeners.get('thermostat_mode.heatingProgram')('comfort');
    expect(device.getCapabilityValue('thermostat_mode.heatingProgram')).toBe('comfort');
    await listeners['set-heating-program']({ device, program: 'normal' });

    expect(commandsSent(device)).toEqual([
      [ECO_PROGRAM, 'deactivate', {}],
      ['heating.circuits.0.operating.programs.comfort', 'activate', {}],
      ['heating.circuits.0.operating.programs.comfort', 'deactivate', {}],
    ]);
    // The time program decides what follows: the next poll shows it
    expect(device.getCapabilityValue('thermostat_mode.heatingProgram')).toBe('comfort');
  });

  test('normal and reduced cannot be chosen while the time program runs', async () => {
    const { device } = await pairedDevice('vitocal_222');
    await expect(device.writeCapability('thermostat_mode.heatingProgram', 'reduced')).rejects.toThrow(en.flow.program_follows_schedule);
    await expect(device.writeCapability('thermostat_mode.heatingProgram', 'nap')).rejects.toThrow('Unknown program: nap');
    expect(commandsSent(device)).toEqual([]);
  });

  test('a program the device does not have, or cannot switch on now, is refused', async () => {
    const { device } = await pairedDevice('pyvicare/Vitocal250A');
    await expect(device.writeCapability('thermostat_mode.heatingProgram', 'eco')).rejects.toThrow(en.flow.program_not_available);
    // comfortHeating lists activate, but not as executable
    await expect(device.writeCapability('thermostat_mode.heatingProgram', 'comfort')).rejects.toThrow('currently unavailable');
    expect(commandsSent(device)).toEqual([]);
  });

  test('the program set points read and write their own program', async () => {
    const { device, listeners } = await pairedDevice('vitocal_222');
    expect(device.getCapabilityValue('target_temperature.heatingReduced')).toBe(16);
    expect(device.getCapabilityValue('target_temperature.heatingComfort')).toBe(20);

    await listeners['set-heating-reduced-thermostat']({ device, temperature: 17 });
    await listeners['set-heating-comfort-thermostat']({ device, temperature: 22 });

    expect(commandsSent(device)).toEqual([
      ['heating.circuits.0.operating.programs.reduced', 'setTemperature', { targetTemperature: 17 }],
      ['heating.circuits.0.operating.programs.comfort', 'setTemperature', { targetTemperature: 22 }],
    ]);
  });

  test('a program change fires its trigger with the program, but no trigger for an unknown program', async () => {
    const { device, cards } = await pairedDevice('vitocal_222');
    cards['heating-program-changed'].trigger.mockClear();
    await device.setCapabilityValueIfPossible('thermostat_mode.heatingProgram', 'comfort');
    await device.setCapabilityValueIfPossible('thermostat_mode.heatingProgram', null);
    expect(cards['heating-program-changed'].trigger.mock.calls).toEqual([[device, { program: 'comfort' }, {}]]);
  });
});

describe('holiday program', () => {
  test('starts from date to date (Homey\'s date format) and ends', async () => {
    const { device, listeners } = await pairedDevice('vitodens_200_e3');
    expect(device.getCapabilityValue('measure_holiday_active')).toBe(false);

    await listeners['start-holiday']({ device, start: '24-12-2026', end: '02-01-2027' });
    device.__values.set('measure_holiday_active', true);
    await listeners['end-holiday']({ device });

    expect(commandsSent(device)).toEqual([
      [PATHS.HOLIDAY, 'schedule', { start: '2026-12-24', end: '2027-01-02' }],
      [PATHS.HOLIDAY, 'unschedule', {}],
    ]);
    expect(device.getCapabilityValue('measure_holiday_active')).toBe(false);
  });

  test('refuses dates that are no dates, an end before the start, and the same day where the device does not allow it', async () => {
    const { device, listeners } = await pairedDevice('vitocal_222');
    const start = (from, to) => listeners['start-holiday']({ device, start: from, end: to });
    await expect(start('31-02-2026', '03-03-2026')).rejects.toThrow(en.flow.holiday_invalid_date);
    await expect(start('soon', '03-03-2026')).rejects.toThrow(en.flow.holiday_invalid_date);
    await expect(start('10-03-2026', '03-03-2026')).rejects.toThrow(en.flow.holiday_end_before_start);
    // sameDayAllowed is false on this heat pump
    await expect(start('2026-03-10', '2026-03-10')).rejects.toThrow(en.flow.holiday_end_before_start);
    expect(commandsSent(device)).toEqual([]);

    const { device: boiler, listeners: boilerListeners } = await pairedDevice('vitodens_200_e3');
    await boilerListeners['start-holiday']({ device: boiler, start: '2026-03-10', end: '2026-03-10' });
    expect(commandsSent(boiler)).toEqual([[PATHS.HOLIDAY, 'schedule', { start: '2026-03-10', end: '2026-03-10' }]]);
  });

  test('ending the holiday program takes it out of the status text at once', async () => {
    const { device, listeners } = await pairedDevice('vitodens_200_e3', {
      change: (features) => {
        features.data.find((item) => item.feature === PATHS.HOLIDAY).properties.active.value = true;
      },
    });
    expect(device.getCapabilityValue('measure_status_text')).toMatch(/ · holiday$/);
    await listeners['end-holiday']({ device });
    expect(device.getCapabilityValue('measure_holiday_active')).toBe(false);
    expect(device.getCapabilityValue('measure_status_text')).not.toMatch(/holiday/);
  });

  test('the condition reads whether the holiday program is active', async () => {
    const { device, listeners } = await pairedDevice('vitodens_200_e3');
    expect(await listeners['holiday-is-active']({ device })).toBe(false);
  });
});

describe('hot water mode and hysteresis', () => {
  test('the mode offers only what the device accepts and is set per device', async () => {
    const { device, listeners } = await pairedDevice('pyvicare/Vitocal250A', { language: 'de' });
    expect(device.getCapabilityOptions('thermostat_mode.hotWater').values.map((value) => value.id))
      .toEqual(['efficientWithMinComfort', 'efficient', 'off']);
    expect(await listeners['set-hot-water-mode:mode']('eff', { device })).toEqual([
      { id: 'efficientWithMinComfort', name: 'Effizient, min. Komfort' },
      { id: 'efficient', name: 'Effizient' },
    ]);

    await listeners['set-hot-water-mode']({ device, mode: { id: 'off', name: 'Aus' } });
    expect(commandsSent(device)).toEqual([[PATHS.HOT_WATER_MODE, 'setMode', { mode: 'off' }]]);
  });

  test('a mode the API lists but the app does not know gets a title from its id', () => {
    const constraints = { [PATHS.HOT_WATER_MODE]: { mode: { enum: ['balanced', 'turbo'] } } };
    expect(featureMapper.optionsFor('thermostat_mode.hotWater', PATHS.HOT_WATER_MODE, constraints).values.map((value) => value.title.en))
      .toEqual(['Balanced', 'Turbo']);
  });

  test('the hysteresis takes the limits of its own command and is written with it', async () => {
    const { device, listeners } = await pairedDevice('pyvicare/Vitocal250A');
    expect(device.getCapabilityOptions('target_hysteresis.hotWater')).toMatchObject({ min: 1, max: 10, step: 0.5 });
    expect(device.getCapabilityValue('target_hysteresis.hotWater')).toBe(5);

    await listeners['set-hot-water-hysteresis']({ device, hysteresis: 6.5 });
    expect(commandsSent(device)).toEqual([[PATHS.HOT_WATER_HYSTERESIS, 'setHysteresis', { hysteresis: 6.5 }]]);
  });
});

describe('operating modes per device', () => {
  test('the autocomplete card offers the device\'s modes in Homey\'s language and sets one', async () => {
    const { device, listeners } = await pairedDevice('vitocal_222', { language: 'sv' });
    expect(await listeners['set-device-operating-mode:mode']('', { device })).toEqual([
      { id: 'dhw', name: 'Varmvatten' },
      { id: 'dhwAndHeating', name: 'Varmvatten och värme' },
      { id: 'standby', name: 'Standby' },
    ]);
    expect(await listeners['set-device-operating-mode:mode']('var', { device })).toHaveLength(2);
    expect(await listeners['set-device-operating-mode:mode']('', { device: undefined })).toEqual([]);

    await listeners['set-device-operating-mode']({ device, mode: { id: 'standby', name: 'Standby' } });
    expect(commandsSent(device)).toEqual([['heating.circuits.0.operating.modes.active', 'setMode', { mode: 'standby' }]]);
    // The existing card is unchanged
    await expect(listeners['set-operating-mode']({ device, mode: 'heating' })).rejects.toThrow('not supported by this heating circuit');
  });
});

describe('heating now, operating state and status text', () => {
  test('on a device: values, the tile state, triggers and the condition', async () => {
    const { device, cards, listeners } = await pairedDevice('vitocal_222', { language: 'sv' });
    expect(device.getCapabilityValue('measure_heating_active')).toBe(true);
    expect(device.getCapabilityValue('measure_operating_state')).toBe('heating');
    expect(device.getCapabilityValue('measure_status_text')).toBe('Värmer · kompressor 42 % · varmvatten 49,4 °C');
    expect(await listeners['heating-is-active']({ device })).toBe(true);
    expect(await listeners['operating-state-is']({ device, state: 'heating' })).toBe(true);
    expect(await listeners['heating-program-is']({ device, program: 'comfort' })).toBe(false);
    // The first values after pairing are no change
    expect(cards['heating-started'].trigger).not.toHaveBeenCalled();
    expect(cards['operating-state-changed'].trigger).not.toHaveBeenCalled();

    await device.setCapabilityValueIfPossible('measure_heating_active', false);
    await device.setCapabilityValueIfPossible('measure_operating_state', 'standby');
    expect(cards['heating-stopped'].trigger).toHaveBeenCalledTimes(1);
    expect(cards['operating-state-changed'].trigger).toHaveBeenCalledWith(device, { state: 'standby' }, {});
    await device.setCapabilityValueIfPossible('measure_heating_active', true);
    expect(cards['heating-started'].trigger).toHaveBeenCalledTimes(1);
    expect(cards['heating-stopped'].trigger).toHaveBeenCalledTimes(1);
  });

  test('the conditions fail while the value is unknown instead of answering no', async () => {
    const { device, listeners } = await pairedDevice('vitocal_222');
    device.__values.set('measure_heating_active', null);
    device.__values.set('measure_operating_state', null);
    await expect(listeners['heating-is-active']({ device })).rejects.toThrow(en.flow.value_unknown);
    await expect(listeners['operating-state-is']({ device, state: 'heating' })).rejects.toThrow(en.flow.value_unknown);
  });

  test('a response without the compressor and burner keeps the last state; when they are gone it is cleared', async () => {
    const { device, dump } = await pairedDevice('vitocal_222');
    const without = { data: dump.data.filter((item) => item.feature !== PATHS.COMPRESSOR) };
    await device.onFeaturesUpdated(without, false);
    expect(device.getCapabilityValue('measure_heating_active')).toBeNull();
    expect(device.getCapabilityValue('measure_operating_state')).toBeNull();
  });
});

describe('writes and the account\'s allowance', () => {
  test('every write counts against the account: a burst of changes is refused in the user\'s language', async () => {
    const { device } = await pairedDevice('vitocal_222');
    for (let i = 0; i < WRITE_BURST_LIMIT; i++) await device.writeCapability('target_temperature.heating', 10 + (i % 20));
    await expect(device.writeCapability('target_temperature', 25)).rejects.toMatchObject({ code: 'write_burst' });
    await expect(device.writeCapability('thermostat_mode', 'off')).rejects.toMatchObject({ code: 'write_burst' });
    expect(commandsSent(device)).toHaveLength(WRITE_BURST_LIMIT);
    expect(device.getCapabilityValue('target_temperature')).toBe(10 + ((WRITE_BURST_LIMIT - 1) % 20));
  });
});

describe('capability order of new devices', () => {
  test('groups the thermostat, mode and program, hot water, status, temperatures, energy and statistics', async () => {
    const { device } = await pairedDevice('vitodens_200_e3');
    const order = device.getCapabilities();
    const position = (id) => order.indexOf(id);
    expect(order.slice(0, 3)).toEqual(['target_temperature', 'measure_temperature', 'thermostat_mode']);
    expect(position('thermostat_mode.heatingProgram')).toBeLessThan(position('measure_temperature.hotWater'));
    expect(position('target_temperature.hotWater')).toBeLessThan(position('measure_status_text'));
    expect(position('measure_burner_active')).toBeLessThan(position('measure_temperature.outside'));
    expect(position('measure_temperature.outside')).toBeLessThan(position('measure_burner_number.burnerHours'));
  });

  test('an existing device keeps its order and gets the new capabilities after its own', async () => {
    const { device } = await pairedDevice('vitocal_222');
    const existing = ['measure_temperature.hotWater', 'target_temperature.hotWater', 'target_temperature.heating', 'thermostat_mode.heating'];
    const upgraded = new ViessmannDevice();
    Object.assign(upgraded, { driver: device.driver, oAuth2Client: device.oAuth2Client, homey: device.homey });
    upgraded.__store = clone(device.__store);
    for (const id of existing) upgraded.__values.set(id, null);
    await upgraded.onOAuth2Init();
    await device.driver._stopPolling(upgraded.getPollingKey());
    expect(upgraded.getCapabilities().slice(0, existing.length)).toEqual(existing);
    expect(upgraded.getCapabilities()).toContain('target_temperature');
    expect(upgraded.removeCapability).not.toHaveBeenCalled();
  });
});
