// @ts-check

'use strict';

const { OAuth2Error } = require('homey-oauth2app');

/**
 * An error from the API or the token endpoint, with what the app needs to handle it.
 * @typedef {InstanceType<typeof OAuth2Error> & {
 *   status?: number, requestId?: string, apiCode?: string, apiReason?: string,
 *   retryAfterMs?: number, authenticationFailed?: boolean,
 * }} ApiError
 */

const MAX_DETAIL_LENGTH = 200;

// Shown when only a new login helps (the device's Repair flow)
const REPAIR_MESSAGE = 'Authentication failed, open the device and choose Repair';

// Token endpoint errors (RFC 6749 section 5.2) that only a new login fixes
const LOGIN_ERRORS = ['invalid_grant', 'invalid_client'];

// Error states that are shown to the user right away, see apiErrorState()
const API_STATES = {
  PACKAGE_NOT_PAID: 'packageNotPaid',
  RATE_LIMITED: 'rateLimited',
  GATEWAY_OFFLINE: 'gatewayOffline',
};

// Short codes such as GATEWAY_OFFLINE; anything else in extendedPayload is never read
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

function redact(value, secrets = []) {
  if (typeof value === 'string') {
    let result = value.replace(/(Bearer\s+)[^\s"&]+/gi, '$1[redacted]')
      .replace(/((?:access_token|refresh_token|code_verifier|client_secret)["\s]*[=:]["\s]*)[^\s"&,}]+/gi, '$1[redacted]');
    for (const secret of secrets) result = result.split(secret).join('[redacted]');
    return result;
  }
  if (value instanceof Error) return redact(value.message, secrets);
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key, /^(access_token|refresh_token|authorization|code_verifier|client_secret)$/i.test(key)
        ? '[redacted]' : redact(item, secrets),
    ]));
  }
  return value;
}

