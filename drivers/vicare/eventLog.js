/*
 *
 *  Copyright (C) 2024 Per Rosengren
 *  This file is part of se.forint.pelle.viessmann project.
 *
 *  se.forint.pelle.viessmann project is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  se.forint.pelle.viessmann project is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with se.forint.pelle.viessmann project.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

// @ts-check

'use strict';

// The installation's event log (faults, status messages, gateway online/offline), read slowly when
// the device setting `eventLog` is on: the events of one device, and which of them are new since
// the last read. Pure; the device keeps its read position in its store (`knownMessages.events`).

const { text, positionFrom, entriesAfter } = require('./messageEntries');

/** @typedef {import('./messageEntries').ReadPosition<number>} EventPosition */

/**
 * An entry of the installation's event log.
 * @typedef {object} LoggedEvent
 * @property {string} code an error or status code, or the event type
 * @property {string} description
 * @property {string} type e.g. device-error
 * @property {boolean} active
 * @property {number} time epoch milliseconds
 */

/**
 * The event log interval in minutes from the device setting, or 0 when it is off.
 * @param {unknown} setting
 * @returns {number}
 */
function eventLogMinutes(setting) {
  const minutes = Number(setting);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}

/**
 * One event of a response for a device, or undefined (another device's, or unusable).
 * @param {any} item
 * @param {string | undefined} deviceId
 * @returns {LoggedEvent | undefined}
 */
function readEvent(item, deviceId) {
  if (!item || typeof item !== 'object') return undefined;
  const body = item.body && typeof item.body === 'object' ? item.body : {};
  if (body.deviceId !== undefined && deviceId !== undefined && String(body.deviceId) !== String(deviceId)) return undefined;
  const time = Date.parse(item.eventTimestamp || item.createdAt || item.timestamp);
  const type = text(item.eventType) || '';
  const code = text(body.errorCode) || text(body.statusCode) || text(body.code) || type;
  if (!Number.isFinite(time) || !code) return undefined;
  return {
    code,
    description: text(body.errorDescription) || text(body.description) || '',
    type,
    active: typeof body.active === 'boolean' ? body.active : true,
    time,
  };
}

/**
 * The events of an event log response for one device (events of other devices on the same
 * gateway are left out), oldest first.
 * @param {any} response
 * @param {string | undefined} deviceId
 * @returns {LoggedEvent[]}
 */
function readEvents(response, deviceId) {
  let items = [];
  if (Array.isArray(response?.data)) items = response.data;
  else if (Array.isArray(response)) items = response;
  return items.map((item) => readEvent(item, deviceId))
    .filter(/** @returns {event is LoggedEvent} */ (event) => event !== undefined)
    .sort((a, b) => a.time - b.time);
}

const eventKey = (/** @type {LoggedEvent} */ event) => `${event.time}|${event.type}|${event.code}|${event.active}`;

/**
 * The stored read position, or null.
 * @param {any} stored
 * @returns {EventPosition | null}
 */
const eventPositionFrom = (stored) => positionFrom(stored, (at) => Number.isFinite(at));

/**
 * The position from which a newly turned on event log is read: now, unless one is known.
 * @param {EventPosition | null} position
 * @param {number} now
 * @returns {EventPosition}
 */
const startPosition = (position, now) => position || { at: now, keys: [] };

/**
 * The new events of a response after the read position, and the new position. Events older than
 * `since` are not returned (e.g. those from while the app was not running).
 * @param {any} response
 * @param {string | undefined} deviceId
 * @param {EventPosition | null} position
 * @param {number} since
 * @returns {{ events: LoggedEvent[], position: EventPosition | null, changed: boolean }}
 */
function newEvents(response, deviceId, position, since) {
  const after = entriesAfter(readEvents(response, deviceId), position, (event) => event.time, eventKey);
  return { events: after.fresh.filter((event) => event.time >= since), position: after.position, changed: after.changed };
}

/**
 * True when a "event with code" Flow card's argument names the event's code (case does not matter).
 * @param {{ code?: unknown }} args the card's arguments
 * @param {{ code?: unknown }} state the event
 * @returns {boolean}
 */
function matchesEventCode(args, state) {
  return typeof args?.code === 'string' && args.code.trim().toLowerCase() === String(state?.code ?? '').toLowerCase();
}

module.exports = {
  readEvents, newEvents, eventPositionFrom, startPosition, eventLogMinutes, matchesEventCode,
};
