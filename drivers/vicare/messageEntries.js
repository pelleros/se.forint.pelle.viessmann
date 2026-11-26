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

// Lists of messages the heating system reports (faults, logbook entries, the event log): reading
// their entries safely, and how far a list has been read, so that only new entries count. Pure
// functions, shared by faultLog.js and eventLog.js.

/**
 * How far a list has been read: the newest time seen and the keys of the entries at that time
 * (several entries can share a time).
 * @template T
 * @typedef {{ at: T, keys: string[] }} ReadPosition
 */

/**
 * The text of a value, or undefined when it is no string or number.
 * @param {unknown} value
 * @returns {string | undefined}
 */
function text(value) {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/**
 * The entries array of a feature (objects only), or none.
 * @param {any} feature
 * @returns {any[]}
 */
function entriesOf(feature) {
  const entries = feature?.isEnabled !== false ? feature?.properties?.entries?.value : undefined;
  return Array.isArray(entries) ? entries.filter((entry) => entry && typeof entry === 'object') : [];
}

/**
 * A stored read position, or null when there is none (or it is broken).
 * @template T
 * @param {any} stored
 * @param {(at: unknown) => boolean} isTime
 * @returns {ReadPosition<T> | null}
 */
function positionFrom(stored, isTime) {
  return stored && isTime(stored.at) && Array.isArray(stored.keys) ? { at: stored.at, keys: stored.keys } : null;
}

/**
 * The entries after a read position, oldest first, and the position after them. Without a
 * position every entry is new.
 * @template E, T
 * @param {E[]} entries oldest first
 * @param {ReadPosition<T> | null} position
 * @param {(entry: E) => T} timeOf
 * @param {(entry: E) => string} keyOf
 * @returns {{ fresh: E[], position: ReadPosition<T> | null, changed: boolean }}
 */
function entriesAfter(entries, position, timeOf, keyOf) {
  const fresh = entries.filter((entry) => !position || timeOf(entry) > position.at
    || (timeOf(entry) === position.at && !position.keys.includes(keyOf(entry))));
  if (fresh.length === 0) return { fresh, position, changed: false };
  const newest = timeOf(fresh[fresh.length - 1]);
  const keys = fresh.filter((entry) => timeOf(entry) === newest).map(keyOf);
  const merged = position && position.at === newest ? [...new Set([...position.keys, ...keys])] : keys;
  return { fresh, position: { at: newest, keys: merged }, changed: true };
}

module.exports = {
  text, entriesOf, positionFrom, entriesAfter,
};
