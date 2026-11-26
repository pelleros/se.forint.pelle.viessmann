// @ts-check

'use strict';

// HTTP requests to Viessmann with the global fetch of Node 22 (undici) instead of the node-fetch
// that homey-oauth2app bundles: with Node's keep-alive connections, node-fetch 2 reports
// "Premature close" for responses that arrived complete. Each request has one timeout for the
// response and its body, and failures keep node-fetch's error shape (`type`), so the error
// handling does not change.

const MAX_REASON_LENGTH = 200;

/**
 * A request that failed without an HTTP response (or whose body could not be read), in
 * node-fetch's shape: `type` is 'request-timeout', 'body-timeout', 'invalid-json' or 'system'.
 * The message never contains the request URL, which holds installation ids and serials.
 */
class FetchError extends Error {

  /**
   * @param {string} message
   * @param {string} type
   * @param {unknown} [cause]
   */
  constructor(message, type, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'FetchError';
    this.type = type;
    // The system error code (e.g. ECONNREFUSED); fetch puts the system error in `cause`
    const anyCause = /** @type {any} */ (cause);
    /** @type {string | undefined} */
    this.code = anyCause?.code ?? anyCause?.cause?.code;
  }

}

/**
 * The response with its body already read, so that json(), text() and buffer() work any number
 * of times (homey-oauth2app and the error handling each read it).
 * @param {Response} response
 * @param {Buffer} body
 */
function bufferedResponse(response, body) {
  const text = () => body.toString('utf8');
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    url: response.url,
    redirected: response.redirected,
    text: async () => text(),
    buffer: async () => body,
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    json: async () => {
      try {
        return JSON.parse(text());
      } catch (error) {
        throw new FetchError(`Invalid JSON in the Viessmann response (HTTP ${response.status})`, 'invalid-json', error);
      }
    },
  };
}

/**
 * The reason of a network failure, without URLs.
 * @param {any} error
 * @returns {string}
 */
function failureReason(error) {
  const cause = error?.cause ?? error;
  const code = typeof cause?.code === 'string' ? cause.code : '';
  const message = typeof cause?.message === 'string' ? cause.message : '';
  const reason = (message.includes(code) ? message : [code, message].filter(Boolean).join(': ')) || String(error);
  const withoutUrls = reason.replace(/https?:\/\/\S+/g, '<url>');
  return withoutUrls.length > MAX_REASON_LENGTH ? `${withoutUrls.slice(0, MAX_REASON_LENGTH)}…` : withoutUrls;
}

/**
 * fetch() with a timeout for the whole request, response body included.
 * @param {string} url
 * @param {RequestInit & { timeout?: number }} [options] `timeout` in milliseconds (none when 0 or absent)
 * @param {{ fetchImpl?: typeof fetch }} [dependencies]
 * @returns {Promise<ReturnType<typeof bufferedResponse>>}
 */
async function fetchWithTimeout(url, options = {}, { fetchImpl = globalThis.fetch } = {}) {
  const { timeout, ...init } = options;
  const signal = timeout ? AbortSignal.timeout(timeout) : undefined;
  let stage = 'request';
  try {
    const response = await fetchImpl(url, { ...init, signal });
    stage = 'body';
    const body = Buffer.from(await response.arrayBuffer());
    return bufferedResponse(response, body);
  } catch (error) {
    if (error instanceof FetchError) throw error;
    if (signal?.aborted) {
      throw new FetchError(`Viessmann ${stage === 'request' ? 'request' : 'response'} timed out after ${timeout} ms`, `${stage}-timeout`, error);
    }
    throw new FetchError(`Viessmann request failed: ${failureReason(error)}`, 'system', error);
  }
}

module.exports = { fetchWithTimeout, FetchError, failureReason };
