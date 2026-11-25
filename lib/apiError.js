'use strict';

const { OAuth2Error } = require('homey-oauth2app');

const MAX_DETAIL_LENGTH = 200;

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

function apiError({
  status, statusText, body, headers,
}) {
  const descriptions = {
    400: 'Invalid command or parameters',
    401: 'Authentication failed; repair the device to sign in again',
    403: 'Write access or API permission denied',
    404: 'Device, circuit or feature not found',
    429: 'API rate limit exceeded',
  };
  const parsed = parseBody(body);
  const details = parsed && typeof parsed === 'object' ? parsed : {};
  const detail = describeErrorBody(parsed);
  const description = descriptions[status] || statusText || 'API request failed';
  const error = new OAuth2Error(`Viessmann HTTP ${status}: ${description}${detail ? ` — ${detail}` : ''}`);
  error.status = status;
  error.requestId = details.viErrorId;
  error.apiCode = details.errorType;
  const retryAfter = headers?.get?.('retry-after');
  if (retryAfter) {
    const milliseconds = /^\d+(\.\d+)?$/.test(retryAfter)
      ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(milliseconds)) error.retryAfterMs = Math.max(0, milliseconds);
  }
  return error;
}

module.exports = { apiError, describeErrorBody, redact };
