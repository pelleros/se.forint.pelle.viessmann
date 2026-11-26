/* eslint-env jest */

'use strict';

// lib/http.js against a local HTTP server: timeouts for the response and its body, errors in
// node-fetch's shape without the request URL, and complete chunked responses over keep-alive
// connections (where node-fetch 2 reported "Premature close").

const http = require('http');
const { fetchWithTimeout, FetchError, failureReason } = require('../http');

let server;
let baseUrl;
let respond;

beforeEach(async () => {
  server = http.createServer((req, res) => respond(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

// An id-like path, as in the API's feature URLs
const PATH = '/features/installations/900001/gateways/9999000000000001/devices/0/features';

test('returns the response with its body read, readable more than once', async () => {
  respond = (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Retry-After': '5' });
    res.end(JSON.stringify({ data: [1, 2] }));
  };

  const response = await fetchWithTimeout(`${baseUrl}${PATH}`, { timeout: 1000 });

  expect(response).toMatchObject({ ok: true, status: 200 });
  expect(response.headers.get('content-type')).toBe('application/json');
  expect(response.headers.get('retry-after')).toBe('5');
  await expect(response.json()).resolves.toEqual({ data: [1, 2] });
  await expect(response.text()).resolves.toBe('{"data":[1,2]}');
  expect((await response.buffer()).toString()).toBe('{"data":[1,2]}');
});

test('sends method, headers and body', async () => {
  let received;
  respond = (req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      received = { method: req.method, type: req.headers['content-type'], body };
      res.writeHead(204);
      res.end();
    });
  };

  const response = await fetchWithTimeout(`${baseUrl}/command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"temperature":50}', timeout: 1000,
  });

  expect(response.status).toBe(204);
  expect(received).toEqual({ method: 'POST', type: 'application/json', body: '{"temperature":50}' });
});

test('chunked responses over a reused keep-alive connection arrive complete', async () => {
  const sockets = new Set();
  server.on('connection', (socket) => sockets.add(socket));
  respond = (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'keep-alive' });
    res.write('{"data": [');
    // A second chunk a little later (a test server, not app code)
    // eslint-disable-next-line homey-app/global-timers
    setTimeout(() => res.end('1]}'), 5);
  };

  for (let poll = 0; poll < 5; poll++) {
    const response = await fetchWithTimeout(`${baseUrl}${PATH}`, { timeout: 1000 });
    await expect(response.json()).resolves.toEqual({ data: [1] });
  }
  // Connections were reused
  expect(sockets.size).toBeLessThan(5);
});

test('a server that never answers is a request timeout, without the URL in the message', async () => {
  respond = () => {};

  const error = await fetchWithTimeout(`${baseUrl}${PATH}`, { timeout: 200 }).catch((caught) => caught);

  expect(error).toBeInstanceOf(FetchError);
  expect(error).toMatchObject({ name: 'FetchError', type: 'request-timeout' });
  expect(error.message).toBe('Viessmann request timed out after 200 ms');
});

test('a body that never completes is a body timeout', async () => {
  respond = (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"data": [');
  };

  await expect(fetchWithTimeout(`${baseUrl}${PATH}`, { timeout: 200 })).rejects.toMatchObject({ type: 'body-timeout' });
});

test('an unreachable server is a system error with its code, without the URL', async () => {
  const closed = http.createServer();
  await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${closed.address().port}${PATH}`;
  await new Promise((resolve) => closed.close(resolve));

  const error = await fetchWithTimeout(url, { timeout: 1000 }).catch((caught) => caught);

  expect(error).toMatchObject({ type: 'system', code: 'ECONNREFUSED' });
  expect(error.message).toMatch(/^Viessmann request failed: .*ECONNREFUSED/);
  expect(error.message).not.toContain('900001');
});

test('invalid JSON is an invalid-json error', async () => {
  respond = (req, res) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end('<html>bad gateway</html>');
  };

  const response = await fetchWithTimeout(`${baseUrl}${PATH}`);

  expect(response.ok).toBe(false);
  await expect(response.json()).rejects.toMatchObject({ type: 'invalid-json' });
  await expect(response.text()).resolves.toBe('<html>bad gateway</html>');
});

test('the failure reason drops URLs and keeps codes', () => {
  expect(failureReason(Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('getaddrinfo ENOTFOUND api.example'), { code: 'ENOTFOUND' }),
  }))).toBe('getaddrinfo ENOTFOUND api.example');
  expect(failureReason(Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' })))
    .toBe('UND_ERR_SOCKET: other side closed');
  expect(failureReason(new Error(`request to https://api.example${PATH} failed`))).toBe('request to <url> failed');
  expect(failureReason('x'.repeat(300))).toHaveLength(201);
});

test('a fetch implementation can be passed in', async () => {
  const fetchImpl = jest.fn(async () => new Response('{"a":1}', { status: 200 }));
  const response = await fetchWithTimeout('https://example.invalid/x', {}, { fetchImpl });
  await expect(response.json()).resolves.toEqual({ a: 1 });
  expect(fetchImpl).toHaveBeenCalledWith('https://example.invalid/x', { signal: undefined });
});
