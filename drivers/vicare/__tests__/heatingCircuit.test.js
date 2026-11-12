/* eslint-env jest */

'use strict';

jest.mock('homey-oauth2app', () => ({
  OAuth2Device: class {},
  OAuth2Driver: class {},
}));

const Device = require('../device');
const Driver = require('../driver');
const { PATHS, getCapability } = require('../config');
const { detectHeatingCircuit } = require('../heatingCircuit');

function response(circuitIds) {
  return {
    data: [
      { feature: 'heating.circuits', isEnabled: true, properties: { enabled: { value: circuitIds } } },
      ...circuitIds.flatMap((id) => [
        {
          feature: `heating.circuits.${id}.operating.modes.active`,
          isEnabled: true,
          properties: { value: { value: 'forcedReduced' } },
          commands: { setMode: { params: { mode: { constraints: { enum: ['dhwAndHeating', 'forcedReduced'] } } } } },
        },
        {
          feature: `heating.circuits.${id}.operating.programs.normal`,
          isEnabled: true,
          properties: { temperature: { value: 20 } },
          commands: { setTemperature: { params: { targetTemperature: { constraints: { min: 3, max: 37 } } } } },
        },
      ]),
    ],
  };
}

function device(circuitId) {
  const result = new Device();
  result._heatingCircuitId = circuitId;
  result._roles = [];
  result.oAuth2Client = { executeCommand: jest.fn().mockResolvedValue({}), getFeatures: jest.fn() };
  result.log = jest.fn();
  result.error = jest.fn();
  result.setCapabilityValueIfPossible = jest.fn();
  result.setAvailable = jest.fn();
  result.setUnavailable = jest.fn();
  return result;
}

test.each([['0'], ['1'], ['2']])('discovers circuit %s and its modes/constraints', async (id) => {
  const driver = new Driver();
  const client = { getFeatures: jest.fn().mockResolvedValue(response([id])) };
  const metadata = await driver._getEnabledFeaturesAndOpModes(client, 'installation', 'gateway', '0');
  expect(metadata.heatingCircuitId).toBe(id);
  expect(metadata.features).toContain(PATHS.HEATING_CIRCUIT_0_MODE);
  expect(metadata.constraints[PATHS.HEATING_CIRCUIT_0_TARGET].targetTemperature.min).toBe(3);
  expect(metadata.operatingModes.map((mode) => mode.id)).toEqual(['dhwAndHeating', 'forcedReduced']);
});

test('prefers enabled circuit 0 and ignores disabled circuit 0', () => {
  expect(detectHeatingCircuit(response(['1', '0']).data)).toBe('0');
  const { data } = response(['1']);
  data.push({ feature: PATHS.HEATING_CIRCUIT_0_MODE, isEnabled: false });
  expect(detectHeatingCircuit(data)).toBe('1');
});

test.each(['0', '1'])('sends mode and temperature commands to circuit %s', async (id) => {
  const target = device(id);
  await target.executeCommand(PATHS.HEATING_CIRCUIT_0_MODE, getCapability(PATHS.HEATING_CIRCUIT_0_MODE), 'dhwAndHeating');
  expect(target.oAuth2Client.executeCommand).toHaveBeenLastCalledWith(expect.objectContaining({
    feature: `heating.circuits.${id}.operating.modes.active`, command: 'setMode', body: { mode: 'dhwAndHeating' },
  }));
  await target.executeCommand(PATHS.HEATING_CIRCUIT_0_TARGET, getCapability(PATHS.HEATING_CIRCUIT_0_TARGET), 21);
  expect(target.oAuth2Client.executeCommand).toHaveBeenLastCalledWith(expect.objectContaining({
    feature: `heating.circuits.${id}.operating.programs.normal`, command: 'setTemperature', body: { targetTemperature: 21 },
  }));
  await target.executeCommand(PATHS.HOT_WATER_TARGET, getCapability(PATHS.HOT_WATER_TARGET), 55);
  expect(target.oAuth2Client.executeCommand).toHaveBeenLastCalledWith(expect.objectContaining({ feature: PATHS.HOT_WATER_TARGET }));
});

