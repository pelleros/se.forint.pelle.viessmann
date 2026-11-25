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
  try {
    await client.onHandleNotOK(response);
  } catch (error) {
    return error;
  }
  throw new Error('onHandleNotOK did not throw');
}

describe('ViessmannOAuth2Client.onHandleNotOK', () => {
  test.each([
    [401, 'Unauthorized - check credentials'],
    [403, 'Access forbidden'],
    [404, 'Device or resource not found'],
    [429, 'Rate limit exceeded'],
  ])('keeps the existing message for HTTP %i', async (status, message) => {
    const error = await errorFor({ status, body: { errorType: 'SOMETHING', message: 'details' } });
    expect(error).toBeInstanceOf(OAuth2Error);
    expect(error.message).toBe(message);
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
    expect(error.message).toBe('Viessmann API error (HTTP 400): DEVICE_COMMUNICATION_ERROR: Device is not reachable');
  });

  test.each([
    ['only a message', { message: 'Internal error' }, 'Viessmann API error (HTTP 500): Internal error'],
    ['only an error type', { errorType: 'INTERNAL_SERVER_ERROR' }, 'Viessmann API error (HTTP 500): INTERNAL_SERVER_ERROR'],
    ['an OAuth style error', { error: 'invalid_request', error_description: 'Bad parameter' }, 'Viessmann API error (HTTP 500): invalid_request: Bad parameter'],
    ['an empty object', {}, 'Viessmann API error (HTTP 500): Internal Server Error'],
    ['an empty string', '', 'Viessmann API error (HTTP 500): Internal Server Error'],
    ['no body', undefined, 'Viessmann API error (HTTP 500): Internal Server Error'],
    ['null', null, 'Viessmann API error (HTTP 500): Internal Server Error'],
    ['a plain text body', 'Service temporarily down', 'Viessmann API error (HTTP 500): Service temporarily down'],
    ['a JSON text body', '{"errorType":"X","message":"Y"}', 'Viessmann API error (HTTP 500): X: Y'],
    ['an HTML page', '<html><body>Oops</body></html>', 'Viessmann API error (HTTP 500): Internal Server Error'],
  ])('handles a body with %s', async (_, body, expected) => {
    const error = await errorFor({ status: 500, statusText: 'Internal Server Error', body });
    expect(error).toBeInstanceOf(OAuth2Error);
    expect(error.message).toBe(expected);
  });

  test('works without a status text', async () => {
    const error = await errorFor({ status: 502, body: undefined });
    expect(error.message).toBe('Viessmann API error (HTTP 502)');
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
    expect(error.message).toBe('Viessmann API error (HTTP 400): VALIDATION_ERROR: Invalid value');
    expect(error.message).not.toContain('secret');
  });

  test('truncates very long text bodies', async () => {
    const error = await errorFor({ status: 503, body: 'x'.repeat(1000) });
    expect(error.message.length).toBeLessThan(300);
    expect(error.message.startsWith('Viessmann API error (HTTP 503): xxx')).toBe(true);
  });
});
