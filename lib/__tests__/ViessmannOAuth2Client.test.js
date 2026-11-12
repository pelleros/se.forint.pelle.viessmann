/* eslint-env jest */

'use strict';

jest.mock('homey-oauth2app', () => ({
  OAuth2Client: class {
    debug() {}
    log() {}
    error() {}
    save() {}
    async onRequestResponse() {
      throw new Error('Token refresh failed');
    }

    getToken() {
      return this._token;
    }
  },
  OAuth2Token: class {
    constructor(body) {
      Object.assign(this, body);
    }
  },
  OAuth2Error: class extends Error {},
  fetch: jest.fn(),
}));

const { fetch, OAuth2Client } = require('homey-oauth2app');
const Client = require('../ViessmannOAuth2Client');
const { apiError } = require('../apiError');

let client;
beforeEach(() => {
  client = new Client();
  client._token = { access_token: 'old-access', refresh_token: 'old-refresh' };
  client.save = jest.fn();
  fetch.mockReset();
});

test.each([
  { ok: false, status: 401, json: async () => ({ error: 'invalid_grant' }) },
  { ok: true, json: async () => ({ error: 'invalid_grant' }) },
  { ok: true, json: async () => ({ access_token: '' }) },
  { ok: true, json: async () => ({ access_token: 'new', refresh_token: null }) },
  { ok: true, json: async () => null },
  {
    ok: true,
    json: async () => {
      throw new Error('malformed JSON');
    },
  },
])('failed refresh preserves credentials and does not save: %#', async (response) => {
  const previous = client._token;
  fetch.mockResolvedValue(response);
  await expect(client.onRefreshToken()).rejects.toThrow();
  expect(client._token).toBe(previous);
  expect(client.save).not.toHaveBeenCalled();
});

test.each([undefined, 'rotated-refresh'])('successful refresh retains or rotates refresh token: %s', async (refreshToken) => {
  const body = { access_token: 'new-access', expires_in: 3600 };
  if (refreshToken) body.refresh_token = refreshToken;
  fetch.mockResolvedValue({ ok: true, json: async () => body });
  await client.onRefreshToken();
  expect(client._token.access_token).toBe('new-access');
  expect(client._token.refresh_token).toBe(refreshToken || 'old-refresh');
  expect(client.save).toHaveBeenCalledTimes(1);
});

test('debug output redacts SDK headers, request bodies and token objects', () => {
  const debug = jest.spyOn(OAuth2Client.prototype, 'debug');
  client.debug('Authorization: Bearer unknown-token');
  client.debug('refresh_token=old-refresh&client_secret=hidden');
  client.debug({ access_token: 'old-access', nested: { refresh_token: 'old-refresh' } });
  const output = JSON.stringify(debug.mock.calls);
  for (const secret of ['unknown-token', 'old-access', 'old-refresh', 'hidden']) expect(output).not.toContain(secret);
  expect(output).toContain('[redacted]');
  debug.mockRestore();
});

test('API errors preserve HTTP status, error code, request ID and safe details', async () => {
  const error = await client.onHandleNotOK({
    status: 403,
    body: {
      message: 'Command not permitted', errorType: 'FORBIDDEN', viErrorId: 'synthetic-request',
    },
  });
  expect(error.status).toBe(403);
  expect(error.message).toContain('Command not permitted');
  expect(error.apiCode).toBe('FORBIDDEN');
  expect(error.requestId).toBe('synthetic-request');
});

test('rate limiting preserves Retry-After and bypasses generic SDK error', async () => {
  const headers = { get: () => '600' };
  await expect(client.onIsRateLimited({ status: 429, headers })).rejects.toMatchObject({ status: 429, retryAfterMs: 600000 });
});

test('Retry-After accepts HTTP dates and ignores malformed values', () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
  expect(apiError({ status: 429, headers: { get: () => 'Thu, 01 Jan 2026 00:10:00 GMT' } }).retryAfterMs).toBe(600000);
  expect(apiError({ status: 429, headers: { get: () => 'invalid' } }).retryAfterMs).toBeUndefined();
  jest.useRealTimers();
});

test('a rejected request after refresh remains an HTTP 401 error', async () => {
  await expect(client.onRequestResponse({ response: { status: 401 } })).rejects.toMatchObject({ status: 401 });
});
