/* eslint-env jest */

'use strict';

// The generic Flow cards (featureCards.js): read any feature value, run any command, with
// autocomplete from what the device reports, and few API calls.

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const { polledFixtureDevice } = require('../../../test/helpers/polledFixtureDevice');
const featureCards = require('../featureCards');

const MINUTE = 60 * 1000;

let clock;
beforeEach(() => {
  clock = { now: Date.parse('2026-11-26T12:00:00Z') };
  jest.spyOn(Date, 'now').mockImplementation(() => clock.now);
});
afterEach(() => jest.restoreAllMocks());

const heatPump = () => polledFixtureDevice({ clock });
// The API calls the device made after its first poll
const apiReads = (device) => device.oAuth2Client.getFeatures.mock.calls.map(([request]) => request.filter);
const choice = (path, property = 'value') => ({ name: path, path, property });

describe('reading a value', () => {
  test('a value every poll requests comes from the last poll, without an API call', async () => {
    const { device } = await heatPump();
    await expect(featureCards.readNumber(device, choice('heating.sensors.temperature.outside'))).resolves.toEqual({ number: -3.2 });
    expect(apiReads(device)).toEqual([]);
  });

  test('another value is read from the API once and reused for 1.5 poll intervals', async () => {
    const { device } = await heatPump();
    const rotation = choice('heating.primaryCircuit.sensors.rotation');
    await expect(featureCards.readNumber(device, rotation)).resolves.toEqual({ number: 79 });
    clock.now += 3 * MINUTE;
    await featureCards.readNumber(device, rotation);
    expect(apiReads(device)).toEqual(['heating.primaryCircuit.sensors.rotation']);
    clock.now += 1;
    await featureCards.readNumber(device, rotation);
    expect(apiReads(device)).toHaveLength(2);
  });

  test('reads any property of a feature, also on the device\'s other heating circuit', async () => {
    const { device } = await polledFixtureDevice({ clock, fixture: 'pyvicare/Vitocal250A_TwoCircuits.json', heatingCircuitId: '1' });
    const levels = choice('heating.circuits.0.temperature.levels', 'max');
    const { number } = await featureCards.readNumber(device, levels);
    expect(typeof number).toBe('number');
    expect(apiReads(device)).toEqual(['heating.circuits.1.temperature.levels']);
  });

  test('as text: strings as they are, numbers and booleans as text', async () => {
    const { device } = await heatPump();
    await expect(featureCards.readText(device, choice('heating.circuits.0.circulation.pump', 'status'))).resolves.toEqual({ text: 'on' });
    await expect(featureCards.readText(device, choice('heating.dhw.temperature.main'))).resolves.toEqual({ text: '45' });
    await expect(featureCards.readText(device, choice('heating.dhw.oneTimeCharge', 'active'))).resolves.toEqual({ text: 'false' });
  });

  test('lists and objects become JSON text', async () => {
    const { device } = await heatPump();
    const { text } = await featureCards.readText(device, choice('heating.circuits.0.heating.schedule', 'entries'));
    expect(JSON.parse(text)).toEqual(expect.any(Object));
  });

  test('fails clearly when the value is missing, not a number or unknown', async () => {
    const { device } = await heatPump();
    await expect(featureCards.readNumber(device, choice('heating.circuits.0.circulation.pump', 'status')))
      .rejects.toThrow('The value of heating.circuits.0.circulation.pump is not a number.');
    await expect(featureCards.readNumber(device, choice('heating.dhw.temperature.main', 'nothing')))
      .rejects.toThrow('heating.dhw.temperature.main has no value nothing.');
    await expect(featureCards.readNumber(device, choice('heating.does.not.exist')))
      .rejects.toThrow('The device does not report heating.does.not.exist.');
    await expect(featureCards.readNumber(device, undefined)).rejects.toThrow('Choose an entry from the list.');
    featureCards.recordFeatures(device, { data: [{ feature: 'x.y', isEnabled: true, properties: { value: { type: 'number', value: null } } }] });
    await expect(featureCards.readNumber(device, choice('x.y'))).rejects.toThrow('No current value from Viessmann yet');
  });
});

