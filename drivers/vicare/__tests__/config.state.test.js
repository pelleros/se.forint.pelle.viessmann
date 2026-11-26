/* eslint-env jest */

'use strict';

// config/state.js: heating now, the operating state and the status text, from reported values.

const { PATHS } = require('../config');
const {
  heatingNow, operatingState, statusText, formatNumber, HOT_WATER_CHARGING, STATES,
} = require('../config/state');
const { featureReader: reader } = require('../../../test/helpers/featureReader');

const compressor = (active, phase) => ({ [PATHS.COMPRESSOR]: { active: { value: active }, phase: { value: phase } } });
const charging = (active) => ({ [HOT_WATER_CHARGING]: { active: { value: active } } });
const readings = (values) => ({ readings: new Map(Object.entries(values).map(([name, value]) => [name, { value }])) });

test('every state has a title in every app language', () => {
  for (const title of Object.values(STATES)) expect(Object.keys(title).sort()).toEqual(['de', 'en', 'fr', 'nl', 'sv']);
});

test('heating now follows a running compressor outside defrost and cooling, the burner and a generating fuel cell', () => {
  expect(heatingNow(reader(compressor(true, 'heating')))).toBe(true);
  expect(heatingNow(reader(compressor(true, 'ready')))).toBe(true);
  for (const phase of ['defrost', 'passive-defrost', 'preparing-defrost', 'cooling', 'pause', 'off']) {
    expect(heatingNow(reader(compressor(true, phase)))).toBe(false);
  }
  expect(heatingNow(reader(compressor(false, 'heating')))).toBe(false);
  expect(heatingNow(reader({ [PATHS.BURNER]: { active: { value: true } } }))).toBe(true);
  expect(heatingNow(reader({ [PATHS.BURNER]: { active: { value: false } }, [PATHS.FUEL_CELL_PHASE]: { value: { value: 'generation' } } }))).toBe(true);
  expect(heatingNow(reader({}))).toBeUndefined();
});

test('the operating state tells hot water, defrost, cooling and standby apart', () => {
  expect(operatingState(reader({ ...compressor(true, 'heating'), ...charging(true) }))).toBe('hotWater');
  expect(operatingState(reader({ ...compressor(true, 'heating'), ...charging(false) }))).toBe('heating');
  expect(operatingState(reader(compressor(true, 'heating')))).toBe('heating');
  expect(operatingState(reader(compressor(false, 'passive-defrost')))).toBe('defrost');
  expect(operatingState(reader(compressor(true, 'cooling')))).toBe('cooling');
  expect(operatingState(reader(compressor(false, 'pause')))).toBe('standby');
  expect(operatingState(reader({}))).toBeUndefined();
});

test('the status text is built from reported values only, in Homey\'s language', () => {
  const hotWater = { [PATHS.HOT_WATER_TEMP]: { value: { value: 47.46 } } };
  const running = { ...compressor(true, 'heating'), ...hotWater };
  expect(statusText(reader(running), { language: 'en', ...readings({ 'measure_compressor_number.compressorModulation': 55 }) }))
    .toBe('Heating · compressor 55 % · hot water 47.5 °C');
  expect(statusText(reader(running), { language: 'de', ...readings({ measure_holiday_active: true }) }))
    .toBe('Heizen · Warmwasser 47,5 °C · Urlaub');
  expect(statusText(reader({ ...running, ...charging(true) }), { language: 'fr' })).toBe('Eau chaude · 47,5 °C');
  expect(statusText(reader({ [PATHS.BURNER]: { active: { value: true } } }), { language: 'nl', ...readings({ 'measure_burner_number.burnerModulation': 30 }) }))
    .toBe('Verwarmen · brander 30 %');
  expect(statusText(reader({ [PATHS.FUEL_CELL_PHASE]: { value: { value: 'generation' } } }), { language: 'sv' })).toBe('Värmer · bränslecell');
  expect(statusText(reader({}), {})).toBeUndefined();
});

test('numbers have at most one decimal, with a decimal comma where the language uses one', () => {
  expect([formatNumber(20, 'sv'), formatNumber(20.04, 'en'), formatNumber(20.25, 'de'), formatNumber(7.5, undefined)])
    .toEqual(['20', '20', '20,3', '7.5']);
});
