/* eslint-env jest */

'use strict';

// Reading message lists safely and how far they have been read (messageEntries.js).

const {
  text, entriesOf, positionFrom, entriesAfter,
} = require('../messageEntries');

test('texts are trimmed strings or numbers', () => {
  expect([' F.160 ', 42, '', '  ', null, {}, Number.NaN].map(text)).toEqual(['F.160', '42', undefined, undefined, undefined, undefined, undefined]);
});

test('entries are the objects of an enabled feature', () => {
  expect(entriesOf({ isEnabled: true, properties: { entries: { value: [{ a: 1 }, null, 'x'] } } })).toEqual([{ a: 1 }]);
  expect(entriesOf({ isEnabled: false, properties: { entries: { value: [{ a: 1 }] } } })).toEqual([]);
  expect(entriesOf(undefined)).toEqual([]);
});

test('stored positions are checked', () => {
  expect(positionFrom({ at: 5, keys: ['k'] }, Number.isFinite)).toEqual({ at: 5, keys: ['k'] });
  expect(positionFrom({ at: 'x', keys: [] }, Number.isFinite)).toBeNull();
  expect(positionFrom({ at: 5, keys: 'no' }, Number.isFinite)).toBeNull();
  expect(positionFrom(undefined, Number.isFinite)).toBeNull();
});

test('entries after a position: newer ones, and unseen ones at the same time', () => {
  const time = (entry) => entry.t;
  const key = (entry) => entry.k;
  const entries = [{ t: 1, k: 'a' }, { t: 2, k: 'b' }, { t: 2, k: 'c' }];
  expect(entriesAfter(entries, { at: 2, keys: ['b'] }, time, key)).toEqual({ fresh: [{ t: 2, k: 'c' }], position: { at: 2, keys: ['b', 'c'] }, changed: true });
  expect(entriesAfter(entries, null, time, key)).toEqual({ fresh: entries, position: { at: 2, keys: ['b', 'c'] }, changed: true });
  expect(entriesAfter(entries, { at: 2, keys: ['b', 'c'] }, time, key)).toEqual({ fresh: [], position: { at: 2, keys: ['b', 'c'] }, changed: false });
});
