/* eslint-env jest */

'use strict';

// A heating circuit device's own operating mode and program (extraProfiles.js, extraDevice.js),
// on installations with two circuits: each circuit is set on its own, through the shared write
// path, with the circuit's own modes and programs; the standard thermostat mode follows at once.
// Its Flow cards (drivers/heating-circuit/driver.flow.compose.json, flowCards.js →
// EXTRA_FLOW_CARDS) run with the ViCare driver's handlers (flowHandlers.js).

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const ViessmannDevice = require('../device');
const { extraEntries } = require('../extraPairing');
const { EXTRA_FLOW_CARDS } = require('../flowCards');
const { translate } = require('../../../lib/errorMessages');
const { pollingKey } = require('../pollPlan');
const { MODE_TITLES } = require('../config/modes');
const { findFixtureDevice } = require('../../../test/helpers/fixtureDevices');
const en = require('../../../locales/en.json');
const {
  APP_VERSION, clone, extraHomey, addExtraDevice, fixtureClient,
} = require('../../../test/helpers/extraDevices');

const IDS = { installationId: 900001, gatewaySerial: '9999000000000001', deviceId: '0' };
const KEY = pollingKey(IDS);
const TWO_CIRCUITS = 'pyvicare/Vitocal250A_TwoCircuits';
// Two circuits with forced normal and forced reduced, and eco
const FORCED_MODES = 'pyvicare/Vitodens300W';
const t = (key, tags) => translate(undefined, key, tags);
const source = {
  gateway: { installationId: IDS.installationId, serial: IDS.gatewaySerial },
  device: { id: IDS.deviceId, modelId: 'E3_Vitocal_250', roles: ['type:heatpump', 'type:heating;integrated'] },
};

// A Homey flow manager that hands out recording cards
function flowFake() {
  const cards = {};
  const card = (group) => (id) => {
    const key = `${group}/${id}`;
    cards[key] = cards[key] || {
      trigger: jest.fn(async () => {}),
      registerRunListener: jest.fn((listener) => {
        cards[key].run = listener;
      }),
      registerArgumentAutocompleteListener: jest.fn((arg, listener) => {
        cards[key].autocomplete = { arg, listener };
      }),
    };
    return cards[key];
  };
  return {
    cards,
    flow: { getDeviceTriggerCard: card('trigger'), getConditionCard: card('condition'), getActionCard: card('action') },
  };
}

/**
 * Both heating circuits of a fixture as devices of their own, with the circuit driver's Flow
 * cards, after a shared poll (no ViCare device). `change` edits the features first; the client
 * answers from `dump`, so a later change shows on the next poll.
 */
async function twoCircuits(fixture, { change, language } = {}) {
  const setup = extraHomey();
  const { cards, flow } = flowFake();
  setup.homey.flow = flow;
  if (language) setup.homey.i18n = { getLanguage: () => language };
  await setup.extra.circuit.onOAuth2Init();
  const dump = clone(findFixtureDevice(fixture).features);
  if (change) change(dump);
  const client = fixtureClient(dump);
  const entries = extraEntries('circuit', source, dump, { t, version: APP_VERSION });
  const devices = [];
  for (const entry of entries) devices.push(await addExtraDevice(setup, 'circuit', entry, client));
  const poll = () => setup.vicare._devicePollers.get(KEY).start();
  await poll();
  client.executeCommand.mockClear();
  return {
    setup, cards, dump, client, devices, poll, entries,
  };
}

const sent = (client) => client.executeCommand.mock.calls.map(([request]) => [request.feature, request.command, request.body]);
const modes = (device) => ({
  thermostat_mode: device.getCapabilityValue('thermostat_mode'),
  'thermostat_mode.heating': device.getCapabilityValue('thermostat_mode.heating'),
});
// Sets a feature's value in a features dump
const setValue = (dump, path, property, value) => {
  dump.data.find((feature) => feature.feature === path).properties[property].value = value;
};
// The fixtures were read while some program commands could not run; here they can
const programsExecutable = (dump) => {
  for (const feature of dump.data.filter((item) => item.feature.includes('.operating.programs.'))) {
    for (const command of Object.values(feature.commands || {})) command.isExecutable = true;
  }
};

