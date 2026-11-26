/* eslint-env jest */

'use strict';

// The extra devices on Homey (extraDevice.js, extraDriver.js) with the ViCare driver's shared poll
// (driver.js): one request per Viessmann device for every Homey device that shows it, also
// without a ViCare device; writes through the shared write path; hot water heat/off; rooms read
// slowly; poll errors; pairing.

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const { OAuth2Driver } = require('homey-oauth2app');
const ViessmannDevice = require('../device');
const { extraEntries } = require('../extraPairing');
const { translate } = require('../../../lib/errorMessages');
const { apiError } = require('../../../lib/apiError');
const { pollingKey, ROOM_POLL_INTERVAL } = require('../pollPlan');
const { findFixtureDevice } = require('../../../test/helpers/fixtureDevices');
const {
  APP_VERSION, clone, extraHomey, addExtraDevice, fixtureClient,
} = require('../../../test/helpers/extraDevices');

const MINUTE = 60 * 1000;
const t = (key, tags) => translate(undefined, key, tags);
const IDS = { installationId: 900001, gatewaySerial: '9999000000000001', deviceId: '0' };
const KEY = pollingKey(IDS);
const ROOM_IDS = { ...IDS, deviceId: 'RoomControl-1' };

const source = (deviceId = '0', modelId = 'E3_Vitocal_250') => ({
  gateway: { installationId: IDS.installationId, serial: IDS.gatewaySerial },
  device: { id: deviceId, modelId, roles: ['type:heatpump', 'type:dhw;integrated', 'type:heating;integrated'] },
});
const entries = (kind, fixture, deviceId) => extraEntries(kind, source(deviceId), findFixtureDevice(fixture).features, { t, version: APP_VERSION });
const filters = (client) => client.getFeatures.mock.calls.map(([request]) => request.filter?.split(','));

// The ViCare device of a fixture, on the same Homey and polled by the ViCare driver
async function addMainDevice(setup, fixture, client) {
  const { features } = findFixtureDevice(fixture);
  const device = new ViessmannDevice();
  device.driver = setup.vicare;
  device.homey = setup.homey;
  device.__store = clone({
    ...IDS, roles: source().device.roles, ...setup.vicare._readDeviceMetadata(clone(features)), version: APP_VERSION, OAuth2SessionId: 'session-1',
  });
  device.__data = { id: KEY };
  device.__settings = { heatingCircuit: 'auto' };
  device.setWarning = jest.fn(async () => {});
  device.unsetWarning = jest.fn(async () => {});
  device.getName = () => 'Viessmann Vitocal 250';
  device.oAuth2Client = client;
  setup.vicare.getDevices = () => [device];
  await device.onOAuth2Init();
  return device;
}

const poller = (setup, key = KEY) => setup.vicare._devicePollers.get(key);
const values = (device) => Object.fromEntries(device.getCapabilities().map((name) => [name, device.getCapabilityValue(name)]));

let random;
beforeEach(() => {
  random = jest.spyOn(Math, 'random').mockReturnValue(0.5); // never the extended poll
});
afterEach(() => {
  random.mockRestore();
  jest.restoreAllMocks();
});

