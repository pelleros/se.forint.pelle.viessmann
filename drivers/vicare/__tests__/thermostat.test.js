/* eslint-env jest */

'use strict';

// The standard thermostat, the program picker, holiday, hot water settings, what the device is
// doing now (heating now, operating state, status text) and how writes are sent: per fixture
// device, through the real driver, device and config.

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const ViessmannDriver = require('../driver');
const ViessmannDevice = require('../device');
const config = require('../config');
const { STANDARD_MODES, standardModeOf, standardModesFor } = require('../config/thermostat');
const { programsFor, PROGRAMS, ECO_PROGRAM } = require('../config/program');
const {
  heatingNow, operatingState, statusText, formatNumber, HOT_WATER_CHARGING,
} = require('../config/state');
const { FeatureMapper, featureMapper, capabilityRank } = require('../featureMapper');
const { FLOW_CONDITIONS, FLOW_ACTIONS } = require('../flowCards');
const { findFixtureDevice } = require('../../../test/helpers/fixtureDevices');
const en = require('../../../locales/en.json');

const { PATHS } = config;
const clone = (value) => JSON.parse(JSON.stringify(value));
const modes = (...ids) => ids.map((id) => ({ id }));

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

/** A reader over a list of features, like FeatureMapper gives a derived capability */
const reader = (features) => (path, propertyPath) => propertyPath.split('.')
  .reduce((node, part) => node?.[part], features[path]);

afterEach(() => {
  jest.useRealTimers();
});

describe('standard thermostat mode', () => {
  test('stands for the Viessmann modes as heat, off, cool and auto', () => {
    expect(['heating', 'dhwAndHeating', 'forcedNormal', 'forcedReduced'].map(standardModeOf)).toEqual(['heat', 'heat', 'heat', 'heat']);
    expect(['dhw', 'standby', 'normalStandby'].map(standardModeOf)).toEqual(['off', 'off', 'off']);
    expect(standardModeOf('cooling')).toBe('cool');
    expect(['heatingCooling', 'dhwAndHeatingCooling'].map(standardModeOf)).toEqual(['auto', 'auto']);
    expect(standardModeOf('somethingNew')).toBeNull();
  });

  test('offers cool and auto only to devices with such a mode, and heat and off when the modes are unknown', () => {
    const ids = (operatingModes) => standardModesFor(operatingModes).map((mode) => mode.id);
    expect(ids(modes('dhw', 'dhwAndHeating', 'standby'))).toEqual(['heat', 'off']);
    expect(ids(modes('heating', 'standby'))).toEqual(['heat', 'off']);
    expect(ids(modes('dhw', 'dhwAndHeating', 'dhwAndHeatingCooling', 'standby'))).toEqual(['heat', 'auto', 'off']);
    expect(ids(modes('heating', 'cooling', 'heatingCooling', 'standby'))).toEqual(['heat', 'cool', 'auto', 'off']);
    expect(ids([])).toEqual(['heat', 'off']);
    expect(ids(undefined)).toEqual(['heat', 'off']);
  });

  test('every standard value has a title in every app language', () => {
    for (const mode of STANDARD_MODES) expect(Object.keys(mode.title).sort()).toEqual(['de', 'en', 'fr', 'nl', 'sv']);
  });

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
    await expect(device.writeCapability('thermostat_mode', 'cool')).rejects.toThrow(en.commands.mode_not_available);
    await expect(device.writeCapability('thermostat_mode', 'party')).rejects.toThrow('Unknown thermostat mode: party');
    expect(commandsSent(device)).toEqual([]);
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
  test('shows the active program, with the newer program names as the same program', () => {
    const derived = featureMapper.derivedByName('thermostat_mode.heatingProgram');
    const active = (value) => derived.derive(reader({ [PATHS.HEATING_CIRCUIT_0_PROGRAM]: { value: { value } } }), {});
    expect(['normal', 'normalHeating', 'reduced', 'reducedHeating', 'comfort', 'comfortHeating', 'eco'].map(active))
      .toEqual(['normal', 'normal', 'reduced', 'reduced', 'comfort', 'comfort', 'eco']);
    expect(active('standby')).toBeNull();
    expect(active(undefined)).toBeUndefined();
  });

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
    await expect(device.writeCapability('thermostat_mode.heatingProgram', 'reduced')).rejects.toThrow(en.commands.program_follows_schedule);
    await expect(device.writeCapability('thermostat_mode.heatingProgram', 'nap')).rejects.toThrow('Unknown program: nap');
    expect(commandsSent(device)).toEqual([]);
  });

  test('a program the device does not have, or cannot switch on now, is refused', async () => {
    const { device } = await pairedDevice('pyvicare/Vitocal250A');
    await expect(device.writeCapability('thermostat_mode.heatingProgram', 'eco')).rejects.toThrow(en.commands.program_not_available);
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
    const { device } = await pairedDevice('vitocal_222');
    await expect(device.startHoliday({ start: '31-02-2026', end: '03-03-2026' })).rejects.toThrow(en.commands.holiday_invalid_date);
    await expect(device.startHoliday({ start: 'soon', end: '03-03-2026' })).rejects.toThrow(en.commands.holiday_invalid_date);
    await expect(device.startHoliday({ start: '10-03-2026', end: '03-03-2026' })).rejects.toThrow(en.commands.holiday_end_before_start);
    // sameDayAllowed is false on this heat pump
    await expect(device.startHoliday({ start: '2026-03-10', end: '2026-03-10' })).rejects.toThrow(en.commands.holiday_end_before_start);
    expect(commandsSent(device)).toEqual([]);

    const { device: boiler } = await pairedDevice('vitodens_200_e3');
    await boiler.startHoliday({ start: '2026-03-10', end: '2026-03-10' });
    expect(commandsSent(boiler)).toEqual([[PATHS.HOLIDAY, 'schedule', { start: '2026-03-10', end: '2026-03-10' }]]);
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
    expect(ViessmannDriver.capabilityChoices(undefined, 'thermostat_mode.heating')).toEqual([]);

    await listeners['set-device-operating-mode']({ device, mode: { id: 'standby', name: 'Standby' } });
    expect(commandsSent(device)).toEqual([['heating.circuits.0.operating.modes.active', 'setMode', { mode: 'standby' }]]);
    // The existing card is unchanged
    await expect(listeners['set-operating-mode']({ device, mode: 'heating' })).rejects.toThrow('not supported by this heating circuit');
  });
});