test('polls the selected circuit and supports unfiltered discovery', async () => {
  const target = device('1');
  await target.getFeatures({ useFilter: true });
  const { filter } = target.oAuth2Client.getFeatures.mock.calls[0][0];
  expect(filter).toContain('heating.circuits.1.operating.modes.active');
  expect(filter).not.toContain('heating.circuits.0.');
  await target.getFeatures({ useFilter: false });
  expect(target.oAuth2Client.getFeatures).toHaveBeenLastCalledWith(expect.objectContaining({ filter: undefined }));
});

test('updates readings only from the selected circuit without mutating API data', async () => {
  const target = device('1');
  const input = response(['0', '1']);
  await target.onFeaturesUpdated(input, false);
  expect(target.setCapabilityValueIfPossible.mock.calls).toEqual([
    ['thermostat_mode.heating', 'forcedReduced'],
    ['target_temperature.heating', 20],
  ]);
  expect(input.data[3].feature).toContain('heating.circuits.1.');
});

test('refreshes an existing pairing once without changing device identity', async () => {
  const target = device('1');
  const store = {
    installationId: 'installation', gatewaySerial: 'gateway', deviceId: '0', version: '1.0.10',
  };
  target.getStoreValue = (key) => store[key];
  target.setStoreValue = jest.fn(async (key, value) => {
    store[key] = value;
  });
  const metadata = {
    commandMetadata: {}, heatingCircuitId: '1', features: [PATHS.HEATING_CIRCUIT_0_MODE], constraints: {}, operatingModes: [],
  };
  target.driver = { _getEnabledFeaturesAndOpModes: jest.fn().mockResolvedValue(metadata) };
  await target.checkUpgradeSpecifics();
  await target.checkUpgradeSpecifics();
  expect(target.driver._getEnabledFeaturesAndOpModes).toHaveBeenCalledTimes(1);
  expect(store.heatingCircuitId).toBe('1');
  expect(store.deviceId).toBe('0');
});

test('mode options remain independent between devices', async () => {
  const sharedOptions = { values: [{ id: 'standby' }] };
  const first = device('0');
  const second = device('1');
  for (const target of [first, second]) {
    target.getCapabilityOptions = () => sharedOptions;
    target.setCapabilityOptions = jest.fn();
  }
  first._operatingModes = [{ id: 'dhw' }];
  second._operatingModes = [{ id: 'forcedReduced' }];
  await first.initializeOperatingModes();
  await second.initializeOperatingModes();
  expect(first.setCapabilityOptions.mock.calls[0][1].values).toEqual([{ id: 'dhw' }]);
  expect(second.setCapabilityOptions.mock.calls[0][1].values).toEqual([{ id: 'forcedReduced' }]);
  expect(sharedOptions.values).toEqual([{ id: 'standby' }]);
});

test('reports unsupported modes before sending an API request', async () => {
  const target = device('1');
  target._operatingModes = [{ id: 'dhwAndHeating' }];
  await expect(target.executeCommand(PATHS.HEATING_CIRCUIT_0_MODE, getCapability(PATHS.HEATING_CIRCUIT_0_MODE), 'heating'))
    .rejects.toThrow('not supported');
  expect(target.oAuth2Client.executeCommand).not.toHaveBeenCalled();
});

test('existing Flow action resolves the paired device circuit', async () => {
  const driver = new Driver();
  const listeners = {};
  driver.log = jest.fn();
  driver.error = jest.fn();
  driver.homey = {
    flow: {
      getConditionCard: () => ({ registerRunListener: jest.fn() }),
      getActionCard: (id) => ({
        registerRunListener: (listener) => {
          listeners[id] = listener;
        },
      }),
    },
  };
  driver._registerFlowCards();
  const target = device('1');
  await listeners['set-operating-mode']({ device: target, mode: 'dhwAndHeating' });
  expect(target.oAuth2Client.executeCommand).toHaveBeenCalledWith(expect.objectContaining({
    feature: 'heating.circuits.1.operating.modes.active',
    body: { mode: 'dhwAndHeating' },
  }));
});