describe('the shared poll', () => {
  test('without a ViCare device, a heating circuit polls for itself: its own paths, at the automatic interval', async () => {
    const setup = extraHomey();
    const client = fixtureClient(findFixtureDevice('pyvicare/Vitocal250A_TwoCircuits').features);
    const [, circuitOne] = entries('circuit', 'pyvicare/Vitocal250A_TwoCircuits');
    const device = await addExtraDevice(setup, 'circuit', circuitOne, client);
    expect(filters(client)).toEqual([[
      'heating.circuits.1.operating.programs.normal',
      'heating.circuits.1.operating.programs.normalHeating',
      'heating.circuits.1.sensors.temperature.room',
      'heating.circuits.1.operating.modes.active',
    ]]);
    expect(client.getFeatures.mock.calls[0][0]).toMatchObject(IDS);
    expect(values(device)).toEqual({ target_temperature: expect.any(Number), thermostat_mode: 'heat' });
    expect(setup.vicare._groupInterval(KEY)).toBe(2 * MINUTE);
    expect(setup.vicare.plannedCallsPerDay('session-1')).toBe(720);
    expect(setup.extra.circuit.plannedCallsPerDay('session-1')).toBe(720);
    expect(device.setLastSeenAt).toHaveBeenCalled();
  });

  test('with the ViCare device, one request per poll serves every device of the Viessmann device', async () => {
    const setup = extraHomey();
    const client = fixtureClient(findFixtureDevice('pyvicare/Vitocal250A_TwoCircuits').features);
    const main = await addMainDevice(setup, 'pyvicare/Vitocal250A_TwoCircuits', client);
    expect(client.getFeatures).toHaveBeenCalledTimes(1);
    const mainTarget = main.getCapabilityValue('target_temperature');

    // Hot water is in the ViCare device's last response: values at once, no request
    const hotWater = await addExtraDevice(setup, 'hotWater', entries('hotWater', 'pyvicare/Vitocal250A_TwoCircuits')[0], client);
    expect(hotWater.getCapabilityValue('target_temperature')).toEqual(expect.any(Number));
    expect(client.getFeatures).toHaveBeenCalledTimes(1);
    // Circuit 1 is not: the next poll comes in 10 seconds instead of an interval later
    const circuit = await addExtraDevice(setup, 'circuit', entries('circuit', 'pyvicare/Vitocal250A_TwoCircuits')[1], client);
    expect(circuit.getCapabilityValue('target_temperature')).toBeNull();
    expect(setup.homey.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 10 * 1000);

    await poller(setup).start();
    expect(client.getFeatures).toHaveBeenCalledTimes(2);
    const [request] = client.getFeatures.mock.calls[1];
    expect(request.filter.split(',')).toEqual(expect.arrayContaining(['heating.circuits.0.operating.modes.active', 'heating.circuits.1.operating.modes.active']));
    expect(circuit.getCapabilityValue('target_temperature')).toEqual(expect.any(Number));
    expect(main.getCapabilityValue('target_temperature')).toBe(mainTarget);
    // One Viessmann device: the interval and the planned calls stay those of one device
    expect(setup.vicare._calculatePollInterval(main)).toBe(2 * MINUTE);
    expect(setup.vicare.plannedCallsPerDay('session-1')).toBe(720);
  });

  test('the ViCare device deleted, the extra devices keep polling; added again, it takes over at once', async () => {
    const setup = extraHomey();
    const client = fixtureClient(findFixtureDevice('pyvicare/Vitocal250A_TwoCircuits').features);
    const main = await addMainDevice(setup, 'pyvicare/Vitocal250A_TwoCircuits', client);
    const circuit = await addExtraDevice(setup, 'circuit', entries('circuit', 'pyvicare/Vitocal250A_TwoCircuits')[0], client);
    expect(circuit.getCapabilityValue('thermostat_mode')).toBe('heat');

    await main.onOAuth2Deleted();
    setup.vicare.getDevices = () => [];
    expect(poller(setup)).toBeDefined();
    const onFeaturesUpdated = jest.spyOn(main, 'onFeaturesUpdated');
    client.getFeatures.mockClear();
    await poller(setup).start();
    expect(filters(client)).toEqual([circuit.pollPaths()]);
    expect(onFeaturesUpdated).not.toHaveBeenCalled();
    expect(setup.vicare._groupInterval(KEY)).toBe(2 * MINUTE);
    expect(setup.vicare.plannedCallsPerDay('session-1')).toBe(720);

    client.getFeatures.mockClear();
    const again = await addMainDevice(setup, 'pyvicare/Vitocal250A_TwoCircuits', client);
    expect(client.getFeatures).toHaveBeenCalledTimes(1);
    expect(again.getCapabilityValue('thermostat_mode')).toBe('heat');
  });

  test('the last extra device of a Viessmann device without a ViCare device stops its poll', async () => {
    const setup = extraHomey();
    const client = fixtureClient(findFixtureDevice('pyvicare/Vitocal250A_TwoCircuits').features);
    const [zero, one] = entries('circuit', 'pyvicare/Vitocal250A_TwoCircuits');
    const first = await addExtraDevice(setup, 'circuit', zero, client);
    const second = await addExtraDevice(setup, 'circuit', one, client);
    const running = poller(setup);
    const stop = jest.spyOn(running, 'stop');
    await first.onOAuth2Deleted();
    expect(stop).not.toHaveBeenCalled();
    await second.onOAuth2Uninit();
    expect(stop).toHaveBeenCalled();
    expect(poller(setup)).toBeUndefined();
    // Leaving twice changes nothing
    await second.onOAuth2Deleted();
  });

  test('poll errors reach every device of the Viessmann device, and the next poll makes them available', async () => {
    const setup = extraHomey();
    const client = fixtureClient(findFixtureDevice('pyvicare/Vitocal250A_TwoCircuits').features);
    const main = await addMainDevice(setup, 'pyvicare/Vitocal250A_TwoCircuits', client);
    const circuit = await addExtraDevice(setup, 'circuit', entries('circuit', 'pyvicare/Vitocal250A_TwoCircuits')[0], client);
    const getFeatures = client.getFeatures.getMockImplementation();
    client.getFeatures.mockRejectedValueOnce(apiError({ status: 402, body: { errorType: 'PACKAGE_NOT_PAID_FOR' } }));
    await poller(setup).start();
    expect(main.setUnavailable).toHaveBeenCalledWith(expect.stringContaining('Viessmann'));
    expect(circuit.setUnavailable).toHaveBeenCalledWith(expect.stringContaining('Viessmann'));
    expect(circuit.getMonitor().health.lastError.message).toContain('402');
    client.getFeatures.mockImplementation(getFeatures);
    poller(setup).failures = 0;
    poller(setup).retryAt = 0;
    await poller(setup).start();
    expect(circuit.getAvailable()).toBe(true);
    expect(main.getAvailable()).toBe(true);
  });

  test('an extra device that fails does not fail the poll for the others', async () => {
    const setup = extraHomey();
    const client = fixtureClient(findFixtureDevice('pyvicare/Vitocal250A_TwoCircuits').features);
    const main = await addMainDevice(setup, 'pyvicare/Vitocal250A_TwoCircuits', client);
    const circuit = await addExtraDevice(setup, 'circuit', entries('circuit', 'pyvicare/Vitocal250A_TwoCircuits')[0], client);
    jest.spyOn(circuit, 'onSharedFeatures').mockRejectedValue(new Error('boom'));
    main.setUnavailable.mockClear();
    await poller(setup).start();
    expect(setup.vicare.error).toHaveBeenCalledWith('An extra device could not use a poll:', expect.any(Error));
    expect(main.setUnavailable).not.toHaveBeenCalled();
    expect(poller(setup).failures).toBe(0);
  });

  test('a device that cannot apply a poll becomes unavailable with the reason', async () => {
    const setup = extraHomey();
    const client = fixtureClient(findFixtureDevice('pyvicare/Vitocal250A_TwoCircuits').features);
    const circuit = await addExtraDevice(setup, 'circuit', entries('circuit', 'pyvicare/Vitocal250A_TwoCircuits')[0], client);
    circuit.setCapabilityValue.mockRejectedValue(new Error('storage full'));
    jest.spyOn(circuit, 'getMonitor').mockImplementation(() => {
      throw new Error('monitor broken');
    });
    expect(await circuit.onSharedFeatures(clone(findFixtureDevice('pyvicare/Vitocal250A_TwoCircuits').features))).toBe(true);
    expect(circuit.setUnavailable).toHaveBeenCalledWith('monitor broken');
  });

  test('Homey refusing the last seen time or the availability never makes a device unavailable', async () => {
    const setup = extraHomey();
    const dump = findFixtureDevice('pyvicare/Vitocal250A_TwoCircuits').features;
    const client = fixtureClient(dump);
    const circuit = await addExtraDevice(setup, 'circuit', entries('circuit', 'pyvicare/Vitocal250A_TwoCircuits')[0], client);
    circuit.setLastSeenAt.mockRejectedValue(new Error('Not Found: Device'));
    circuit.setUnavailable.mockClear();
    const changed = clone(dump);
    changed.data.find((item) => item.feature === 'heating.circuits.0.operating.modes.active').properties.value.value = 'standby';
    expect(await circuit.onSharedFeatures(changed)).toBe(true);
    expect(circuit.getCapabilityValue('thermostat_mode')).toBe('off');
    expect(circuit.setUnavailable).not.toHaveBeenCalled();
    expect(circuit.getAvailable()).toBe(true);
    expect(circuit.error).toHaveBeenCalledWith('Could not set the last seen time:', expect.any(Error));

    // Unavailable after a failed poll, and Homey refuses making it available again: logged
    circuit.__available = false;
    circuit.setAvailable.mockRejectedValue(new Error('device_not_found'));
    expect(await circuit.onSharedFeatures(clone(dump))).toBe(true);
    expect(circuit.getCapabilityValue('thermostat_mode')).toBe('heat');
    expect(circuit.error).toHaveBeenCalledWith('Could not mark device as available:', expect.any(Error));
  });

  test('data a device cannot use makes it unavailable; Homey refusing that is logged', async () => {
    const setup = extraHomey();
    const client = fixtureClient(findFixtureDevice('pyvicare/Vitocal250A_TwoCircuits').features);
    const circuit = await addExtraDevice(setup, 'circuit', entries('circuit', 'pyvicare/Vitocal250A_TwoCircuits')[0], client);
    jest.spyOn(circuit, 'readCapabilityValues').mockImplementation(() => {
      throw new Error('unusable');
    });
    circuit.setUnavailable.mockRejectedValue(new Error('device_not_found'));
    expect(await circuit.onSharedFeatures(clone(findFixtureDevice('pyvicare/Vitocal250A_TwoCircuits').features))).toBe(true);
    expect(circuit.setUnavailable).toHaveBeenCalledWith('unusable');
    expect(circuit.error).toHaveBeenCalledWith('Could not mark device as unavailable:', expect.any(Error));
    expect(circuit.setLastSeenAt).toHaveBeenCalledTimes(1);
  });

  test('joining waits for the ViCare driver when it is not ready yet', async () => {
    const setup = extraHomey();
    const client = fixtureClient(findFixtureDevice('pyvicare/Vitocal250A_TwoCircuits').features);
    const { getDriver } = setup.homey.drivers;
    setup.homey.drivers.getDriver = jest.fn(() => {
      throw new Error('not ready');
    });
    const circuit = await addExtraDevice(setup, 'circuit', entries('circuit', 'pyvicare/Vitocal250A_TwoCircuits')[0], client);
    expect(client.getFeatures).not.toHaveBeenCalled();
    const [retry, delay] = setup.homey.setTimeout.mock.calls[setup.homey.setTimeout.mock.calls.length - 1];
    expect(delay).toBe(30 * 1000);
    setup.homey.drivers.getDriver = getDriver;
    retry();
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    expect(client.getFeatures).toHaveBeenCalledTimes(1);
    expect(circuit.getCapabilityValue('thermostat_mode')).toBe('heat');
  });
});

