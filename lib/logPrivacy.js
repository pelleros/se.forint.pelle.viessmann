// @ts-check

'use strict';

// Masks identifiers before they reach the app's log (and with it diagnostic reports): the Client
// ID, installation ids, gateway serials and device serials. The last characters stay, so that
// devices can still be told apart in a log.

const VISIBLE = 3;

/**
 * '7633107000000001' → '…001'. Short values (generic device ids such as '0' or 'gateway') stay.
 * @param {unknown} value
 * @returns {string}
 */
function maskId(value) {
  if (value === undefined || value === null || value === '') return String(value);
  const text = String(value);
  return text.length <= VISIBLE ? text : `…${text.slice(-VISIBLE)}`;
}

/**
 * A device's polling key `installationId-gatewaySerial-deviceId` with the installation id and
 * gateway serial masked (the device id is generic, e.g. '0').
 * @param {string} key
 * @returns {string}
 */
function maskDeviceKey(key) {
  const [installationId, gatewaySerial, ...deviceId] = String(key).split('-');
  if (deviceId.length === 0) return maskId(key);
  return [maskId(installationId), maskId(gatewaySerial), deviceId.join('-')].join('-');
}

// Path segments of the API whose value identifies an installation, a gateway or a device
const ID_SEGMENTS = /(\/(?:installations|gateways)\/)([^/?#\s"]+)/g;
// Query and form parameters that carry the Client ID
const CLIENT_ID_PARAMETER = /(client_id=)([^&\s"]+)/g;

/**
 * Masks the ids in API URLs and `client_id` parameters inside a text, and the given values
 * (e.g. the Client ID) wherever they appear.
 * @param {string} text
 * @param {unknown[]} [values]
 * @returns {string}
 */
function maskText(text, values = []) {
  let masked = text.replace(ID_SEGMENTS, (match, segment, id) => `${segment}${maskId(id)}`)
    .replace(CLIENT_ID_PARAMETER, (match, parameter, id) => `${parameter}${maskId(id)}`);
  for (const value of values) {
    if (typeof value === 'string' && value.length > VISIBLE) masked = masked.split(value).join(maskId(value));
  }
  return masked;
}

/**
 * maskText for log arguments: strings are masked, errors by their message, arrays and plain
 * objects recursively; other values are kept.
 * @param {unknown} value
 * @param {unknown[]} [values]
 * @returns {unknown}
 */
function maskForLog(value, values = []) {
  if (typeof value === 'string') return maskText(value, values);
  if (value instanceof Error) return maskText(value.message, values);
  if (Array.isArray(value)) return value.map((item) => maskForLog(item, values));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, maskForLog(item, values)]));
  }
  return value;
}

module.exports = {
  maskId, maskDeviceKey, maskText, maskForLog,
};
