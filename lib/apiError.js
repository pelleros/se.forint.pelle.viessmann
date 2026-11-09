'use strict';

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

function apiError({ status, body, headers }) {
  const descriptions = {
    400: 'Invalid command or parameters',
    401: 'Authentication failed; repair the device to sign in again',
    403: 'Write access or API permission denied',
    404: 'Device, circuit or feature not found',
    429: 'API rate limit exceeded',
  };
  const details = body && typeof body === 'object' ? body : {};
  const detail = [details.message, details.error, details.reason].find((item) => typeof item === 'string');
  const error = new Error(`Viessmann HTTP ${status}: ${descriptions[status] || 'API request failed'}${detail ? ` â€” ${redact(detail).slice(0, 300)}` : ''}`);
  error.status = status;
  error.requestId = details.viErrorId;
  error.apiCode = details.errorType;
  const retryAfter = headers?.get('retry-after');
  if (retryAfter) {
    const milliseconds = /^\d+(\.\d+)?$/.test(retryAfter)
      ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(milliseconds)) error.retryAfterMs = Math.max(0, milliseconds);
  }
  return error;
}

module.exports = { apiError, redact };