describe('writes', () => {
  async function circuitOne() {
    const setup = extraHomey();
    const client = fixtureClient(findFixtureDevice('pyvicare/Vitocal250A_TwoCircuits').features);
    const device = await addExtraDevice(setup, 'circuit', entries('circuit', 'pyvicare/Vitocal250A_TwoCircuits')[1], client);
    return { setup, client, device };
  }

  test('the set point is written on the circuit\'s own program; a repeated value sends nothing', async () => {
    const { client, device } = await circuitOne();
    const listener = device.__listeners.get('target_temperature');
    await listener(device.getCapabilityValue('target_temperature'));
    expect(client.executeCommand).not.toHaveBeenCalled();
    await listener(23);
    expect(client.executeCommand).toHaveBeenCalledWith(expect.objectContaining({
      ...IDS, feature: 'heating.circuits.1.operating.programs.normalHeating', command: 'setTemperature', body: { targetTemperature: 23 },
    }));
    expect(device.getCapabilityValue('target_temperature')).toBe(23);
  });

  test('a set point outside the circuit\'s limits is refused before anything is sent', async () => {
    const { client, device } = await circuitOne();
    await expect(device.__listeners.get('target_temperature')(80)).rejects.toThrow();
    expect(client.executeCommand).not.toHaveBeenCalled();
  });

  test('off sets the circuit\'s standby; heat when it heats already sends nothing', async () => {
    const { client, device } = await circuitOne();
    const listener = device.__listeners.get('thermostat_mode');
    await listener('heat');
    await device.writeCapability('thermostat_mode', 'heat');
    expect(client.executeCommand).not.toHaveBeenCalled();
    await listener('off');
    expect(client.executeCommand).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'heating.circuits.1.operating.modes.active', command: 'setMode', body: { mode: 'standby' },
    }));
    expect(device.getCapabilityValue('thermostat_mode')).toBe('off');
    await expect(listener('cool')).rejects.toThrow();
    await expect(device.writeCapability('measure_temperature', 20)).rejects.toThrow('cannot be changed');
  });

  test('a write that did not take is reported once, as on the ViCare device', async () => {
    const { setup, device } = await circuitOne();
    let now = Date.parse('2026-11-26T12:00:00Z');
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    await device.__listeners.get('target_temperature')(25);
    now += 2 * MINUTE;
    await poller(setup).start();
    now += 2 * MINUTE;
    await poller(setup).start();
    expect(setup.homey.notifications.createNotification).toHaveBeenCalledTimes(1);
    expect(device.setWarning).toHaveBeenCalledWith(expect.stringContaining('25 °C'));
  });

  test('hot water off and heat again, back to the mode it had', async () => {
    const setup = extraHomey();
    const client = fixtureClient(findFixtureDevice('pyvicare/Vitocal262A_T2H-R290').features);
    const device = await addExtraDevice(setup, 'hotWater', entries('hotWater', 'pyvicare/Vitocal262A_T2H-R290')[0], client);
    expect(device.getStoreValue('lastHotWaterMode')).toBe('efficient');
    const listener = device.__listeners.get('thermostat_mode');
    await listener('off');
    expect(client.executeCommand).toHaveBeenLastCalledWith(expect.objectContaining({
      feature: 'heating.dhw.operating.modes.active', command: 'setMode', body: { mode: 'off' },
    }));
    expect(device.getCapabilityValue('thermostat_mode')).toBe('off');
    await listener('heat');
    expect(client.executeCommand).toHaveBeenLastCalledWith(expect.objectContaining({ body: { mode: 'efficient' } }));
    expect(device.getCapabilityValue('thermostat_mode')).toBe('heat');
    // Heat while it heats: nothing to send
    await device.writeCapability('thermostat_mode', 'heat');
    expect(client.executeCommand).toHaveBeenCalledTimes(2);
    await expect(device.writeCapability('thermostat_mode', 'auto')).rejects.toThrow();

    await device.__listeners.get('target_temperature')(50);
    expect(client.executeCommand).toHaveBeenLastCalledWith(expect.objectContaining({
      feature: 'heating.dhw.temperature.main', command: 'setTargetTemperature', body: { temperature: 50 },
    }));
    expect(device.getCapabilityValue('target_temperature')).toBe(50);
  });
});