describe('cards of the heating circuit driver', () => {
  test('the circuit driver registers its own cards with the shared handlers; the other extra drivers have none', async () => {
    const { setup, cards } = await twoCircuits(TWO_CIRCUITS);
    const { conditions, actions, triggers } = EXTRA_FLOW_CARDS.circuit;
    for (const { id } of Object.values(conditions)) expect(cards[`condition/${id}`].registerRunListener).toHaveBeenCalledTimes(1);
    for (const { id } of Object.values(actions)) expect(cards[`action/${id}`].registerRunListener).toHaveBeenCalledTimes(1);
    expect(cards['action/set-circuit-operating-mode'].autocomplete.arg).toBe('mode');
    expect(cards['action/set-circuit-program'].autocomplete.arg).toBe('program');
    expect(cards['condition/circuit-operating-mode-is'].autocomplete.arg).toBe('mode');
    expect(cards['condition/circuit-program-is'].autocomplete.arg).toBe('program');
    expect(setup.extra.circuit.getValueTriggers('thermostat_mode.heating').map(({ card }) => card))
      .toEqual([cards[`trigger/${triggers.OPERATING_MODE_CHANGED.id}`]]);
    expect(setup.extra.circuit.getValueTriggers('thermostat_mode.heatingProgram').map(({ card }) => card))
      .toEqual([cards[`trigger/${triggers.PROGRAM_CHANGED.id}`]]);
    expect(setup.extra.circuit.getValueTriggers('target_temperature')).toEqual([]);
    // No ViCare device card is offered or registered here
    expect(Object.keys(cards).filter((key) => !key.includes('circuit'))).toEqual([]);

    setup.homey.flow = {
      getDeviceTriggerCard: () => {
        throw new Error('no cards');
      },
    };
    await setup.extra.hotWater.onOAuth2Init();
    await setup.extra.room.onOAuth2Init();
    expect(setup.extra.hotWater.getValueTriggers('thermostat_mode')).toEqual([]);
  });

  test('a card that cannot be registered is logged; the circuit driver still starts', async () => {
    const setup = extraHomey();
    setup.homey.flow = {
      getDeviceTriggerCard: () => {
        throw new Error('unknown card');
      },
      getConditionCard: () => {
        throw new Error('unknown card');
      },
      getActionCard: () => {
        throw new Error('unknown card');
      },
    };
    await expect(setup.extra.circuit.onOAuth2Init()).resolves.toBeUndefined();
    expect(setup.extra.circuit.error).toHaveBeenCalled();
    expect(setup.extra.circuit.getValueTriggers('thermostat_mode.heating')).toEqual([]);
  });

  test('autocomplete offers each circuit\'s own modes and programs, in Homey\'s language', async () => {
    const { cards, devices: [, second] } = await twoCircuits(FORCED_MODES, { language: 'sv' });
    const choices = (card, query = '') => cards[card].autocomplete.listener(query, { device: second });
    expect((await choices('action/set-circuit-operating-mode')).map((choice) => choice.id))
      .toEqual(['dhw', 'dhwAndHeating', 'standby', 'forcedReduced', 'forcedNormal']);
    expect(await choices('action/set-circuit-operating-mode', 'tvingad')).toEqual([
      { id: 'forcedReduced', name: MODE_TITLES.forcedReduced.sv },
      { id: 'forcedNormal', name: MODE_TITLES.forcedNormal.sv },
    ]);
    expect((await choices('condition/circuit-program-is')).map((choice) => choice.name)).toEqual(['Normal', 'Sänkt', 'Komfort', 'Eko']);
  });

  test('conditions answer from the circuit\'s own value, and fail while it is unknown', async () => {
    const {
      cards, dump, poll, devices: [first, second],
    } = await twoCircuits(TWO_CIRCUITS);
    setValue(dump, 'heating.circuits.1.operating.modes.active', 'value', 'standby');
    await poll();
    const modeIs = (device, id) => cards['condition/circuit-operating-mode-is'].run({ device, mode: { id, name: id } });
    expect(await modeIs(first, 'heating')).toBe(true);
    expect(await modeIs(second, 'heating')).toBe(false);
    expect(await modeIs(second, 'standby')).toBe(true);
    const programIs = (device, id) => cards['condition/circuit-program-is'].run({ device, program: { id, name: id } });
    expect(await programIs(second, 'normal')).toBe(true);
    expect(await programIs(second, 'comfort')).toBe(false);
    await expect(cards['condition/circuit-program-is'].run({ device: second, program: 'normal' })).rejects.toThrow(en.flow.choose_from_list);
    await second.setCapabilityValue('thermostat_mode.heating', null);
    await expect(modeIs(second, 'standby')).rejects.toThrow(en.flow.value_unknown);
  });

  test('a change of a circuit\'s mode or program fires its triggers for that circuit only', async () => {
    const {
      cards, dump, poll, devices: [first, second],
    } = await twoCircuits(TWO_CIRCUITS);
    const modeChanged = cards['trigger/circuit-operating-mode-changed'].trigger;
    const programChanged = cards['trigger/circuit-program-changed'].trigger;
    // Values after pairing are no change
    expect(modeChanged).not.toHaveBeenCalled();

    setValue(dump, 'heating.circuits.1.operating.modes.active', 'value', 'standby');
    setValue(dump, 'heating.circuits.1.operating.programs.active', 'value', 'comfortHeating');
    await poll();
    expect(modeChanged.mock.calls).toEqual([[second, { mode: 'standby' }, {}]]);
    expect(programChanged.mock.calls).toEqual([[second, { program: 'comfort' }, {}]]);
    expect(modes(first)).toEqual({ thermostat_mode: 'heat', 'thermostat_mode.heating': 'heating' });

    // A write fires them too, at once
    await cards['action/set-circuit-operating-mode'].run({ device: first, mode: { id: 'standby', name: 'Standby' } });
    expect(modeChanged).toHaveBeenLastCalledWith(first, { mode: 'standby' }, {});
  });
});

