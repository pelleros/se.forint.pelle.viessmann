/* eslint-env jest */

'use strict';

// The pairing views (pairSession.js, wired in driver.js): the Client ID view (asks when none is
// saved), the check after the login (what the account has, or why nothing can be added) with the
// report for the developer, and the device list, which reuses the check's API reads. Also the
// names new devices get.

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const { OAuth2Driver } = require('homey-oauth2app');
const Driver = require('../driver');
const { apiError } = require('../../../lib/apiError');
const { BEGIN } = require('../../../lib/report');

const {
  modelName, deviceName, checkInstallations, summarizeInstallations, heatingDevices, reportedOffline, featureReadError, pairedDevice, pairingError,
} = require('../pairSession');
const { translate } = require('../../../lib/errorMessages');

const clone = (value) => JSON.parse(JSON.stringify(value));

const HEATING = {
  id: '0', deviceType: 'heating', modelId: 'E3_Vitocal_25x', roles: ['type:heatpump'],
};
const installations = (devices = [HEATING]) => ({
  data: [{ id: 1234567, gateways: [{ serial: '7637415022052208', installationId: 1234567, devices }] }],
});

// The SDK's onPair registers a device list handler that lists with the pairing's client
function sdkOnPair(client) {
  return function onPair(socket) {
    socket.setHandler('list_devices', async () => this.onPairListDevices({ oAuth2Client: client }));
    socket.setHandler('showView', async () => {});
  };
}

function fakeSocket() {
  const handlers = new Map();
  const socket = {
    handlers,
    setHandler: jest.fn((event, handler) => {
      handlers.set(event, handler);
      return socket;
    }),
    call: (event, data) => handlers.get(event)(data),
  };
  return socket;
}

async function startPairing({
  devices = [HEATING], clientId = 'abcdef0123456789', failFeatures, response = installations(devices),
} = {}) {
  const client = {
    getInstallations: jest.fn(async () => clone(response)),
    getFeatures: jest.fn(async () => {
      if (failFeatures) throw failFeatures;
      return { data: [{ feature: 'heating.dhw.sensors.temperature.dhwCylinder', isEnabled: true, properties: { value: { value: 48 } } }] };
    }),
  };
  OAuth2Driver.prototype.onPair = sdkOnPair(client);
  const driver = new Driver();
  const settings = new Map(clientId ? [['clientId', clientId]] : []);
  driver.homey = {
    ...driver.homey,
    manifest: { version: '2.0.0' },
    settings: { get: (key) => settings.get(key), set: jest.fn((key, value) => settings.set(key, value)) },
    app: { getConfig: () => ({ redirectUrl: 'https://callback.athom.com/oauth2/callback' }) },
  };
  driver.once = jest.fn();
  const socket = fakeSocket();
  await driver.onPair(socket);
  return {
    driver, socket, client, settings,
  };
}

afterEach(() => {
  delete OAuth2Driver.prototype.onPair;
});

describe('device names', () => {
  test.each([
    ['E3_Vitodens_200_0821', 'Vitodens 200'],
    ['E3_Vitovalor_PT2_0620', 'Vitovalor PT2'],
    ['E3_Vitocal_25x', 'Vitocal 25x'],
    ['E3_TCU19_x05', undefined],
    ['CU401B_S_64', undefined],
    ['VScotHO1_200_11', undefined],
    [undefined, undefined],
  ])('%s is %s', (modelId, name) => {
    expect(modelName(modelId)).toBe(name);
  });

  test('a second device of the same model gets a number; unknown models are named after what they are', () => {
    const t = (key) => ({
      'pair.device_name.heat_pump': 'Viessmann heat pump',
      'pair.device_name.fuel_cell': 'Viessmann fuel cell',
      'pair.device_name.boiler': 'Viessmann boiler',
      'pair.device_name.other': 'Viessmann heating',
    }[key]);
    expect(deviceName({ modelId: 'E3_Vitodens_200_0821' }, ['Viessmann Vitodens 200'], t)).toBe('Viessmann Vitodens 200 2');
    expect(deviceName({ modelId: 'CU401B_S_64', roles: ['type:heatpump'] }, [], t)).toBe('Viessmann heat pump');
    expect(deviceName({ modelId: 'x', roles: ['type:fuelcell'] }, [], t)).toBe('Viessmann fuel cell');
    expect(deviceName({ roles: ['type:boiler'] }, [], t)).toBe('Viessmann boiler');
    expect(deviceName({ roles: [] }, [], t)).toBe('Viessmann heating');
  });

  test('an account without anything to add gets a specific message', () => {
    const t = (key, tags) => `${key} ${JSON.stringify(tags || {})}`;
    expect(() => checkInstallations({ data: [] }, t)).toThrow('pair.no_installations');
    expect(() => checkInstallations({ data: [{ gateways: [{ devices: [{ deviceType: 'tcu', modelId: 'E3_TCU19_x05' }] }] }] }, t))
      .toThrow('pair.no_heating_device {"types":"tcu E3_TCU19_x05"}');
    expect(() => checkInstallations({ data: [{ gateways: [{ devices: [{ deviceType: 'heating' }] }] }] }, t)).not.toThrow();
  });
});