describe('heating now, operating state and status text', () => {
  const compressor = (active, phase) => ({ [PATHS.COMPRESSOR]: { active: { value: active }, phase: { value: phase } } });

  test('heating now follows a running compressor outside defrost and cooling, the burner and a generating fuel cell', () => {
    expect(heatingNow(reader(compressor(true, 'heating')))).toBe(true);
    expect(heatingNow(reader(compressor(true, 'ready')))).toBe(true);
    for (const phase of ['defrost', 'passive-defrost', 'cooling', 'pause', 'off']) {
      expect(heatingNow(reader(compressor(true, phase)))).toBe(false);
    }
    expect(heatingNow(reader(compressor(false, 'heating')))).toBe(false);
    expect(heatingNow(reader({ [PATHS.BURNER]: { active: { value: true } } }))).toBe(true);
    expect(heatingNow(reader({ [PATHS.BURNER]: { active: { value: false } }, [PATHS.FUEL_CELL_PHASE]: { value: { value: 'generation' } } }))).toBe(true);
    expect(heatingNow(reader({}))).toBeUndefined();
  });

  test('the operating state tells hot water, defrost, cooling and standby apart', () => {
    const charging = (active) => ({ [HOT_WATER_CHARGING]: { active: { value: active } } });
    expect(operatingState(reader({ ...compressor(true, 'heating'), ...charging(true) }))).toBe('hotWater');
    expect(operatingState(reader({ ...compressor(true, 'heating'), ...charging(false) }))).toBe('heating');
    expect(operatingState(reader(compressor(true, 'heating')))).toBe('heating');
    expect(operatingState(reader(compressor(false, 'passive-defrost')))).toBe('defrost');
    expect(operatingState(reader(compressor(true, 'cooling')))).toBe('cooling');
    expect(operatingState(reader(compressor(false, 'pause')))).toBe('standby');
    expect(operatingState(reader({}))).toBeUndefined();
  });

  test('the status text is built from reported values only, in Homey\'s language', () => {
    const readings = (values) => ({ readings: new Map(Object.entries(values).map(([name, value]) => [name, { value }])) });
    const hotWater = { [PATHS.HOT_WATER_TEMP]: { value: { value: 47.46 } } };
    const running = { ...compressor(true, 'heating'), ...hotWater };
    expect(statusText(reader(running), { language: 'en', ...readings({ 'measure_compressor_number.compressorModulation': 55 }) }))
      .toBe('Heating · compressor 55 % · hot water 47.5 °C');
    expect(statusText(reader(running), { language: 'de', ...readings({ measure_holiday_active: true }) }))
      .toBe('Heizen · Warmwasser 47,5 °C · Urlaub');
    expect(statusText(reader({ ...running, [HOT_WATER_CHARGING]: { active: { value: true } } }), { language: 'fr' }))
      .toBe('Eau chaude · 47,5 °C');
    expect(statusText(reader({ [PATHS.BURNER]: { active: { value: true } } }), { language: 'nl', ...readings({ 'measure_burner_number.burnerModulation': 30 }) }))
      .toBe('Verwarmen · brander 30 %');
    expect(statusText(reader({}), {})).toBeUndefined();
    expect(formatNumber(20, 'sv')).toBe('20');
  });

  test('on a device: values, the tile state, triggers and the condition', async () => {
    const { device, cards, listeners } = await pairedDevice('vitocal_222', { language: 'sv' });
    expect(device.getCapabilityValue('measure_heating_active')).toBe(true);
    expect(device.getCapabilityValue('measure_operating_state')).toBe('heating');
    expect(device.getCapabilityValue('measure_status_text')).toBe('Värmer · kompressor 42 % · varmvatten 49,4 °C');
    expect(await listeners['heating-is-active']({ device })).toBe(true);
    expect(await listeners['operating-state-is']({ device, state: 'heating' })).toBe(true);
    expect(await listeners['heating-program-is']({ device, program: 'comfort' })).toBe(false);
    expect(cards['heating-started'].trigger).toHaveBeenCalledTimes(1);
    expect(cards['operating-state-changed'].trigger).toHaveBeenCalledWith(device, { state: 'heating' }, {});

    await device.setCapabilityValueIfPossible('measure_heating_active', false);
    expect(cards['heating-stopped'].trigger).toHaveBeenCalledTimes(1);
    expect(cards['heating-started'].trigger).toHaveBeenCalledTimes(1);
  });

  test('a response without the compressor and burner keeps the last state; when they are gone it is cleared', async () => {
    const { device, dump } = await pairedDevice('vitocal_222');
    const without = { data: dump.data.filter((item) => item.feature !== PATHS.COMPRESSOR) };
    await device.onFeaturesUpdated(without, false);
    expect(device.getCapabilityValue('measure_heating_active')).toBeNull();
    expect(device.getCapabilityValue('measure_operating_state')).toBeNull();
  });
});

