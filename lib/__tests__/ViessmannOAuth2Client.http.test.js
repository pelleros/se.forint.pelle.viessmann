/* eslint-env jest */

'use strict';

// Runs ViessmannOAuth2Client on the real homey-oauth2app and node-fetch against a local HTTP
// server, so that request options and error handling are checked end to end.

const http = require('http');

jest.mock('homey', () => ({
  env: {}, manifest: { drivers: [] }, App: class {}, Driver: class {}, Device: class {}, SimpleClass: class {},
}), { virtual: true });

const { OAuth2Token } = jest.requireActual('homey-oauth2app');
const ViessmannOAuth2Client = require('../ViessmannOAuth2Client');
const { isAuthenticationFailure, apiErrorState, API_STATES } = require('../apiError');

const TIMEOUT = 300;
const REQUEST = {
  installationId: 900001, gatewaySerial: '9999000000000001', deviceId: '0', filter: 'heating.sensors.temperature.outside',
};

let server;
let baseUrl;
let respond; // (req, res) => void, set per test; a handler that never ends the response hangs

class TestClient extends ViessmannOAuth2Client {

  static DEFAULT_TIMEOUT = TIMEOUT;

}

function createClient() {
  const client = new TestClient({
    token: OAuth2Token,
    apiUrl: baseUrl,
    tokenUrl: TestClient.TOKEN_URL,
    authorizationUrl: `${baseUrl}/authorize`,
    redirectUrl: `${baseUrl}/callback`,
    scopes: [],
    clientId: 'test-client',
  });
  for (const event of ['log', 'error', 'debug']) client.on(event, () => {});
  client.save = jest.fn();
  client._clientId = 'test-client';
  client._token = new OAuth2Token({ access_token: 'old-access', refresh_token: 'old-refresh' });
  return client;
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    // No keep-alive: afterEach destroys hanging connections, and a pooled socket would then
    // fail the next test's request with ECONNRESET
    res.setHeader('Connection', 'close');
    respond(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  TestClient.TOKEN_URL = `${baseUrl}/token`;
});

afterEach(() => {
  server.closeAllConnections();
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('API requests time out', () => {
  test('when the server never answers', async () => {
    respond = () => {}; // e.g. a half-open connection
    const started = Date.now();

    await expect(createClient().getFeatures(REQUEST)).rejects.toMatchObject({ type: 'request-timeout' });
    expect(Date.now() - started).toBeLessThan(TIMEOUT + 2000);
  });

  test('when the response body never completes', async () => {
    respond = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"data": [');
    };

    await expect(createClient().getFeatures(REQUEST)).rejects.toMatchObject({ type: 'body-timeout' });
  });

  test('commands time out too', async () => {
    respond = () => {};

    await expect(createClient().executeCommand({
      ...REQUEST, feature: 'heating.dhw.temperature.main', command: 'setTargetTemperature', body: { temperature: 50 },
    })).rejects.toMatchObject({ type: 'request-timeout' });
  });

  test('a normal answer is unaffected', async () => {
    respond = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ feature: 'heating.sensors.temperature.outside' }] }));
    };

    await expect(createClient().getFeatures(REQUEST)).resolves.toEqual({ data: [{ feature: 'heating.sensors.temperature.outside' }] });
  });
});

