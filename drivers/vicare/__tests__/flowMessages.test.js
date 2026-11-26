/* eslint-env jest */

'use strict';

const en = require('../../../locales/en.json');
const {
  FALLBACK, WRITE_LIMITS, flowMessage, flowError, takeWrite,
} = require('../flowMessages');

test('the English fallbacks are the texts in locales/en.json', () => {
  expect(FALLBACK).toEqual(en.flow);
});

test('uses the user\'s language when Homey has the text', () => {
  const device = { homey: { __: (key, tags) => `${key}:${tags.limit}` } };
  expect(flowMessage(device, 'rate_limited', { limit: 6 })).toBe('flow.rate_limited:6');
});

test('falls back to English, with the tags filled in, when Homey has no text', () => {
  const missing = { homey: { __: (key) => key } };
  expect(flowMessage(missing, 'feature_not_reported', { feature: 'a.b' })).toBe('The device does not report a.b.');
  expect(flowMessage({}, 'unknown_key')).toBe('unknown_key');
  expect(flowError({}, 'value_unknown')).toEqual(new Error(FALLBACK.value_unknown));
});

test('takeWrite counts per device and kind', () => {
  let now = 0;
  const clock = () => now;
  const first = {};
  const second = {};
  for (let i = 0; i < WRITE_LIMITS.hotWaterBoost.limit; i++) takeWrite(first, 'hotWaterBoost', clock);
  expect(() => takeWrite(first, 'hotWaterBoost', clock)).toThrow('Try again in 60 minutes.');
  expect(() => takeWrite(first, 'hotWaterCharge', clock)).not.toThrow();
  expect(() => takeWrite(second, 'hotWaterBoost', clock)).not.toThrow();
  now = 60 * 60 * 1000;
  expect(() => takeWrite(first, 'hotWaterBoost', clock)).not.toThrow();
});