describe('rooms', () => {
  test('rooms share one slow poll of the Smart Climate device, counted in the account\'s calls', async () => {
    const setup = extraHomey();
    const client = fixtureClient(findFixtureDevice('pyvicare/RoomControlOne').features);
    const [first, second, third] = entries('room', 'pyvicare/RoomControlOne', 'RoomControl-1');
    const rooms = [];
    for (const entry of [first, second, third]) rooms.push(await addExtraDevice(setup, 'room', entry, client));
    const key = pollingKey(ROOM_IDS);
    expect(setup.vicare._groupInterval(key)).toBe(ROOM_POLL_INTERVAL);
    // Rooms do not count as a heating device for the automatic interval
    expect(setup.vicare._calculatePollInterval()).toBe(2 * MINUTE);
    expect(setup.vicare.plannedCallsPerDay('session-1')).toBe(96);
    await poller(setup, key).start();
    expect(client.getFeatures).toHaveBeenCalledTimes(2);
    expect(client.getFeatures.mock.calls[1][0]).toMatchObject(ROOM_IDS);
    expect(rooms.map(values)).toEqual([
      { measure_temperature: 20.4, measure_humidity: 53, 'measure_temperature.setPoint': 20.5 },
      { measure_temperature: 20.5, measure_humidity: 45, 'measure_temperature.setPoint': 18 },
      { measure_temperature: 19.4, 'measure_temperature.setPoint': 19 },
    ]);
    expect(rooms[0].__listeners.size).toBe(0);
  });

  test('a sensor connected later gives the room its value', async () => {
    const setup = extraHomey();
    const dump = findFixtureDevice('pyvicare/RoomControlOne').features;
    const client = fixtureClient(dump);
    const room = await addExtraDevice(setup, 'room', entries('room', 'pyvicare/RoomControlOne', 'RoomControl-1')[2], client);
    expect(room.hasCapability('measure_humidity')).toBe(false);
    const connected = clone(dump);
    connected.data.find((item) => item.feature === 'rooms.2.sensors.humidity').properties = { status: { type: 'string', value: 'connected' }, value: { type: 'number', value: 48, unit: 'percent' } };
    await room.onSharedFeatures(connected);
    expect(room.getCapabilityValue('measure_humidity')).toBe(48);
    expect(room.getStoreValue('features')).toContain('rooms.2.sensors.humidity');
  });
});