const truncate = (text) => (text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH)}…` : text);

// The SDK passes the body as parsed JSON or, without a JSON content type, as text
function parseBody(body) {
  if (typeof body !== 'string') return body;
  const text = body.trim();
  try {
    const json = JSON.parse(text);
    if (json && typeof json === 'object') return json;
  } catch (err) {
    // not JSON
  }
  return text;
}

/**
 * Builds a short, user facing description of an error response body. Viessmann returns
 * `{ errorType, message, extendedPayload, ... }`; the IdP returns `{ error, error_description }`.
 * Only these known text fields are used, since `extendedPayload` can hold client and user IDs.
 * @param {*} body parsed JSON, text, or nothing
 * @returns {string} empty if the body has nothing useful
 */
function describeErrorBody(body) {
  if (typeof body === 'string') {
    // nothing, or an HTML error page
    return body === '' || body.startsWith('<') ? '' : truncate(redact(body));
  }
  if (!body || typeof body !== 'object') return '';

  const parts = [body.errorType, body.message, body.error, body.error_description, body.reason]
    .filter((part) => typeof part === 'string' && part.trim() !== '')
    .map((part) => part.trim());
  return truncate(redact([...new Set(parts)].join(': ')));
}

/**
 * Milliseconds until the time given by a Retry-After header (seconds or an HTTP date).
 * @param {string | null | undefined} value
 * @returns {number | undefined}
 */
function parseRetryAfter(value) {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const milliseconds = /^\d+(\.\d+)?$/.test(value.trim())
    ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : undefined;
}

/**
 * @param {{ status: number, statusText?: string, body?: unknown,
 *   headers?: { get?: (name: string) => string | null } }} response
 * @returns {ApiError}
 */
function apiError({
  status, statusText, body, headers,
}) {
  const descriptions = {
    400: 'Invalid command or parameters',
    401: REPAIR_MESSAGE,
    402: 'Paid API package required',
    403: 'Write access or API permission denied',
    404: 'Device, circuit or feature not found',
    429: 'API rate limit exceeded',
  };
  const parsed = parseBody(body);
  const details = parsed && typeof parsed === 'object' ? parsed : {};
  const payload = details.extendedPayload && typeof details.extendedPayload === 'object' ? details.extendedPayload : {};
  const reason = typeof payload.reason === 'string' && CODE_PATTERN.test(payload.reason) ? payload.reason : undefined;
  let detail = describeErrorBody(parsed);
  if (reason && !detail.includes(reason)) detail = detail ? `${detail} (${reason})` : reason;
  const description = descriptions[status] || statusText || 'API request failed';
  /** @type {ApiError} */
  const error = new OAuth2Error(`Viessmann HTTP ${status}: ${description}${detail ? ` — ${detail}` : ''}`);
  error.status = status;
  error.requestId = details.viErrorId;
  error.apiCode = details.errorType;
  error.apiReason = reason;
  // Wait for the later of Retry-After and the quota reset time in the body (epoch milliseconds)
  const waits = [parseRetryAfter(headers?.get?.('retry-after'))];
  if (status === 429 && Number.isFinite(payload.limitReset)) waits.push(Math.max(0, payload.limitReset - Date.now()));
  const wait = Math.max(...waits.filter(/** @returns {value is number} */ (value) => value !== undefined));
  if (Number.isFinite(wait)) error.retryAfterMs = wait;
  return error;
}

/**
 * Classifies an API error as one of API_STATES, or returns null for any other error.
 * @param {*} error error from apiError() (or anything else)
 * @returns {string|null}
 */
function apiErrorState(error) {
  if (!error || typeof error !== 'object') return null;
  if (error.status === 402 || error.apiCode === 'PACKAGE_NOT_PAID_FOR') return API_STATES.PACKAGE_NOT_PAID;
  if (error.status === 429) return API_STATES.RATE_LIMITED;
  if (error.apiReason === 'GATEWAY_OFFLINE' || error.apiCode === 'GATEWAY_OFFLINE') return API_STATES.GATEWAY_OFFLINE;
  return null;
}

/**
 * Error for a failed request to the token endpoint (login or token refresh). Only a 401 or
 * an `invalid_grant`/`invalid_client` answer means that the user has to log in again; those
 * errors have `authenticationFailed`. Anything else (5xx, other 4xx) is treated as temporary.
 * The IdP's `error`/`error_description` are kept in the message.
 */
/**
 * @param {{ status: number, statusText?: string, body?: unknown, duringLogin?: boolean }} response
 * @returns {ApiError}
 */
function tokenError({
  status, statusText, body, duringLogin = false,
}) {
  const parsed = parseBody(body);
  const code = parsed && typeof parsed === 'object' && typeof parsed.error === 'string' ? parsed.error : undefined;
  const detail = describeErrorBody(parsed);
  const authenticationFailed = status === 401 || LOGIN_ERRORS.includes(code);
  let message;
  if (authenticationFailed) {
    message = `Viessmann login rejected${detail ? ` (${detail})` : ''}`;
    if (!duringLogin) message += `. ${REPAIR_MESSAGE}`;
  } else {
    message = `Viessmann token request failed (HTTP ${status}${statusText ? ` ${statusText}` : ''})${detail ? ` — ${detail}` : ''}`;
  }
  /** @type {ApiError} */
  const error = new OAuth2Error(message);
  error.status = status;
  error.apiCode = code;
  error.authenticationFailed = authenticationFailed;
  return error;
}

// True when only a new login (Repair) helps
function isAuthenticationFailure(error) {
  if (typeof error?.authenticationFailed === 'boolean') return error.authenticationFailed;
  return error?.status === 401
    || /unauthorized/i.test(typeof error?.message === 'string' ? error.message : '');
}

module.exports = {
  apiError, tokenError, isAuthenticationFailure, apiErrorState, describeErrorBody, redact, API_STATES, REPAIR_MESSAGE,
};