describe('write limits', () => {
  test('the same command waits 10 seconds after the previous one, and only the latest waiting value is sent', async () => {
    jest.useFakeTimers();
    const { device } = await pairedDevice('vitocal_222');
    await device.writeCapability('target_temperature.hotWater', 50);
    const second = device.writeCapability('target_temperature.hotWater', 51);
    const third = device.writeCapability('target_temperature.hotWater', 52);
    // Another command is not held up
    await device.writeCapability('target_temperature.heating', 22);

    await jest.advanceTimersByTimeAsync(10 * 1000);
    await expect(second).resolves.toBe(true);
    await expect(third).resolves.toBe(true);
    expect(commandsSent(device)).toEqual([
      ['heating.dhw.temperature.main', 'setTargetTemperature', { temperature: 50 }],
      ['heating.circuits.0.operating.programs.normal', 'setTemperature', { targetTemperature: 22 }],
      ['heating.dhw.temperature.main', 'setTargetTemperature', { temperature: 52 }],
    ]);
    expect(device.getCapabilityValue('target_temperature.hotWater')).toBe(52);
  });

  test('more than 30 commands an hour are refused in the user\'s language', async () => {
    jest.useFakeTimers();
    const { device } = await pairedDevice('vitocal_222');
    for (let i = 0; i < 30; i++) {
      await device.writeCapability('target_temperature.heating', 10 + (i % 20));
      await jest.advanceTimersByTimeAsync(10 * 1000);
    }
    await expect(device.writeCapability('target_temperature.heating', 25)).rejects.toThrow(en.commands.too_many_commands);
    expect(commandsSent(device)).toHaveLength(30);

    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
    await device.writeCapability('target_temperature.heating', 25);
    expect(commandsSent(device)).toHaveLength(31);
  });

  test('deleting the device drops writes that still wait', async () => {
    jest.useFakeTimers();
    const { device } = await pairedDevice('vitocal_222');
    await device.writeCapability('target_temperature.hotWater', 50);
    const waiting = device.writeCapability('target_temperature.hotWater', 51);
    await device.onOAuth2Deleted();
    await expect(waiting).resolves.toBe(true);
    await jest.advanceTimersByTimeAsync(10 * 1000);
    expect(commandsSent(device)).toHaveLength(1);
    expect(device.getCapabilityValue('target_temperature.hotWater')).toBe(50);
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

  test('an ID takes its own place, else the first prefix that matches it, else the end', () => {
    const order = ['a', 'b.x', 'b*', 'c'];
    expect(['b.x', 'b.y', 'a', 'z', 'c'].map((id) => capabilityRank(id, order))).toEqual([1, 2, 0, 4, 3]);
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

describe('derived capabilities in the mapper', () => {
  test('are added and kept only while a source the roles allow is stored', () => {
    const allowNone = () => false;
    expect(featureMapper.isProduced('measure_heating_active', [PATHS.COMPRESSOR], () => true)).toBe(true);
    expect(featureMapper.isProduced('measure_heating_active', [PATHS.COMPRESSOR], allowNone)).toBe(false);
    expect(featureMapper.isProduced('thermostat_mode.heatingProgram', [PATHS.HEATING_CIRCUIT_0_PROGRAM], () => true)).toBe(false);
    expect(featureMapper.capabilitiesFor([PATHS.COMPRESSOR], []).map(({ capability }) => capability.capabilityName)).toEqual([]);
  });

  test('know their options, configuration and writability', () => {
    expect(featureMapper.configuredOptions('measure_status_text').title.en).toBe('Status');
    expect(featureMapper.capabilityByName('measure_operating_state').capabilityName).toBe('measure_operating_state');
    expect(featureMapper.writableCapabilities()).toEqual(expect.arrayContaining(['thermostat_mode', 'thermostat_mode.heatingProgram',
      'target_temperature', 'target_hysteresis.hotWater']));
    expect(featureMapper.writableCapabilities()).not.toContain('measure_status_text');
    expect(config.getCapabilityOptions('thermostat_mode').uiComponent).toBeNull();
  });

  test('a derive that throws gives no value, and a mapper without derived capabilities works as before', () => {
    const mapper = new FeatureMapper({
      ...config,
      DERIVED: [{
        capabilityName: 'measure_x',
        sources: ['x.y'],
        derive: () => {
          throw new Error('boom');
        },
        capabilityOptions: {},
      }],
    });
    const readings = mapper.readValues({ data: [{ feature: 'x.y', isEnabled: true, properties: { value: { value: 1 } } }] }, []);
    expect(readings.get('measure_x')).toEqual({ value: undefined, gone: false });
    const plain = new FeatureMapper({ FEATURES: config.FEATURES, PATHS: config.PATHS });
    expect(plain.DERIVED).toEqual([]);
    expect(plain.capabilitiesFor([PATHS.HOT_WATER_TEMP], []).map(({ capability }) => capability.capabilityName))
      .toEqual(['measure_temperature.hotWater']);
  });

  test('the config refuses a derived capability with the name of another capability', () => {
    const one = { PATHS: { A: 'a.b' }, FEATURES: { 'a.b': { capabilities: [{ capabilityName: 'measure_x', propertyPath: 'value.value', capabilityOptions: {} }] } } };
    const two = {
      PATHS: {},
      FEATURES: {},
      DERIVED: [{
        capabilityName: 'measure_x', sources: [], derive: () => undefined, capabilityOptions: {},
      }],
    };
    expect(() => config.combine({ one, two }, [])).toThrow('two derives measure_x, which is defined twice');
  });

  test('every Flow card of this release is mapped to a capability a fixture device gets', () => {
    const cards = [...Object.values(FLOW_CONDITIONS), ...Object.values(FLOW_ACTIONS)];
    expect(cards.find((card) => card.id === 'operating-state-is').argument).toBe('state');
    expect(cards.find((card) => card.id === 'start-holiday').method).toBe('startHoliday');
  });
});