describe('Client ID view', () => {
  test('says whether a Client ID is saved, with the redirect URI to enter', async () => {
    const saved = await startPairing();
    await expect(saved.socket.call('get_client_id')).resolves.toEqual({ saved: true, redirectUri: 'https://callback.athom.com/oauth2/callback' });
    const missing = await startPairing({ clientId: null });
    await expect(missing.socket.call('get_client_id')).resolves.toMatchObject({ saved: false });
  });

  test('saves a plausible Client ID and refuses anything else', async () => {
    const { socket, settings } = await startPairing({ clientId: null });
    await expect(socket.call('save_client_id', 'with space')).rejects.toThrow('does not look like a Client ID');
    await expect(socket.call('save_client_id', 'short')).rejects.toThrow('does not look like a Client ID');
    await expect(socket.call('save_client_id', '  0123456789abcdef0123456789abcdef  ')).resolves.toBe(true);
    expect(settings.get('clientId')).toBe('0123456789abcdef0123456789abcdef');
  });
});

describe('check after the login', () => {
  test('lists the devices, and the device list reuses that read', async () => {
    const { socket, client } = await startPairing();
    await expect(socket.call('pair_check')).resolves.toEqual({ devices: ['Viessmann Vitocal 25x'], error: null });
    const listed = await socket.call('list_devices');
    expect(listed).toEqual([expect.objectContaining({ name: 'Viessmann Vitocal 25x', data: { id: '1234567-7637415022052208-0' } })]);
    expect(client.getInstallations).toHaveBeenCalledTimes(1);
    expect(client.getFeatures).toHaveBeenCalledTimes(1);
  });

  test('says specifically why nothing can be added', async () => {
    const none = await startPairing({ response: { data: [] } });
    await expect(none.socket.call('pair_check')).resolves.toEqual({ devices: [], error: expect.stringContaining('No heating system was found') });
    const empty = await startPairing({ devices: [] });
    await expect(empty.socket.call('pair_check')).resolves.toEqual({ devices: [], error: expect.stringContaining('(found: –)') });
    const radiators = await startPairing({ devices: [{ id: 'RoomControl-1', deviceType: 'roomControl', modelId: 'E3_RoomControl_One_19_03' }] });
    await expect(radiators.socket.call('pair_check')).resolves.toEqual({
      devices: [], error: expect.stringContaining('(found: roomControl E3_RoomControl_One_19_03)'),
    });
    const refused = await startPairing({ failFeatures: apiError({ status: 402, body: { errorType: 'PACKAGE_NOT_PAID_FOR' } }) });
    await expect(refused.socket.call('pair_check')).resolves.toEqual({ devices: [], error: expect.stringContaining('Viessmann is refusing access') });
  });

  test('retrying reads again', async () => {
    const { socket, client } = await startPairing();
    await socket.call('pair_check');
    await socket.call('pair_check');
    expect(client.getInstallations).toHaveBeenCalledTimes(2);
  });

  test('prepares the report with only a login, also when nothing can be added', async () => {
    const { driver, socket, client } = await startPairing({ failFeatures: apiError({ status: 402 }) });
    await socket.call('pair_check');
    const { report, summaryLines } = await socket.call('prepare_report');
    expect(report.devices).toEqual([expect.objectContaining({ deviceType: 'heating', error: expect.objectContaining({ status: 402 }) })]);
    expect(summaryLines).toBeGreaterThan(2);
    expect(driver.log).toHaveBeenCalledWith(expect.stringContaining(BEGIN));
    expect(JSON.stringify(driver.log.mock.calls)).not.toContain('7637415022052208');
    expect(client.getInstallations).toHaveBeenCalledTimes(2);
  });

  test('the report needs the login first', async () => {
    const { socket } = await startPairing();
    await expect(socket.call('prepare_report')).rejects.toThrow('Log in to Viessmann first');
  });
});