describe('an expired access token whose refresh fails', () => {
  const json = (status, body) => (req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  // The API answers 401 until the request carries the refreshed token
  function serve(tokenEndpoint, { acceptNewToken = true } = {}) {
    respond = (req, res) => {
      if (req.url.startsWith('/token')) {
        tokenEndpoint(req, res);
        return;
      }
      const authorized = acceptNewToken && req.headers.authorization === 'Bearer new-access';
      json(authorized ? 200 : 401, authorized ? { data: [] } : { errorType: 'TOKEN_EXPIRED', message: 'Token expired' })(req, res);
    };
  }

  test('a refresh token the IdP rejects (invalid_grant) needs Repair and keeps the IdP description', async () => {
    serve(json(400, { error: 'invalid_grant', error_description: 'Invalid grant' }));
    const client = createClient();

    const error = await client.getFeatures(REQUEST).catch((caught) => caught);

    expect(isAuthenticationFailure(error)).toBe(true);
    expect(error.message).toContain('invalid_grant: Invalid grant');
    expect(error.message).toContain('open the device and choose Repair');
    expect(error.message).not.toContain('Invalid command');
    expect(client._token.refresh_token).toBe('old-refresh');
    expect(client.save).not.toHaveBeenCalled();
  });

  test.each([
    ['answers HTTP 503', (req, res) => {
      res.writeHead(503, { 'Content-Type': 'text/html' });
      res.end('<html>maintenance</html>');
    }],
    ['never answers', () => {}],
  ])('a token endpoint that %s is a temporary failure', async (_, tokenEndpoint) => {
    serve(tokenEndpoint);
    const client = createClient();

    const error = await client.getFeatures(REQUEST).catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(isAuthenticationFailure(error)).toBe(false);
    expect(error.message).not.toMatch(/Repair|Invalid command/);
    expect(client._token.refresh_token).toBe('old-refresh');
  });

  test('an unreachable token endpoint is a temporary failure', async () => {
    serve(json(500, {}));
    const closed = http.createServer();
    await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const unreachable = `http://127.0.0.1:${closed.address().port}/token`;
    await new Promise((resolve) => closed.close(resolve));
    const tokenUrl = TestClient.TOKEN_URL;
    TestClient.TOKEN_URL = unreachable;
    try {
      const error = await createClient().getFeatures(REQUEST).catch((caught) => caught);
      expect(error).toBeInstanceOf(Error);
      expect(isAuthenticationFailure(error)).toBe(false);
    } finally {
      TestClient.TOKEN_URL = tokenUrl;
    }
  });

  test('a refreshed token that the API still rejects is an authentication failure (401)', async () => {
    serve(json(200, { access_token: 'new-access', refresh_token: 'new-refresh' }), { acceptNewToken: false });
    const client = createClient();

    const error = await client.getFeatures(REQUEST).catch((caught) => caught);

    expect(error.status).toBe(401);
    expect(isAuthenticationFailure(error)).toBe(true);
  });

  test('a successful refresh repeats the request with the new token', async () => {
    serve(json(200, { access_token: 'new-access', refresh_token: 'new-refresh' }));
    const client = createClient();

    await expect(client.getFeatures(REQUEST)).resolves.toEqual({ data: [] });
    expect(client._token.refresh_token).toBe('new-refresh');
    expect(client.save).toHaveBeenCalled();
  });
});

describe('error states the user is told about', () => {
  // Bodies shaped like the API's, with made-up ids
  const PRIVATE = { clientId: 'client-id-123', userId: 'user-id-456' };
  const answer = (status, body, headers = {}) => {
    respond = (req, res) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
  };
  const failure = () => createClient().getFeatures(REQUEST).catch((caught) => caught);

  test('HTTP 402 PACKAGE_NOT_PAID_FOR: a paid API package is required', async () => {
    answer(402, {
      viErrorId: 'synthetic-402', statusCode: 402, errorType: 'PACKAGE_NOT_PAID_FOR', message: 'User does not have access to the given feature.', extendedPayload: PRIVATE,
    });

    const error = await failure();

    expect(error).toMatchObject({ status: 402, apiCode: 'PACKAGE_NOT_PAID_FOR', requestId: 'synthetic-402' });
    expect(apiErrorState(error)).toBe(API_STATES.PACKAGE_NOT_PAID);
    expect(isAuthenticationFailure(error)).toBe(false);
    expect(error.message).toBe('Viessmann HTTP 402: Paid API package required — PACKAGE_NOT_PAID_FOR: User does not have access to the given feature.');
  });

  test('HTTP 429 without Retry-After: the quota reset time comes from the body', async () => {
    const limitReset = Date.now() + 3 * 60 * 60 * 1000;
    answer(429, {
      viErrorId: 'synthetic-429',
      statusCode: 429,
      errorType: 'RATE_LIMIT_EXCEEDED',
      message: 'API calls rate limit has been exceeded. Please wait until your limit will reset.',
      extendedPayload: {
        ...PRIVATE, name: 'ViCare day limit', requestCountLimit: 1450, limitReset,
      },
    });

    const error = await failure();

    expect(error.status).toBe(429);
    expect(apiErrorState(error)).toBe(API_STATES.RATE_LIMITED);
    expect(error.retryAfterMs).toBeGreaterThan(limitReset - Date.now() - 5000);
    expect(error.retryAfterMs).toBeLessThanOrEqual(limitReset - Date.now() + 1000);
    expect(error.message).not.toMatch(/client-id-123|user-id-456/);
    expect(error.message).not.toBe('Rate Limited');
  });

  test('HTTP 429 with Retry-After and no body keeps the Retry-After', async () => {
    respond = (req, res) => {
      res.writeHead(429, { 'Retry-After': '600' });
      res.end();
    };

    await expect(failure()).resolves.toMatchObject({ status: 429, retryAfterMs: 600000 });
  });

  test('DEVICE_COMMUNICATION_ERROR with reason GATEWAY_OFFLINE: the gateway is offline', async () => {
    answer(400, {
      viErrorId: 'synthetic-400', statusCode: 400, errorType: 'DEVICE_COMMUNICATION_ERROR', message: '', extendedPayload: { ...PRIVATE, reason: 'GATEWAY_OFFLINE' },
    });

    const error = await failure();

    expect(error).toMatchObject({ status: 400, apiCode: 'DEVICE_COMMUNICATION_ERROR', apiReason: 'GATEWAY_OFFLINE' });
    expect(apiErrorState(error)).toBe(API_STATES.GATEWAY_OFFLINE);
    expect(error.message).toContain('DEVICE_COMMUNICATION_ERROR (GATEWAY_OFFLINE)');
    expect(error.message).not.toMatch(/client-id-123|user-id-456/);
  });
});