describe('pairing', () => {
  const installations = (devices) => ({
    data: [{ id: IDS.installationId, gateways: [{ serial: IDS.gatewaySerial, installationId: IDS.installationId, devices }] }],
  });
  const pairingClient = (devices, dumps) => ({
    getInstallations: jest.fn(async () => installations(devices)),
    getFeatures: jest.fn(async ({ deviceId }) => clone(findFixtureDevice(dumps[deviceId]).features)),
  });
  const heating = {
    id: '0', deviceType: 'heating', modelId: 'E3_Vitocal_250', roles: ['type:heatpump'],
  };
  const roomControl = {
    id: 'RoomControl-1', deviceType: 'roomControl', modelId: 'E3_RoomControl_One_19_03', roles: [],
  };

  test('lists only what the account has, one read per Viessmann device', async () => {
    const setup = extraHomey();
    const client = pairingClient([heating, roomControl], { 0: 'pyvicare/Vitocal250A_TwoCircuits', 'RoomControl-1': 'pyvicare/RoomControlOne' });
    const circuits = await setup.extra.circuit.onPairListDevices({ oAuth2Client: client });
    expect(circuits.map((entry) => entry.name)).toEqual(['Vitocal 250 heating circuit 1', 'Vitocal 250 heating circuit 2']);
    expect(client.getFeatures).toHaveBeenCalledTimes(1);
    const rooms = await setup.extra.room.onPairListDevices({ oAuth2Client: client });
    expect(rooms.map((entry) => entry.data.id)).toEqual(['0', '1', '2'].map((room) => `${pollingKey(ROOM_IDS)}-room-${room}`));
    const [hotWater] = await setup.extra.hotWater.onPairListDevices({ oAuth2Client: client });
    expect(hotWater.name).toBe('Vitocal 250 hot water');
    // The log names models and counts, no ids
    expect(JSON.stringify(setup.extra.circuit.log.mock.calls)).not.toContain(IDS.gatewaySerial);
  });

  test('says why nothing can be added', async () => {
    const setup = extraHomey();
    await expect(setup.extra.room.onPairListDevices({ oAuth2Client: pairingClient([heating], { 0: 'pyvicare/Vitocal250A' }) }))
      .rejects.toThrow('no ViCare Smart Climate room');
    await expect(setup.extra.circuit.onPairListDevices({ oAuth2Client: pairingClient([heating], { 0: 'pyvicare/Vitocal262A_T2H-R290' }) }))
      .rejects.toThrow('no heating circuit the app can add');
    const empty = { getInstallations: jest.fn(async () => ({ data: [] })) };
    await expect(setup.extra.hotWater.onPairListDevices({ oAuth2Client: empty })).rejects.toThrow('No heating system was found');
    await expect(setup.extra.hotWater.onPairListDevices({})).rejects.toThrow('No OAuth2Client');
    const offline = pairingClient([{ ...heating, status: 'Offline' }], {});
    offline.getFeatures.mockRejectedValue(new Error('socket hang up'));
    await expect(setup.extra.circuit.onPairListDevices({ oAuth2Client: offline })).rejects.toThrow(/offline/i);
  });

  test('the first view says who needs the device and that it shares the ViCare device\'s login and data', async () => {
    const setup = extraHomey();
    const handlers = new Map();
    const socket = { setHandler: jest.fn((event, handler) => handlers.set(event, handler)) };
    OAuth2Driver.prototype.onPair = jest.fn();
    try {
      await setup.extra.hotWater.onPair(socket);
    } finally {
      delete OAuth2Driver.prototype.onPair;
    }
    expect([...handlers.keys()]).toEqual(expect.arrayContaining(['extra_intro', 'get_client_id', 'save_client_id']));
    const intro = await handlers.get('extra_intro')();
    expect(intro.title).toBe('Hot water as a thermostat');
    expect(intro.paragraphs[0]).toContain('Google Home');
    expect(intro.paragraphs[1]).toContain('no extra API calls');
    expect(setup.extra.room.introTexts().paragraphs[1]).toContain('every 15 minutes');
    expect(setup.extra.circuit.introTexts().paragraphs[0]).toContain('another zone');
  });

  test('a failing pairing is logged and rethrown', async () => {
    const setup = extraHomey();
    const socket = { setHandler: jest.fn() };
    OAuth2Driver.prototype.onPair = jest.fn(() => {
      throw new Error('pairing broke');
    });
    try {
      await expect(setup.extra.room.onPair(socket)).rejects.toThrow('pairing broke');
    } finally {
      delete OAuth2Driver.prototype.onPair;
    }
    expect(setup.extra.room.error).toHaveBeenCalledWith('Error in onPair:', expect.any(Error));
  });
});

