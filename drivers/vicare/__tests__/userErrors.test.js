/* eslint-env jest */

'use strict';

// lib/errorMessages.js (translations) loads homey-oauth2app through lib/apiError.js
// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const en = require('../../../locales/en.json');
const { userError } = require('../userErrors');

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
