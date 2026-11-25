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
  server = http.createServer((req, res) => respond(req, res));
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