describe('writes per circuit', () => {
  test('the operating mode goes to the circuit\'s own feature; its standard mode follows at once', async () => {
    const { client, cards, devices: [first, second] } = await twoCircuits(TWO_CIRCUITS);
    await second.__listeners.get('thermostat_mode.heating')('standby');
    expect(sent(client)).toEqual([['heating.circuits.1.operating.modes.active', 'setMode', { mode: 'standby' }]]);
    expect(modes(second)).toEqual({ thermostat_mode: 'off', 'thermostat_mode.heating': 'standby' });
    expect(modes(first)).toEqual({ thermostat_mode: 'heat', 'thermostat_mode.heating': 'heating' });
    // No poll was needed for that
    expect(client.getFeatures).toHaveBeenCalledTimes(2);

    await cards['action/set-circuit-operating-mode'].run({ device: first, mode: { id: 'standby', name: 'Standby' } });
    expect(sent(client)[1]).toEqual(['heating.circuits.0.operating.modes.active', 'setMode', { mode: 'standby' }]);
    expect(modes(first)).toEqual({ thermostat_mode: 'off', 'thermostat_mode.heating': 'standby' });

    // The standard mode sets the operating mode, which follows at once too
    await second.__listeners.get('thermostat_mode')('heat');
    expect(sent(client)[2]).toEqual(['heating.circuits.1.operating.modes.active', 'setMode', { mode: 'heating' }]);
    expect(modes(second)).toEqual({ thermostat_mode: 'heat', 'thermostat_mode.heating': 'heating' });
    // A repeated value sends nothing
    await second.__listeners.get('thermostat_mode.heating')('heating');
    expect(client.executeCommand).toHaveBeenCalledTimes(3);
  });

  test('forced normal and forced reduced on the circuit that has them', async () => {
    const { client, cards, devices: [first, second] } = await twoCircuits(FORCED_MODES);
    expect(modes(second)).toEqual({ thermostat_mode: 'off', 'thermostat_mode.heating': 'dhw' });
    await cards['action/set-circuit-operating-mode'].run({ device: second, mode: { id: 'forcedNormal', name: 'Forced normal' } });
    expect(sent(client)).toEqual([['heating.circuits.1.operating.modes.active', 'setMode', { mode: 'forcedNormal' }]]);
    // A forced mode heats
    expect(modes(second)).toEqual({ thermostat_mode: 'heat', 'thermostat_mode.heating': 'forcedNormal' });
    await second.__listeners.get('thermostat_mode.heating')('forcedReduced');
    expect(sent(client)[1]).toEqual(['heating.circuits.1.operating.modes.active', 'setMode', { mode: 'forcedReduced' }]);
    expect(modes(first)).toEqual({ thermostat_mode: 'off', 'thermostat_mode.heating': 'dhw' });
  });

  test('a mode the circuit does not have is refused before anything is sent', async () => {
    const { client, cards, devices: [, second] } = await twoCircuits(TWO_CIRCUITS);
    const forced = cards['action/set-circuit-operating-mode'].run({ device: second, mode: { id: 'forcedNormal', name: 'Forced normal' } });
    await expect(forced).rejects.toThrow(t('flow.mode_not_supported', { mode: 'forcedNormal' }));
    await expect(cards['action/set-circuit-operating-mode'].run({ device: second, mode: 'heating' })).rejects.toThrow(en.flow.choose_from_list);
    expect(client.executeCommand).not.toHaveBeenCalled();
    expect(second.getCapabilityValue('thermostat_mode.heating')).toBe('heating');
  });

  test('a mode that did not take is reported with its title', async () => {
    const {
      setup, cards, poll, devices: [, second],
    } = await twoCircuits(FORCED_MODES);
    let now = Date.parse('2026-11-26T12:00:00Z');
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    await cards['action/set-circuit-operating-mode'].run({ device: second, mode: { id: 'forcedNormal', name: 'Forced normal' } });
    now += 2 * 60 * 1000;
    await poll();
    now += 2 * 60 * 1000;
    await poll();
    expect(setup.homey.notifications.createNotification).toHaveBeenCalledTimes(1);
    expect(second.setWarning).toHaveBeenCalledWith(expect.stringContaining('Forced normal'));
    jest.restoreAllMocks();
  });

  test('programs: comfort is switched on for that circuit, and normal ends it again', async () => {
    const { client, cards, devices: [first, second] } = await twoCircuits(TWO_CIRCUITS, { change: programsExecutable });
    await cards['action/set-circuit-program'].run({ device: second, program: { id: 'comfort', name: 'Comfort' } });
    expect(sent(client)).toEqual([['heating.circuits.1.operating.programs.comfortHeating', 'activate', {}]]);
    expect(second.getCapabilityValue('thermostat_mode.heatingProgram')).toBe('comfort');
    expect(first.getCapabilityValue('thermostat_mode.heatingProgram')).toBe('normal');

    await second.__listeners.get('thermostat_mode.heatingProgram')('normal');
    expect(sent(client)[1]).toEqual(['heating.circuits.1.operating.programs.comfortHeating', 'deactivate', {}]);

    // Normal while the time program runs, and a program the circuit does not have
    await expect(first.writeCapability('thermostat_mode.heatingProgram', 'reduced')).rejects.toThrow(en.flow.program_follows_schedule);
    await expect(cards['action/set-circuit-program'].run({ device: first, program: { id: 'eco', name: 'Eco' } }))
      .rejects.toThrow(en.flow.program_not_available);
    expect(client.executeCommand).toHaveBeenCalledTimes(2);
  });

  test('programs: eco ends comfort first, on the circuit\'s own programs', async () => {
    const { client, devices: [, second] } = await twoCircuits(FORCED_MODES, { change: programsExecutable });
    // Another program (standby) runs: the picker shows none
    expect(second.getCapabilityValue('thermostat_mode.heatingProgram')).toBeNull();
    await second.writeCapability('thermostat_mode.heatingProgram', 'comfort');
    await second.writeCapability('thermostat_mode.heatingProgram', 'eco');
    expect(sent(client)).toEqual([
      ['heating.circuits.1.operating.programs.comfort', 'activate', {}],
      ['heating.circuits.1.operating.programs.comfort', 'deactivate', {}],
      ['heating.circuits.1.operating.programs.eco', 'activate', {}],
    ]);
    expect(second.getCapabilityValue('thermostat_mode.heatingProgram')).toBe('eco');
  });

  test('a program command the circuit cannot run now is refused before anything is sent', async () => {
    const { client, devices: [, second] } = await twoCircuits(TWO_CIRCUITS);
    await expect(second.writeCapability('thermostat_mode.heatingProgram', 'comfort')).rejects.toThrow('currently unavailable');
    expect(client.executeCommand).not.toHaveBeenCalled();
    expect(second.getCapabilityValue('thermostat_mode.heatingProgram')).toBe('normal');
  });

  test('every write counts against the account\'s allowance', async () => {
    const { setup, devices: [, second] } = await twoCircuits(TWO_CIRCUITS, { change: programsExecutable });
    const quota = jest.spyOn(setup.extra.circuit, 'plannedCallsPerDay');
    await second.writeCapability('thermostat_mode.heating', 'standby');
    await second.writeCapability('thermostat_mode.heatingProgram', 'comfort');
    expect(quota).toHaveBeenCalledTimes(2);
  });
});

