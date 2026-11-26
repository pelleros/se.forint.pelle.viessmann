/* eslint-env jest */

'use strict';

// What the extra devices show (extraProfiles.js): capabilities from the stored features, options
// with the device's limits, the paths a poll needs, the part of a response a device reads, its
// values, and what a write sends.

const {
  capabilitiesFor, optionsFor, pollPaths, responseFor, newPaths, valuesFor, writableCapability, shownFrom,
  hotWaterModes, hotWaterModeFor, profileOf,
} = require('../extraProfiles');
const { readDeviceMetadata } = require('../deviceMetadata');
const { featureMapper } = require('../featureMapper');
const { findFixtureDevice } = require('../../../test/helpers/fixtureDevices');

const features = (name) => findFixtureDevice(name).features;
const metadata = (name, circuit = 'auto') => readDeviceMetadata(features(name), circuit);
const readings = (response) => featureMapper.readValues(response, []);

const feature = (path, properties, extra = {}) => ({
  feature: path, isEnabled: true, properties, commands: {}, ...extra,
});

describe('heating circuit', () => {
  test('gets a set point and the standard mode; a room temperature only from a room sensor', () => {
    expect(capabilitiesFor('circuit', metadata('pyvicare/Vitocal250A_TwoCircuits', '1'))).toEqual(['target_temperature', 'thermostat_mode']);
    // Vitodens 200 (2016) has a room sensor
    const withRoom = metadata('vitodens_200_2016');
    expect(withRoom.features).toContain('heating.circuits.0.sensors.temperature.room');
    expect(capabilitiesFor('circuit', withRoom)).toEqual(['target_temperature', 'measure_temperature', 'thermostat_mode']);
  });

  test('the set point has the device\'s limits; the modes are standard ones, cool and auto only where it can cool', () => {
    const heatOnly = optionsFor('circuit', metadata('pyvicare/Vitocal250A_TwoCircuits', '1'));
    expect(heatOnly.target_temperature).toMatchObject({
      min: 3, max: 37, step: 1, units: '°C',
    });
    expect(heatOnly.thermostat_mode.values.map((value) => value.id)).toEqual(['heat', 'off']);
    expect(heatOnly.thermostat_mode.uiComponent).toBeUndefined();
    const cooling = optionsFor('circuit', metadata('pyvicare/Vitocal151A'));
    expect(cooling.thermostat_mode.values.map((value) => value.id)).toEqual(['heat', 'cool', 'auto', 'off']);
  });

  test('a poll needs the circuit\'s set point, mode and room temperature, on its circuit', () => {
    expect(pollPaths('circuit', { heatingCircuitId: '1' })).toEqual([
      'heating.circuits.1.operating.programs.normal',
      'heating.circuits.1.operating.programs.normalHeating',
      'heating.circuits.1.sensors.temperature.room',
      'heating.circuits.1.operating.modes.active',
    ]);
  });

  test('reads its own circuit only; a response without it says nothing', () => {
    const raw = features('pyvicare/Vitocal250A_TwoCircuits');
    const response = responseFor('circuit', { heatingCircuitId: '1' }, raw);
    const ownPaths = pollPaths('circuit', { heatingCircuitId: '1' });
    const circuitOne = raw.data.filter((item) => ownPaths.includes(item.feature));
    expect(response.data).toEqual(circuitOne.map((item) => ({ ...item, feature: item.feature.replace('circuits.1.', 'circuits.0.') })));
    expect(responseFor('circuit', { heatingCircuitId: '1' }, { data: raw.data.filter((item) => !item.feature.startsWith('heating.circuits.1')) })).toBeNull();
    expect(responseFor('circuit', { heatingCircuitId: '0' }, { data: 'nonsense' })).toBeNull();
  });

  test('values: the set point and the standard mode of the circuit\'s mode', () => {
    const context = metadata('pyvicare/Vitocal250A_TwoCircuits', '1');
    const response = responseFor('circuit', context, features('pyvicare/Vitocal250A_TwoCircuits'));
    const values = valuesFor('circuit', context, response, readings(response));
    expect(values.get('target_temperature').value).toEqual(expect.any(Number));
    expect(values.get('thermostat_mode')).toEqual({ value: 'heat', gone: false });
  });

  test('writes go through the configured thermostat; the room temperature cannot be written', () => {
    const context = metadata('pyvicare/Vitocal250A_TwoCircuits', '1');
    expect(writableCapability('circuit', context, 'target_temperature').source).toBe('target_temperature');
    expect(writableCapability('circuit', context, 'thermostat_mode').source).toBe('thermostat_mode');
    expect(writableCapability('circuit', context, 'measure_temperature')).toBeUndefined();
    expect(shownFrom('circuit', context, 'thermostat_mode', 'off')).toEqual([{ name: 'thermostat_mode', value: 'off' }]);
    expect(shownFrom('circuit', context, 'thermostat_mode.heating', 'standby')).toEqual([]);
  });

  test('a room sensor connected later is new; one not connected is not', () => {
    const context = { heatingCircuitId: '0', features: ['heating.circuits.0.operating.programs.normal'] };
    const room = feature('heating.circuits.0.sensors.temperature.room', { status: { value: 'connected' }, value: { value: 21 } });
    expect(newPaths('circuit', context, { data: [room, room] })).toEqual(['heating.circuits.0.sensors.temperature.room']);
    const notConnected = feature('heating.circuits.0.sensors.temperature.room', { status: { value: 'notConnected' } });
    expect(newPaths('circuit', context, { data: [notConnected] })).toEqual([]);
  });
});

