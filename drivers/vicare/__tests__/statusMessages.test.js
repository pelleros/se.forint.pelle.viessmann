/* eslint-env jest */

'use strict';

// The texts of the device's status (statusMessages.js), in the user's language with English as
// the fallback.

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const {
  warningText, writeMessage, describeValue, capabilityTitle, language,
} = require('../statusMessages');

const homey = { __: (key) => key, i18n: { getLanguage: () => 'sv' }, clock: { getTimezone: () => 'Europe/Stockholm' } };

test('values with their unit or mode title, titles in the language', () => {
  expect(describeValue({ units: '°C' }, 50, 'en')).toBe('50 °C');
  expect(describeValue({ units: { en: 'starts', sv: 'starter' } }, 3, 'sv')).toBe('3 starter');
  expect(describeValue({ values: [{ id: 'dhw', title: { en: 'Hot water' } }] }, 'dhw', 'sv')).toBe('Hot water');
  expect(describeValue({}, 'x', 'en')).toBe('x');
  expect(capabilityTitle('measure_power', 'sv')).toBe('Effektförbrukning');
  expect(capabilityTitle('not_a_capability', 'en')).toBe('not_a_capability');
  expect(language(homey)).toBe('sv');
  expect(language({})).toBe('en');
});

test('a write that did not take names the value wanted and the one reported', () => {
  expect(writeMessage({}, {
    capabilityName: 'target_temperature.hotWater', options: { units: '°C' }, wanted: 50, actual: 48,
  })).toBe('The heating system did not take the change: Hot water Normal is 48 °C instead of 50 °C.');
});

test('the warning lists faults, frozen values and writes, or is empty', () => {
  const text = warningText(homey, {
    faults: ['F.160', 'F.454'],
    frozenSince: Date.parse('2026-11-26T10:59:00Z'),
    writes: [{
      capabilityName: 'target_temperature.hotWater', options: { units: '°C' }, wanted: 50, actual: 48,
    }],
  });
  expect(text).toContain('F.160, F.454');
  expect(text).toContain('26 Nov, 11:59');
  expect(text).toContain('48 °C instead of 50 °C');
  expect(warningText(homey, { faults: [], frozenSince: null, writes: [] })).toBe('');
});
