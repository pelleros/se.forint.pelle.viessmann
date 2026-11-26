/* eslint-env jest */

'use strict';

// Values a Vitocal 262-A reports beyond the ones every heat pump has: the middle cylinder
// sensor, the heating rod with its counters, the heat output now and the seasonal efficiency
// figures. The PyViCare fixture Vitocal262A_T2H-R290, with the heating rod's counters as another
// Vitocal 262-A reports them.

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const { FEATURES } = require('../config');
const { polledFixtureDevice } = require('../../../test/helpers/polledFixtureDevice');

const FIXTURE = 'pyvicare/Vitocal262A_T2H-R290.json';
const HEATING_ROD = 'heating.heatingRod';
const HEATING_ROD_STATS = 'heating.heatingRod.statistics';
const MIDDLE = 'heating.dhw.sensors.temperature.dhwCylinder.middle';
const MIDDLE_STORAGE = 'heating.dhw.sensors.temperature.hotWaterStorage.middle';
const HEAT_OUTPUT = 'heating.heat.production.current';

const feature = (dump, name) => dump.data.find((item) => item.feature === name);

// The heating rod's counters in the structure of the compressor's
function withHeatingRodStatistics(dump) {
  Object.assign(feature(dump, HEATING_ROD_STATS), {
    isEnabled: true,
    properties: {
      starts: { type: 'number', unit: '', value: 14 },
      hours: { type: 'number', unit: 'hour', value: 6.5 },
    },
  });
}

const heatPump = (change = () => {}) => polledFixtureDevice({
  fixture: FIXTURE,
  change: (dump) => {
    withHeatingRodStatistics(dump);
    change(dump);
  },
});

test('gets the middle cylinder temperature, the heating rod, the heat output and the seasonal efficiency', async () => {
  const { device } = await heatPump();
  const value = (name) => device.getCapabilityValue(name);

  expect(value('measure_temperature.hotWaterMiddle')).toBe(54.3);
  expect(value('measure_heatingrod_active')).toBe(false);
  expect(value('measure_heatingrod_number.heatingRodStarts')).toBe(14);
  expect(value('measure_heatingrod_number.heatingRodHours')).toBe(6.5);
  expect(value('measure_heat_output')).toBe(0);
  expect([value('measure_scop_number.total'), value('measure_scop_number.dhw')]).toEqual([2.8, 2.8]);
  expect([value('measure_spf_number.total'), value('measure_spf_number.dhw')]).toEqual([2.8, 2.8]);
});

test('a part that has not run yet reports 0, which shows as no value until it has run', async () => {
  const { device, dump } = await heatPump();
  expect(device.hasCapability('measure_scop_number.heating')).toBe(true);
  expect(device.getCapabilityValue('measure_scop_number.heating')).toBeNull();
  expect(device.getCapabilityValue('measure_spf_number.heating')).toBeNull();

  feature(dump, 'heating.scop.heating').properties.value.value = 3.1;
  await device.onFeaturesUpdated(dump, false);
  expect(device.getCapabilityValue('measure_scop_number.heating')).toBe(3.1);
});

test('the heat output is shown in W, and never as the power the device uses', async () => {
  const { device } = await heatPump((dump) => {
    feature(dump, HEAT_OUTPUT).properties.value.value = 2.4;
  });
  expect(device.getCapabilityValue('measure_heat_output')).toBe(2400);
  expect(FEATURES[HEAT_OUTPUT].capabilities.map((capability) => capability.capabilityName)).toEqual(['measure_heat_output']);
  // measure_power (Homey Energy) still comes from the device's own consumption
  expect(device.getCapabilityValue('measure_power')).toBe(0);
});

test('the middle sensor is read from the other naming where the device has only that', async () => {
  const { device } = await heatPump((dump) => {
    feature(dump, MIDDLE).isEnabled = false;
    feature(dump, MIDDLE_STORAGE).properties.value.value = 53.1;
  });
  expect(device.getCapabilityValue('measure_temperature.hotWaterMiddle')).toBe(53.1);
});

test('the heating rod counts as heating now and shows in the status text', async () => {
  const { device } = await heatPump((dump) => {
    feature(dump, HEATING_ROD).properties.active.value = true;
  });
  expect(device.getCapabilityValue('measure_heatingrod_active')).toBe(true);
  expect(device.getCapabilityValue('measure_compressor_active')).toBe(false);
  expect(device.getCapabilityValue('measure_heating_active')).toBe(true);
  expect(device.getCapabilityValue('measure_status_text')).toMatch(/^Heating · heating rod · hot water 55\.3 °C$/);
});

test('without the counters feature the heating rod has no counters', async () => {
  const { device } = await polledFixtureDevice({ fixture: FIXTURE });
  expect(device.hasCapability('measure_heatingrod_active')).toBe(true);
  expect(device.hasCapability('measure_heatingrod_number.heatingRodStarts')).toBe(false);
});
