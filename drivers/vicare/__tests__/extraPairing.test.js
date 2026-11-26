/* eslint-env jest */

'use strict';

// The device list of the extra devices (extraPairing.js): which Viessmann devices can have them,
// one entry per enabled heating circuit, one for hot water and one per room with a temperature,
// their names, data.ids and what they store.

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const {
  extraDataId, sourceDevices, extraEntries, withUniqueNames, circuitName, heatingDeviceName,
} = require('../extraPairing');
const { translate } = require('../../../lib/errorMessages');
const { findFixtureDevice, FIXTURES_DIR } = require('../../../test/helpers/fixtureDevices');

const t = (key, tags) => translate(undefined, key, tags);
const IDS = { installationId: 900001, gatewaySerial: '9999000000000001', deviceId: '0' };
const sourceOf = (deviceId = '0', modelId = 'E3_Vitocal_250') => ({
  gateway: { installationId: IDS.installationId, serial: IDS.gatewaySerial },
  device: { id: deviceId, modelId, roles: ['type:heatpump'] },
});
const entriesOf = (kind, fixture, source = sourceOf()) => extraEntries(kind, source, findFixtureDevice(fixture).features, { t, version: '2.0.0' });

test('data.ids: the Viessmann device\'s id with the kind and the circuit or room', () => {
  expect(extraDataId('circuit', IDS, '1')).toBe('900001-9999000000000001-0-circuit-1');
  expect(extraDataId('hotWater', IDS)).toBe('900001-9999000000000001-0-hotwater');
  expect(extraDataId('room', { ...IDS, deviceId: 'RoomControl-1' }, '2')).toBe('900001-9999000000000001-RoomControl-1-room-2');
});

test('circuits and hot water are listed for heating devices, rooms for the Smart Climate device', () => {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const dump = require(`${FIXTURES_DIR}/vitodens_200_e3_installations.json`);
  const installations = Array.isArray(dump) ? { data: dump } : dump;
  expect(sourceDevices('circuit', installations).map(({ device }) => device.id)).toEqual(['0']);
  expect(sourceDevices('hotWater', installations).map(({ device }) => device.id)).toEqual(['0']);
  expect(sourceDevices('room', installations).map(({ device }) => device.id)).toEqual(['RoomControl-1']);
  expect(sourceDevices('room', { data: 'nonsense' })).toEqual([]);
});

test('one thermostat per enabled heating circuit, named after the model and the circuit', () => {
  const entries = entriesOf('circuit', 'pyvicare/Vitocal250A_TwoCircuits');
  expect(entries.map((entry) => [entry.name, entry.data.id])).toEqual([
    ['Vitocal 250 heating circuit 1', '900001-9999000000000001-0-circuit-0'],
    ['Vitocal 250 heating circuit 2', '900001-9999000000000001-0-circuit-1'],
  ]);
  const [, second] = entries;
  expect(second.capabilities).toEqual(['target_temperature', 'thermostat_mode', 'thermostat_mode.heating', 'thermostat_mode.heatingProgram']);
  expect(second.capabilitiesOptions.target_temperature).toMatchObject({ min: 3, max: 37 });
  expect(second.store).toMatchObject({
    ...IDS, heatingCircuitId: '1', roles: ['type:heatpump'], version: '2.0.0',
  });
  // Only what the thermostat needs, on the circuit-normalized paths
  expect(second.store.features.every((path) => path.startsWith('heating.circuits.0.'))).toBe(true);
  expect(Object.keys(second.store.commandMetadata).every((path) => second.store.features.includes(path))).toBe(true);
  expect(second.store.operatingModes.map((mode) => mode.id)).toEqual(['heating', 'standby']);
  // The programs it can switch to, with their commands
  expect(second.store.features).toEqual(expect.arrayContaining([
    'heating.circuits.0.operating.programs.active', 'heating.circuits.0.operating.programs.comfortHeating', 'heating.circuits.0.operating.programs.reducedHeating',
  ]));
  expect(Object.keys(second.store.commandMetadata['heating.circuits.0.operating.programs.comfortHeating'])).toEqual(expect.arrayContaining(['activate', 'deactivate']));
  expect(second.store.features.some((path) => path.includes('Cooling') || path.includes('summerEco'))).toBe(false);
});