describe('program commands follow the program running', () => {
  const COMFORT = 'heating.circuits.1.operating.programs.comfortHeating';
  const PROGRAM = 'thermostat_mode.heatingProgram';
  // Circuit 2 (API index 1) with comfort running or not, as Viessmann reports it: only the
  // command that fits the program running can run
  const comfortRunning = (dump, running) => {
    setValue(dump, 'heating.circuits.1.operating.programs.active', 'value', running ? 'comfortHeating' : 'normalHeating');
    const comfort = dump.data.find((feature) => feature.feature === COMFORT);
    comfort.properties.active.value = running;
    comfort.commands.activate.isExecutable = !running;
    comfort.commands.deactivate.isExecutable = running;
  };

  test('normal, comfort and normal again: each poll brings which commands can run now', async () => {
    const {
      client, dump, poll, devices: [, second],
    } = await twoCircuits(TWO_CIRCUITS, { change: (features) => comfortRunning(features, false) });
    // At pairing, comfort could only be switched on
    expect(second.getStoreValue('commandMetadata')['heating.circuits.0.operating.programs.comfortHeating'].deactivate.isExecutable).toBe(false);

    await second.writeCapability(PROGRAM, 'comfort');
    comfortRunning(dump, true);
    await poll();
    expect(second.getCapabilityValue(PROGRAM)).toBe('comfort');
    // Comfort runs: switching it on again is refused before anything is sent, ending it is not
    await expect(second.writeCapability(PROGRAM, 'comfort')).rejects.toThrow('currently unavailable');
    await second.writeCapability(PROGRAM, 'normal');
    comfortRunning(dump, false);
    await poll();
    expect(second.getCapabilityValue(PROGRAM)).toBe('normal');
    await second.writeCapability(PROGRAM, 'comfort');
    expect(sent(client)).toEqual([
      [COMFORT, 'activate', {}],
      [COMFORT, 'deactivate', {}],
      [COMFORT, 'activate', {}],
    ]);
  });

  test('the ViCare device\'s shared poll brings the circuit\'s programs; a circuit that had not stored them gets them', async () => {
    const setup = extraHomey();
    setup.homey.flow = flowFake().flow;
    await setup.extra.circuit.onOAuth2Init();
    const dump = clone(findFixtureDevice(TWO_CIRCUITS).features);
    comfortRunning(dump, false);
    const client = fixtureClient(dump);

    const main = new ViessmannDevice();
    main.driver = setup.vicare;
    main.homey = setup.homey;
    main.__store = clone({
      ...IDS, roles: source.device.roles, ...setup.vicare._readDeviceMetadata(clone(dump)), version: APP_VERSION, OAuth2SessionId: 'session-1',
    });
    main.__data = { id: KEY };
    main.__settings = { heatingCircuit: 'auto' };
    main.setWarning = jest.fn(async () => {});
    main.unsetWarning = jest.fn(async () => {});
    main.getName = () => 'Vitocal 250';
    main.oAuth2Client = client;
    setup.vicare.getDevices = () => [main];
    await main.onOAuth2Init();

    // Circuit 2 as an earlier pairing stored it: no program but the normal one
    const entry = clone(extraEntries('circuit', source, dump, { t, version: APP_VERSION })[1]);
    const earlier = (path) => !path.includes('.programs.') || /programs\.normal(Heating)?$/.test(path);
    entry.store.features = entry.store.features.filter(earlier);
    entry.store.commandMetadata = Object.fromEntries(Object.entries(entry.store.commandMetadata).filter(([path]) => earlier(path)));
    entry.capabilities = ['target_temperature', 'thermostat_mode'];
    const circuit = await addExtraDevice(setup, 'circuit', entry, client);
    expect(circuit.hasCapability(PROGRAM)).toBe(false);

    await setup.vicare._devicePollers.get(KEY).start();
    const { filter } = client.getFeatures.mock.calls[client.getFeatures.mock.calls.length - 1][0];
    expect(filter.split(',')).toEqual(expect.arrayContaining([
      'heating.circuits.0.operating.programs.active', 'heating.circuits.1.operating.programs.active', COMFORT,
      'heating.circuits.1.operating.programs.reducedHeating', 'heating.circuits.1.operating.programs.eco',
    ]));
    expect(circuit.getStoreValue('features')).toEqual(expect.arrayContaining([
      'heating.circuits.0.operating.programs.active', 'heating.circuits.0.operating.programs.comfortHeating',
    ]));
    expect(Object.keys(circuit.getStoreValue('commandMetadata'))).toContain('heating.circuits.0.operating.programs.comfortHeating');
    expect(circuit.getCapabilityOptions(PROGRAM).values.map((value) => value.id)).toEqual(['normal', 'reduced', 'comfort']);
    expect(circuit.getCapabilityValue(PROGRAM)).toBe('normal');

    await circuit.writeCapability(PROGRAM, 'comfort');
    expect(sent(client)).toEqual([[COMFORT, 'activate', {}]]);
    // The ViCare device kept its own circuit
    expect(main.getCapabilityValue(PROGRAM)).toBe('normal');
  });
});

