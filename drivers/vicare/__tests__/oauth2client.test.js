/* eslint-env jest */
/* eslint-disable max-classes-per-file */

'use strict';

// Covers how ViessmannOAuth2Client turns failed API responses into errors.

jest.mock('homey-oauth2app', () => {
  class OAuth2Error extends Error {}
  return {
    OAuth2Client: class {

      constructor() {
        this.log = jest.fn();
        this.error = jest.fn();
      }

    },
    OAuth2Error,
    OAuth2Token: class {},
    fetch: jest.fn(),
  };
});

const { OAuth2Error } = require('homey-oauth2app');
const ViessmannOAuth2Client = require('../../../lib/ViessmannOAuth2Client');

async function errorFor(response) {
  const client = new ViessmannOAuth2Client();
  // The SDK throws the error that onHandleNotOK returns
  const error = await client.onHandleNotOK(response);
  expect(error).toBeInstanceOf(Error);
  return error;
}

describe('ViessmannOAuth2Client.onHandleNotOK', () => {
  test.each([
    [401, 'Authentication failed; repair the device to sign in again'],
    [403, 'Write access or API permission denied'],
    [404, 'Device, circuit or feature not found'],
    [429, 'API rate limit exceeded'],
  ])('describes HTTP %i, keeps the status and adds the API details', async (status, description) => {
    const error = await errorFor({ status, body: { errorType: 'SOMETHING', message: 'details' } });
    expect(error).toBeInstanceOf(OAuth2Error);
    expect(error.message).toBe(`Viessmann HTTP ${status}: ${description} — SOMETHING: details`);
    expect(error.status).toBe(status);
  });

  test('includes the HTTP status and Viessmann error type and message', async () => {
    const error = await errorFor({
      status: 400,
      statusText: 'Bad Request',
      body: {
        viErrorId: 'abc',
        statusCode: 400,
        errorType: 'DEVICE_COMMUNICATION_ERROR',
        message: 'Device is not reachable',
      },
    });
    expect(error).toBeInstanceOf(OAuth2Error);
    expect(error.status).toBe(400);
    expect(error.apiCode).toBe('DEVICE_COMMUNICATION_ERROR');
    expect(error.requestId).toBe('abc');
    expect(error.message).toBe('Viessmann HTTP 400: Invalid command or parameters — DEVICE_COMMUNICATION_ERROR: Device is not reachable');
  });

  test.each([
    ['only a message', { message: 'Internal error' }, 'Viessmann HTTP 500: Internal Server Error — Internal error'],
    ['only an error type', { errorType: 'INTERNAL_SERVER_ERROR' }, 'Viessmann HTTP 500: Internal Server Error — INTERNAL_SERVER_ERROR'],
    ['an OAuth style error', { error: 'invalid_request', error_description: 'Bad parameter' }, 'Viessmann HTTP 500: Internal Server Error — invalid_request: Bad parameter'],
    ['an empty object', {}, 'Viessmann HTTP 500: Internal Server Error'],
    ['an empty string', '', 'Viessmann HTTP 500: Internal Server Error'],
    ['no body', undefined, 'Viessmann HTTP 500: Internal Server Error'],
    ['null', null, 'Viessmann HTTP 500: Internal Server Error'],
    ['a plain text body', 'Service temporarily down', 'Viessmann HTTP 500: Internal Server Error — Service temporarily down'],
    ['a JSON text body', '{"errorType":"X","message":"Y"}', 'Viessmann HTTP 500: Internal Server Error — X: Y'],
    ['an HTML page', '<html><body>Oops</body></html>', 'Viessmann HTTP 500: Internal Server Error'],
  ])('handles a body with %s', async (_, body, expected) => {
    const error = await errorFor({ status: 500, statusText: 'Internal Server Error', body });
    expect(error).toBeInstanceOf(OAuth2Error);
    expect(error.message).toBe(expected);
  });

  test('works without a status text', async () => {
    const error = await errorFor({ status: 502, body: undefined });
    expect(error.message).toBe('Viessmann HTTP 502: API request failed');
  });

  test('does not leak extended payload such as client or user IDs', async () => {
    const error = await errorFor({
      status: 400,
      body: {
        errorType: 'VALIDATION_ERROR',
        message: 'Invalid value',
        extendedPayload: { clientId: 'secret-client-id', userId: 'secret-user-id' },
      },
    });
    expect(error.message).toBe('Viessmann HTTP 400: Invalid command or parameters — VALIDATION_ERROR: Invalid value');
    expect(error.message).not.toContain('secret');
  });

  test('truncates very long text bodies', async () => {
    const error = await errorFor({ status: 503, body: 'x'.repeat(1000) });
    expect(error.message.length).toBeLessThan(300);
    expect(error.message.startsWith('Viessmann HTTP 503: API request failed — xxx')).toBe(true);
  });
});