test('pairing stores the discovered circuit with unchanged device identity', async () => {
  const driver = new Driver();
  driver.log = jest.fn();
  driver.error = jest.fn();
  driver.homey = { manifest: { version: '1.0.10' } };
  const client = {
    getFeatures: jest.fn().mockResolvedValue(response(['1'])),
    getInstallations: jest.fn().mockResolvedValue({
      data: [{
        gateways: [{
          installationId: 'installation',
          serial: 'gateway',
          devices: [{ id: '0', deviceType: 'heating', roles: [] }],
        }],
      }],
    }),
  };
  const paired = await driver.onPairListDevices({ oAuth2Client: client });
  expect(paired[0].data.id).toBe('installation-gateway-0');
  expect(paired[0].store.heatingCircuitId).toBe('1');
  expect(paired[0].store.operatingModes.map((mode) => mode.id)).toContain('forcedReduced');
});

test('explicit circuit selection overrides automatic circuit 0 preference', () => {
  expect(detectHeatingCircuit(response(['0', '1']).data, '1')).toBe('1');
  expect(() => detectHeatingCircuit(response(['0']).data, '1')).toThrow('not enabled');
});

test('changing the circuit setting refreshes metadata and restarts polling', async () => {
  const target = device('0');
  const metadata = {
    heatingCircuitId: '1', features: [], constraints: {}, operatingModes: [], commandMetadata: {},
  };
  target.driver = {
    _getEnabledFeaturesAndOpModes: jest.fn().mockResolvedValue(metadata),
    _stopPolling: jest.fn(),
    _startPolling: jest.fn(),
  };
  target.setStoreValue = jest.fn();
  target.initializeCapabilities = jest.fn();
  target.updateCapabilityOptions = jest.fn();
  target.initializeOperatingModes = jest.fn();
  target.registerCapabilityListeners = jest.fn();
  await target.onSettings({ changedKeys: ['heatingCircuit'], newSettings: { heatingCircuit: '1' } });
  expect(target.driver._getEnabledFeaturesAndOpModes.mock.calls[0][4]).toBe('1');
  expect(target._heatingCircuitId).toBe('1');
  expect(target.setStoreValue).toHaveBeenCalledWith('heatingCircuitId', '1');
  expect(target.driver._stopPolling).toHaveBeenCalledTimes(1);
  expect(target.driver._startPolling).toHaveBeenCalledTimes(1);
});

test('invalid circuit settings leave the current device untouched', async () => {
  const target = device('0');
  target.driver = { _stopPolling: jest.fn() };
  await expect(target.onSettings({ changedKeys: ['heatingCircuit'], newSettings: { heatingCircuit: '../1' } })).rejects.toThrow('Enter auto');
  expect(target._heatingCircuitId).toBe('0');
  expect(target.driver._stopPolling).not.toHaveBeenCalled();
});

test('unavailable commands and rejected API results never update the displayed state', async () => {
  const target = device('1');
  const capability = getCapability(PATHS.HEATING_CIRCUIT_0_MODE);
  target._commands = { [PATHS.HEATING_CIRCUIT_0_MODE]: { setMode: { isExecutable: false } } };
  await expect(target.executeCommand(PATHS.HEATING_CIRCUIT_0_MODE, capability, 'dhwAndHeating')).rejects.toThrow('currently unavailable');
  expect(target.oAuth2Client.executeCommand).not.toHaveBeenCalled();
  target._commands[PATHS.HEATING_CIRCUIT_0_MODE].setMode.isExecutable = true;
  target.oAuth2Client.executeCommand.mockResolvedValue({ data: { success: false, reason: 'DEVICE_BUSY' } });
  await expect(target.executeCommand(PATHS.HEATING_CIRCUIT_0_MODE, capability, 'dhwAndHeating')).rejects.toThrow('DEVICE_BUSY');
  expect(target.setCapabilityValueIfPossible).not.toHaveBeenCalled();
});