describe('a circuit without programs', () => {
  // Circuit 2 (API index 1) of the two-circuit heat pump without any program
  const withoutPrograms = (dump) => {
    dump.data = dump.data.filter((feature) => !feature.feature.startsWith('heating.circuits.1.operating.programs.'));
  };

  test('has no program picker and no program cards, and keeps its operating mode', async () => {
    const { client, cards, devices: [first, second] } = await twoCircuits(TWO_CIRCUITS, { change: withoutPrograms });
    expect(first.getCapabilities()).toContain('thermostat_mode.heatingProgram');
    expect(second.getCapabilities()).toEqual(['thermostat_mode', 'thermostat_mode.heating']);
    expect(second.getStoreValue('features').some((path) => path.includes('.programs.'))).toBe(false);
    // The program cards' $filter does not offer them; a saved card fails clearly
    expect(await cards['action/set-circuit-program'].autocomplete.listener('', { device: second })).toEqual([]);
    await expect(cards['action/set-circuit-program'].run({ device: second, program: { id: 'comfort', name: 'Comfort' } }))
      .rejects.toThrow(en.flow.program_not_available);
    await expect(cards['condition/circuit-program-is'].run({ device: second, program: { id: 'comfort', name: 'Comfort' } }))
      .rejects.toThrow(en.flow.value_unknown);

    await cards['action/set-circuit-operating-mode'].run({ device: second, mode: { id: 'standby', name: 'Standby' } });
    expect(sent(client)).toEqual([['heating.circuits.1.operating.modes.active', 'setMode', { mode: 'standby' }]]);
    expect(modes(second)).toEqual({ thermostat_mode: 'off', 'thermostat_mode.heating': 'standby' });
  });
});