describe('the device list', () => {
  const GATEWAY = { installationId: 1234567, serial: '7637415022052208', aggregatedStatus: 'WorksProperly' };

  test('offers the heating devices of every gateway, in the order of the installations', () => {
    const boiler = { id: '1', deviceType: 'heating' };
    const room = { id: 'RoomControl-1', deviceType: 'roomControl' };
    const response = {
      data: [{ gateways: [{ ...GATEWAY, devices: [HEATING, room] }] }, { gateways: [{ ...GATEWAY, serial: '2', devices: [boiler] }] }],
    };
    expect([...heatingDevices(response)].map(({ gateway, device }) => `${gateway.serial}/${device.id}`))
      .toEqual(['7637415022052208/0', '2/1']);
  });

  test('the log says what the account has, without ids', () => {
    expect(summarizeInstallations(installations([HEATING, { id: 'gateway', deviceType: 'tcu' }])))
      .toBe('1 installation(s), 1 gateway(s): unknown type, 2 device(s): heating E3_Vitocal_25x, tcu');
    expect(summarizeInstallations(undefined)).toBe('0 installation(s), 0 gateway(s), 0 device(s)');
  });

  test('an entry has the frozen data id and the store keys of every pairing', () => {
    const metadata = {
      features: ['a'], constraints: { a: {} }, operatingModes: [{ id: 'dhw' }], heatingCircuitId: '0', commandMetadata: { a: {} },
    };
    const entry = pairedDevice(GATEWAY, HEATING, metadata, { name: 'Viessmann Vitocal 25x', version: '2.0.0' });
    expect(entry).toEqual({
      name: 'Viessmann Vitocal 25x',
      data: { id: '1234567-7637415022052208-0' },
      store: {
        installationId: 1234567,
        gatewaySerial: '7637415022052208',
        deviceId: '0',
        roles: ['type:heatpump'],
        ...metadata,
        version: '2.0.0',
      },
    });
    expect(Object.keys(entry.store)).toEqual([
      'installationId', 'gatewaySerial', 'deviceId', 'roles', 'features', 'constraints', 'operatingModes', 'heatingCircuitId', 'commandMetadata', 'version',
    ]);
  });

  test('a device whose features cannot be read on a gateway the list reports offline is a gateway offline error', () => {
    const offline = { ...GATEWAY, aggregatedStatus: 'Offline' };
    expect(reportedOffline(offline, HEATING)).toBe(true);
    expect(reportedOffline(GATEWAY, { ...HEATING, status: 'offline' })).toBe(true);
    expect(reportedOffline(GATEWAY, HEATING)).toBe(false);

    const timeout = new Error('timeout');
    expect(featureReadError(timeout, offline, HEATING)).toMatchObject({ message: 'Gateway offline: timeout', apiReason: 'GATEWAY_OFFLINE', cause: timeout });
    expect(featureReadError(timeout, GATEWAY, HEATING)).toBe(timeout);
    // An error that already says what is wrong stays as it is
    const refused = apiError({ status: 402 });
    expect(featureReadError(refused, offline, HEATING)).toBe(refused);
  });

  test('a known error state is shown translated while adding a device; other errors stay as they are', () => {
    const homey = {};
    const refused = apiError({ status: 402 });
    expect(pairingError(homey, refused)).toMatchObject({ message: translate(homey, 'pair.package_not_paid'), cause: refused });
    const limited = Object.assign(apiError({ status: 429 }), { retryAfterMs: 60000 });
    expect(pairingError(homey, limited, 0).message).toBe(translate(homey, 'pair.api_limit', { time: '00:01 UTC' }));
    const other = new Error('other');
    expect(pairingError(homey, other)).toBe(other);
  });
});