test('a device with only its second circuit (API index 1) gets a thermostat for it, named circuit 2', () => {
  expect(entriesOf('circuit', 'pyvicare/Vitocal200S-with-Vitovent300W').map((entry) => [entry.name, entry.data.id]))
    .toEqual([['Vitocal 250 heating circuit 2', '900001-9999000000000001-0-circuit-1']]);
});

test('a hot water heat pump without heating circuits gets hot water only', () => {
  expect(entriesOf('circuit', 'pyvicare/Vitocal262A_T2H-R290')).toEqual([]);
  const [hotWater] = entriesOf('hotWater', 'pyvicare/Vitocal262A_T2H-R290', sourceOf('0', 'E3_Vitocal_262'));
  expect(hotWater.name).toBe('Vitocal 262 hot water');
  expect(hotWater.capabilities).toEqual(['target_temperature', 'measure_temperature', 'thermostat_mode']);
  expect(hotWater.store.features.every((path) => path.startsWith('heating.dhw.'))).toBe(true);
  expect(hotWater.store.operatingModes).toBeUndefined();
});

test('a device without a hot water set point and an installation without rooms list nothing', () => {
  expect(entriesOf('hotWater', 'pyvicare/Vitocal200S_AWB-M-E-AC-201.D10')).toEqual([]);
  expect(entriesOf('room', 'pyvicare/Vitocal250A')).toEqual([]);
});

test('one device per room with a temperature, numbered from 1', () => {
  const rooms = entriesOf('room', 'pyvicare/RoomControlOne', sourceOf('RoomControl-1', 'E3_RoomControl_One_19_03'));
  expect(rooms.map((entry) => [entry.name, entry.data.id, entry.capabilities])).toEqual([
    ['Smart Climate room 1', '900001-9999000000000001-RoomControl-1-room-0', ['measure_temperature', 'measure_humidity', 'measure_temperature.setPoint']],
    ['Smart Climate room 2', '900001-9999000000000001-RoomControl-1-room-1', ['measure_temperature', 'measure_humidity', 'measure_temperature.setPoint']],
    // Its humidity sensor is not connected
    ['Smart Climate room 3', '900001-9999000000000001-RoomControl-1-room-2', ['measure_temperature', 'measure_temperature.setPoint']],
  ]);
  expect(rooms[2].store).toMatchObject({ deviceId: 'RoomControl-1', roomId: '2' });
  expect(rooms[2].store.heatingCircuitId).toBeUndefined();
  expect(rooms[2].store.features.every((path) => path.startsWith('rooms.2.'))).toBe(true);
});

test('a circuit\'s own name is added; Viessmann\'s default name is not', () => {
  const data = [
    { feature: 'heating.circuits.0', properties: { name: { value: 'Heating circuit 0' } } },
    { feature: 'heating.circuits.1', properties: { name: { value: '' } } },
    { feature: 'heating.circuits.1.name', properties: { name: { value: ' Floor heating ' } } },
  ];
  expect(circuitName(data, '0')).toBeUndefined();
  expect(circuitName([{ feature: 'heating.circuits.0', properties: { name: { value: 'Heizkreis 1' } } }], '0')).toBeUndefined();
  expect(circuitName(data, '1')).toBe('Floor heating');
  expect(circuitName(data, '2')).toBeUndefined();
  const raw = findFixtureDevice('pyvicare/Vitocal250A_TwoCircuits').features;
  const named = { ...raw, data: raw.data.map((item) => (item.feature === 'heating.circuits.1' ? { ...item, properties: { ...item.properties, name: { type: 'string', value: 'Upstairs' } } } : item)) };
  expect(extraEntries('circuit', sourceOf(), named, { t, version: '2.0.0' })[1].name).toBe('Vitocal 250 heating circuit 2 (Upstairs)');
});

test('without a product name the model is what the device is', () => {
  expect(heatingDeviceName({ modelId: 'E3_Vitodens_200_0821' }, t)).toBe('Vitodens 200');
  expect(heatingDeviceName({ modelId: 'CU401B_S_64', roles: ['type:heatpump'] }, t)).toBe('Viessmann heat pump');
});

test('two devices of the same name are numbered', () => {
  const named = (name) => ({ name, data: { id: name } });
  expect(withUniqueNames([named('Vitocal 250 hot water'), named('Vitocal 250 hot water'), named('Other')]).map((entry) => entry.name))
    .toEqual(['Vitocal 250 hot water', 'Vitocal 250 hot water 2', 'Other']);
});
