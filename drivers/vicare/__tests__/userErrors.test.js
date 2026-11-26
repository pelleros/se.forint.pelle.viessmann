/* eslint-env jest */

'use strict';

// lib/errorMessages.js (translations) loads homey-oauth2app through lib/apiError.js
// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const en = require('../../../locales/en.json');
const { userError, userErrorFrom } = require('../userErrors');

test('uses the user\'s language when Homey has the text, and keeps the key as code', () => {
  const device = { homey: { __: (key, tags) => `${key}:${tags.limit}` } };
  const error = userError(device, 'rate_limited', { limit: 6 });
  expect(error.message).toBe('flow.rate_limited:6');
  expect(error.code).toBe('rate_limited');
});

test('falls back to the English text, with the tags filled in, when Homey has none', () => {
  expect(userError({ homey: { __: (key) => key } }, 'feature_not_reported', { feature: 'a.b' }).message)
    .toBe('The device does not report a.b.');
  expect(userError({}, 'value_unknown').message).toBe(en.flow.value_unknown);
  expect(userError(undefined, 'mode_not_supported', { mode: 'cooling' }).message)
    .toBe('Operating mode "cooling" is not supported by this heating circuit.');
});

test('an unknown key shows the key rather than nothing', () => {
  expect(userError({}, 'no_such_key').message).toBe('flow.no_such_key');
});

test('an error from a module without a device gets the user\'s text for its code; others stay as they are', () => {
  const device = { homey: { __: (key) => `sv:${key}` } };
  const coded = Object.assign(new Error('The normal program follows the time program'), { code: 'program_follows_schedule' });
  expect(userErrorFrom(device, coded)).toMatchObject({ message: 'sv:flow.program_follows_schedule', code: 'program_follows_schedule' });
  expect(userErrorFrom({}, coded)).toMatchObject({ message: en.flow.program_follows_schedule });
  const unknownCode = Object.assign(new Error('raw'), { code: 'ECONNRESET' });
  expect(userErrorFrom(device, unknownCode)).toBe(unknownCode);
  const plain = new Error('plain');
  expect(userErrorFrom(device, plain)).toBe(plain);
  expect(userErrorFrom(device, 'text')).toBe('text');
});