test('the extra drivers\' pairing views are byte-identical copies of their canonical source', () => {
  // eslint-disable-next-line global-require
  const fs = require('fs');
  // eslint-disable-next-line global-require
  const path = require('path');
  // eslint-disable-next-line global-require
  const { EXTRA_DRIVERS } = require('../extraPairing');
  const drivers = path.join(__dirname, '../..');
  const read = (driver, view) => fs.readFileSync(path.join(drivers, driver, 'pair', `${view}.html`));
  // The Client ID view is the ViCare driver's; the intro view's source is the heating circuit's
  const CANONICAL = { client_id: 'vicare', intro: 'heating-circuit' };
  const stale = [];
  for (const driver of Object.values(EXTRA_DRIVERS)) {
    for (const [view, source] of Object.entries(CANONICAL)) {
      if (!read(driver, view).equals(read(source, view))) stale.push(`drivers/${driver}/pair/${view}.html (copy drivers/${source}/pair/${view}.html)`);
    }
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const compose = require(path.join(drivers, driver, 'driver.compose.json'));
    expect(compose.pair.map((view) => view.id)).toEqual(['intro', 'client_id', 'login_oauth2', 'list_devices', 'add_devices']);
  }
  if (stale.length > 0) throw new Error(`Pairing views out of date:\n  ${stale.join('\n  ')}`);
});