describe('hot water', () => {
  test('a set point with the API\'s limits, the cylinder temperature, and heat/off where hot water can be switched off', () => {
    const context = metadata('pyvicare/Vitocal262A_T2H-R290');
    expect(hotWaterModes(context)).toEqual(['efficient', 'off']);
    expect(capabilitiesFor('hotWater', context)).toEqual(['target_temperature', 'measure_temperature', 'thermostat_mode']);
    const options = optionsFor('hotWater', context);
    expect(options.target_temperature).toMatchObject({ units: '°C', min: expect.any(Number), max: expect.any(Number) });
    expect(options.thermostat_mode.values.map((value) => value.id)).toEqual(['heat', 'off']);
    // Without an off mode: no thermostat mode (heat only)
    expect(capabilitiesFor('hotWater', metadata('vitocal_222'))).toEqual(['target_temperature', 'measure_temperature']);
  });

  test('values: off is off, every other mode heats', () => {
    const context = metadata('pyvicare/Vitocal262A_T2H-R290');
    const response = responseFor('hotWater', context, features('pyvicare/Vitocal262A_T2H-R290'));
    const values = valuesFor('hotWater', context, response, readings(response));
    expect(values.get('thermostat_mode')).toEqual({ value: 'heat', gone: false });
    expect(values.get('measure_temperature').value).toBe(55.3);
    const off = new Map([['thermostat_mode.hotWater', { value: 'off', gone: false }]]);
    expect(valuesFor('hotWater', context, response, off).get('thermostat_mode').value).toBe('off');
    expect(shownFrom('hotWater', context, 'thermostat_mode.hotWater', 'efficient')).toEqual([{ name: 'thermostat_mode', value: 'heat' }]);
  });

  test('heat switches back to the mode before off, else the first mode the device offers', () => {
    const context = { constraints: { 'heating.dhw.operating.modes.active': { mode: { enum: ['efficientWithMinComfort', 'efficient', 'off'] } } } };
    expect(hotWaterModeFor('off', { current: 'efficient', context })).toBe('off');
    expect(hotWaterModeFor('off', { current: 'off', context })).toBeNull();
    expect(hotWaterModeFor('heat', { current: 'efficient', context })).toBeNull();
    expect(hotWaterModeFor('heat', { current: 'off', lastOnMode: 'efficient', context })).toBe('efficient');
    expect(hotWaterModeFor('heat', { current: 'off', lastOnMode: 'comfort', context })).toBe('efficientWithMinComfort');
    expect(hotWaterModeFor('heat', { current: undefined, context })).toBe('efficientWithMinComfort');
    expect(() => hotWaterModeFor('cool', { current: 'off', context })).toThrow('Unknown thermostat mode');
    expect(() => hotWaterModeFor('heat', { current: 'off', context: { constraints: {} } })).toThrow(expect.objectContaining({ code: 'mode_not_available' }));
    const write = writableCapability('hotWater', context, 'thermostat_mode');
    expect(write.toSource('heat', { current: 'off', lastOnMode: 'efficient', context })).toBe('efficient');
  });
});

describe('room', () => {
  test('temperature, humidity where connected, and the set point (heating level, else normal level)', () => {
    const one = features('pyvicare/RoomControlOne');
    const connected = one.data.filter((item) => item.isEnabled && item.properties?.status?.value !== 'notConnected').map((item) => item.feature);
    expect(capabilitiesFor('room', { roomId: '2', features: connected })).toEqual(['measure_temperature', 'measure_temperature.setPoint']);
    const response = responseFor('room', { roomId: '0' }, one);
    expect(Object.fromEntries([...valuesFor('room', { roomId: '0' }, response)].map(([name, { value }]) => [name, value]))).toEqual({
      measure_temperature: 20.4, measure_humidity: 53, 'measure_temperature.setPoint': 20.5,
    });
    const levels = responseFor('room', { roomId: '1' }, features('pyvicare/RoomControl'));
    expect(valuesFor('room', { roomId: '1' }, levels).get('measure_temperature.setPoint').value).toBe(22);
  });

  test('a sensor no longer connected clears its value; rooms have nothing to write', () => {
    const response = { data: [feature('rooms.0.sensors.humidity', { status: { value: 'notConnected' } }), feature('rooms.0.sensors.temperature', { value: { value: 19 } })] };
    const values = valuesFor('room', { roomId: '0' }, response);
    expect(values.get('measure_humidity')).toEqual({ value: undefined, gone: true });
    expect(values.get('measure_temperature')).toEqual({ value: 19, gone: false });
    expect(profileOf('room', { roomId: '0' }).some((capability) => capability.writable)).toBe(false);
    expect(pollPaths('room', { roomId: '3' })).toContain('rooms.3.sensors.temperature');
  });
});

test('an unknown kind is refused', () => {
  expect(() => profileOf('boiler', {})).toThrow('Unknown kind');
});
