// @ts-check

'use strict';

const {
  apiErrorState, isAuthenticationFailure, API_STATES, REPAIR_MESSAGE,
} = require('./apiError');
const EN = require('../locales/en.json');

/**
 * A translated text from locales/*.json. Falls back to the English text when Homey has no
 * translation for the key (or no i18n at all, as in tests).
 * @param {object} homey
 * @param {string} key e.g. 'errors.gateway_offline'
 * @param {object} [tags] values for __tag__ placeholders
 * @returns {string}
 */
function translate(homey, key, tags = {}) {
  let text;
  try {
    text = homey?.__?.(key, tags);
  } catch (error) {
    text = undefined;
  }
  if (typeof text === 'string' && text !== '' && text !== key) return text;
  const template = key.split('.').reduce((node, part) => node?.[part], EN);
  return Object.entries(tags).reduce(
    (result, [tag, value]) => result.split(`__${tag}__`).join(String(value)),
    typeof template === 'string' ? template : key,
  );
}

/**
 * HH:MM in Homey's time zone, rounded up to the next full minute (so the time shown is never
 * before the moment it stands for). Without a known time zone the time is in UTC and says so.
 * @param {object} homey
 * @param {number} timestamp epoch milliseconds
 * @returns {string}
 */
function formatClockTime(homey, timestamp) {
  const date = new Date(Math.ceil(timestamp / 60000) * 60000);
  const format = (timeZone) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
    const part = (type) => parts.find((item) => item.type === type)?.value;
    return `${part('hour')}:${part('minute')}`;
  };
  try {
    const timeZone = homey?.clock?.getTimezone?.();
    if (typeof timeZone === 'string' && timeZone !== '') return format(timeZone);
  } catch (error) {
    // unknown time zone: use UTC below
  }
  return `${format('UTC')} UTC`;
}

/**
 * Homey's time zone, or undefined when it is not known.
 * @param {object} homey
 * @returns {string | undefined}
 */
function timeZoneOf(homey) {
  try {
    const timeZone = homey?.clock?.getTimezone?.();
    return typeof timeZone === 'string' && timeZone !== '' ? timeZone : undefined;
  } catch (error) {
    return undefined;
  }
}

/**
 * A date and time in Homey's time zone, e.g. "26 Nov, 14:05" (in UTC, saying so, when the time
 * zone is not known).
 * @param {object} homey
 * @param {number} timestamp epoch milliseconds
 * @returns {string}
 */
function formatDateTime(homey, timestamp) {
  const timeZone = timeZoneOf(homey);
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone || 'UTC', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(timestamp)) + (timeZone ? '' : ' UTC');
  } catch (error) {
    return new Date(timestamp).toISOString();
  }
}

/**
 * The message for an API error the user should see right away (see apiErrorState), or null
 * for any other error.
 * @param {object} homey
 * @param {*} error
 * @param {object} [options]
 * @param {number} [options.retryAt] when the app tries again; a rate limit without it gets no message
 * @param {boolean} [options.pairing] the message is shown while adding a device
 * @returns {string|null}
 */
function apiStateMessage(homey, error, { retryAt, pairing = false } = {}) {
  switch (apiErrorState(error)) {
    case API_STATES.PACKAGE_NOT_PAID:
      return translate(homey, pairing ? 'pair.package_not_paid' : 'errors.package_not_paid');
    case API_STATES.GATEWAY_OFFLINE:
      return translate(homey, 'errors.gateway_offline');
    case API_STATES.RATE_LIMITED:
      if (retryAt === undefined || !Number.isFinite(retryAt)) return null;
      return translate(homey, pairing ? 'pair.api_limit' : 'errors.api_limit', { time: formatClockTime(homey, retryAt) });
    default:
      return null;
  }
}

/**
 * What a device says when a poll failed, or null to keep it available and retry with backoff.
 * Right away: what the user should know (Viessmann refuses access, the quota is used up when its
 * reset is known, the gateway is offline), or the Repair message when only a new login helps.
 * After three failures in a row: the API's error, whose message is safe and redacted, or
 * "Multiple communication errors" (network errors can contain request URLs).
 * @param {object} homey
 * @param {*} error
 * @param {number} consecutiveErrors failed polls in a row, this one included
 * @param {{ nextPollAt?: number }} [options] when the next poll runs
 * @returns {string|null}
 */
function pollErrorMessage(homey, error, consecutiveErrors, { nextPollAt } = {}) {
  const stateMessage = apiStateMessage(homey, error, {
    retryAt: Number.isFinite(error?.retryAfterMs) ? nextPollAt : undefined,
  });
  if (stateMessage) return stateMessage;
  if (isAuthenticationFailure(error)) return REPAIR_MESSAGE;
  if (consecutiveErrors >= 3) return error?.status && error.message ? error.message : 'Multiple communication errors';
  return null;
}

module.exports = {
  translate, formatClockTime, formatDateTime, timeZoneOf, apiStateMessage, pollErrorMessage,
};