test('a hot water write that did not take is reported with its unit', async () => {
  const setup = extraHomey();
  const client = fixtureClient(findFixtureDevice('pyvicare/Vitocal262A_T2H-R290').features);
  const device = await addExtraDevice(setup, 'hotWater', entries('hotWater', 'pyvicare/Vitocal262A_T2H-R290')[0], client);
  let now = Date.parse('2026-11-26T12:00:00Z');
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  await device.__listeners.get('target_temperature')(50);
  for (let poll = 0; poll < 2; poll++) {
    now += 2 * MINUTE;
    await poller(setup).start();
  }
  expect(device.setWarning).toHaveBeenCalledWith(expect.stringMatching(/55 °C instead of 50 °C/));
  expect(device.getMonitor().writeProblem('thermostat_mode.unknown', 1, 2).options).toEqual({});
});

describe('health on the settings page', () => {
  // eslint-disable-next-line global-require
  const api = require('../../../api');

  test('lists the extra devices that make calls of their own, not those sharing the ViCare device\'s updates', async () => {
    const setup = extraHomey();
    setup.homey.app = { getSavedOAuth2Sessions: () => ({ 'session-1': {} }) };
    const heatPump = fixtureClient(findFixtureDevice('pyvicare/Vitocal250A_TwoCircuits').features);
    const rooms = fixtureClient(findFixtureDevice('pyvicare/RoomControlOne').features);
    const [circuitZero, circuitOne] = entries('circuit', 'pyvicare/Vitocal250A_TwoCircuits');
    await addExtraDevice(setup, 'circuit', circuitZero, heatPump);
    await addExtraDevice(setup, 'room', entries('room', 'pyvicare/RoomControlOne', 'RoomControl-1')[0], rooms);

    let health = await api.getHealth({ homey: setup.homey });
    expect(health.devices.map(({ name, intervalMinutes }) => [name, intervalMinutes])).toEqual([
      ['Vitocal 250 heating circuit 1', 2],
      ['Smart Climate room 1', 15],
    ]);
    expect(health.devices[0]).toMatchObject({
      account: 1, available: true, eventLogMinutes: 0, lastUpdateAt: expect.any(Number),
    });
    expect(health.accounts).toEqual([expect.objectContaining({ account: 1, plannedPerDay: 720 + 96, devices: 2 })]);

    // With the ViCare device, a heating circuit shares its updates: only the ViCare device is listed
    await addMainDevice(setup, 'pyvicare/Vitocal250A_TwoCircuits', heatPump);
    await addExtraDevice(setup, 'circuit', circuitOne, heatPump);
    health = await api.getHealth({ homey: setup.homey });
    expect(health.devices.map(({ name }) => name)).toEqual(['Viessmann Vitocal 250', 'Smart Climate room 1']);
    expect(health.accounts[0].plannedPerDay).toBe(720 + 96);
  });
});