describe('choosing a value', () => {
  test('lists the device\'s values from one complete read, reused for 10 minutes', async () => {
    const { device } = await heatPump();
    const all = await featureCards.valueChoices(device, '');
    expect(all.length).toBe(50);
    const outside = await featureCards.valueChoices(device, 'sensors temperature outside');
    expect(outside).toEqual([expect.objectContaining({
      name: 'heating.sensors.temperature.outside',
      description: '-3.2 celsius',
      path: 'heating.sensors.temperature.outside',
      property: 'value',
    }), expect.objectContaining({ name: 'heating.sensors.temperature.outside · status' })]);
    expect(apiReads(device)).toEqual([undefined]);
    clock.now += 10 * MINUTE + 1;
    await featureCards.valueChoices(device, 'outside');
    expect(apiReads(device)).toEqual([undefined, undefined]);
  });

  test('the number card lists numbers only; properties other than value are named', async () => {
    const { device } = await heatPump();
    const curve = await featureCards.valueChoices(device, 'heating.curve', { numbers: true });
    expect(curve.map((item) => item.name)).toEqual(['heating.circuits.0.heating.curve · shift', 'heating.circuits.0.heating.curve · slope']);
    const pump = await featureCards.valueChoices(device, 'circulation.pump', { numbers: true });
    expect(pump).toEqual([]);
  });

  test('an extended poll counts as a complete read', async () => {
    const { device, dump } = await heatPump();
    await device.onFeaturesUpdated(JSON.parse(JSON.stringify(dump)), true);
    await featureCards.valueChoices(device, 'outside');
    expect(apiReads(device)).toEqual([]);
  });

  test('shows the device\'s real heating circuit', async () => {
    const { device } = await polledFixtureDevice({ clock, fixture: 'pyvicare/Vitocal250A_TwoCircuits.json', heatingCircuitId: '1' });
    const names = (await featureCards.valueChoices(device, 'heating.circuits.')).map((item) => item.name);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => !/^heating\.circuits\.1[. ]/.test(name))).toEqual([]);
  });
});

describe('commands', () => {
  test('lists the executable commands with their parameters', async () => {
    const { device } = await heatPump();
    const [curve] = featureCards.commandChoices(device, 'setCurve');
    expect(curve).toEqual({
      name: 'heating.circuits.0.heating.curve · setCurve',
      description: 'slope: number 0–3.5 step 0.1, shift: number -15–40 step 1',
      path: 'heating.circuits.0.heating.curve',
      command: 'setCurve',
    });
    const names = featureCards.commandChoices(device, '').map((item) => item.name);
    expect(names).toContain('heating.dhw.oneTimeCharge · activate');
    expect(names).not.toContain('device.serial · setPrin');
    expect(featureCards.commandChoices(device, 'oneTimeCharge activate')[0].description).toBe('{}');
  });

  test('runs a command, checked against the device\'s limits, on the device\'s circuit', async () => {
    const { device } = await heatPump();
    const [curve] = featureCards.commandChoices(device, 'setCurve');
    await featureCards.runCommand(device, curve, ' {"slope": 1.1, "shift": 2} ');
    expect(device.oAuth2Client.executeCommand).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'heating.circuits.0.heating.curve', command: 'setCurve', body: { slope: 1.1, shift: 2 },
    }));
    const [activate] = featureCards.commandChoices(device, 'oneTimeCharge activate');
    await featureCards.runCommand(device, activate, '');
    expect(device.oAuth2Client.executeCommand).toHaveBeenLastCalledWith(expect.objectContaining({ command: 'activate', body: {} }));
  });

  test('refuses what it cannot send, before sending anything', async () => {
    const { device } = await heatPump();
    const [curve] = featureCards.commandChoices(device, 'setCurve');
    await expect(featureCards.runCommand(device, curve, '{slope: 1}')).rejects.toThrow('The parameters must be a JSON object');
    await expect(featureCards.runCommand(device, curve, '[1]')).rejects.toThrow('The parameters must be a JSON object');
    await expect(featureCards.runCommand(device, curve, '{"slope": 1, "shift": 2, "speed": 3}'))
      .rejects.toThrow('The command has no parameter speed.');
    await expect(featureCards.runCommand(device, curve, '{"slope": 9, "shift": 2}')).rejects.toThrow('slope is outside the supported range');
    await expect(featureCards.runCommand(device, curve, '{"shift": 2}')).rejects.toThrow('Missing required parameter: slope');
    await expect(featureCards.runCommand(device, { name: 'x' }, '{}')).rejects.toThrow('Choose an entry from the list.');
    device._commands = undefined;
    await expect(featureCards.runCommand(device, curve, '{"slope": 1, "shift": 2}')).rejects.toThrow('The commands of the device are not known yet');
    expect(device.oAuth2Client.executeCommand).not.toHaveBeenCalled();
    expect(device._writeLimiters).toBeUndefined();
  });

  test('at most 20 commands per hour', async () => {
    const { device } = await heatPump();
    const [activate] = featureCards.commandChoices(device, 'oneTimeCharge activate');
    for (let i = 0; i < 20; i++) await featureCards.runCommand(device, activate, '{}');
    await expect(featureCards.runCommand(device, activate, '{}')).rejects.toThrow('at most 20 per hour');
  });
});
