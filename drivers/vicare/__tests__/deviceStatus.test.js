/* eslint-env jest */

'use strict';

// The device's status from its responses (deviceStatus.js): faults reported once, new logbook
// entries, values that stopped updating, and writes that did not take.

const {
  StatusTracker, readFaults, readLogbook, newestTimestamp, FROZEN_AFTER, WRITE_CHECK_AFTER, WRITE_CHECK_EXPIRY,
} = require('../deviceStatus');
const { PATHS } = require('../config');

const MINUTE = 60 * 1000;
const NOW = Date.parse('2026-11-26T12:00:00Z');

const errors = (...codes) => ({
  feature: PATHS.DEVICE_ERRORS,
  isEnabled: true,
  properties: { entries: { type: 'array', value: codes.map((code) => ({ errorCode: code, priority: 'error', timestamp: '2026-11-26T10:00:00.000Z' })) } },
});
const logbook = (...entries) => ({
  feature: PATHS.LOGBOOK,
  isEnabled: true,
  properties: {
    entries: {
      type: 'array',
      value: entries.map(([timestamp, event, status = 1]) => ({
        timestamp, event, actor: 'SEK_PUMPE1', status, circuit: 'Heizkreis', stateMachine: 'X', additionalInfo: 2,
      })),
    },
  },
});
const temperature = (timestamp) => ({
  feature: PATHS.OUTSIDE_TEMP, isEnabled: true, timestamp, properties: { value: { value: 3 } },
});

describe('reading faults and the logbook', () => {
  test('faults are listed once per code, from the device and the fuel cell; no fault feature says nothing', () => {
    expect(readFaults({ data: [temperature('2026-11-26T11:00:00Z')] })).toBeUndefined();
    expect(readFaults({ data: [errors()] })).toEqual([]);
    const fuelCell = { feature: PATHS.FUEL_CELL_ERRORS, isEnabled: true, properties: { entries: { value: [{ errorCode: 'F.454' }, null, 'odd'] } } };
    expect(readFaults({ data: [errors('F.160', 'F.160'), fuelCell] }).map((fault) => fault.code)).toEqual(['F.160', 'F.454']);
  });

  test('logbook entries come newest first, without unusable entries', () => {
    const entries = readLogbook({ data: [logbook(['2026-11-25T19:32:13.000Z', 'B'], ['2026-11-25T19:34:15.000Z', 'A'], ['', 'C'])] });
    expect(entries.map((entry) => entry.event)).toEqual(['A', 'B']);
    expect(entries[0]).toEqual({
      event: 'A', actor: 'SEK_PUMPE1', status: 1, circuit: 'Heizkreis', timestamp: '2026-11-25T19:34:15.000Z',
    });
    expect(readLogbook({ data: [] })).toBeUndefined();
  });

  test('the newest feature timestamp', () => {
    expect(newestTimestamp({ data: [temperature('2026-11-26T10:00:00Z'), temperature('2026-11-26T11:00:00Z'), temperature('garbage')] }))
      .toBe(Date.parse('2026-11-26T11:00:00Z'));
    expect(newestTimestamp({ data: [] })).toBeUndefined();
  });
});

describe('StatusTracker', () => {
  test('a fault is new once while it lasts, also across a restart, and again when it returns', () => {
    const tracker = new StatusTracker();
    let result = tracker.read({ data: [errors('F.160')] }, NOW);
    expect(result.newFaults.map((fault) => fault.code)).toEqual(['F.160']);
    expect(result.knownChanged).toBe(true);
    expect(tracker.read({ data: [errors('F.160')] }, NOW + MINUTE)).toMatchObject({ newFaults: [], knownChanged: false });

    // After a restart the stored list knows it
    const restarted = new StatusTracker({ known: tracker.known });
    expect(restarted.read({ data: [errors('F.160', 'F.454')] }, NOW).newFaults.map((fault) => fault.code)).toEqual(['F.454']);

    // Cleared, then back
    result = restarted.read({ data: [errors()] }, NOW + MINUTE);
    expect(result).toMatchObject({ faults: [], knownChanged: true });
    expect(restarted.read({ data: [errors('F.160')] }, NOW + 2 * MINUTE).newFaults.map((fault) => fault.code)).toEqual(['F.160']);
  });

  test('a response without the fault feature keeps the known faults', () => {
    const tracker = new StatusTracker({ known: { faults: ['F.160'] } });
    tracker.read({ data: [errors('F.160')] }, NOW);
    expect(tracker.read({ data: [temperature('2026-11-26T11:00:00Z')] }, NOW).faults.map((fault) => fault.code)).toEqual(['F.160']);
  });

  test('the first logbook is history; later entries are new, oldest first', () => {
    const tracker = new StatusTracker();
    expect(tracker.read({ data: [logbook(['2026-11-25T19:00:00.000Z', 'A'])] }, NOW)).toMatchObject({ logbook: [], knownChanged: true });
    const result = tracker.read({
      data: [logbook(['2026-11-25T19:10:00.000Z', 'C'], ['2026-11-25T19:05:00.000Z', 'B'], ['2026-11-25T19:00:00.000Z', 'A'])],
    }, NOW + MINUTE);
    expect(result.logbook.map((entry) => entry.event)).toEqual(['B', 'C']);
    expect(tracker.read({ data: [logbook(['2026-11-25T19:10:00.000Z', 'C'])] }, NOW + 2 * MINUTE)).toMatchObject({ logbook: [], knownChanged: false });
    // Same second, another entry
    expect(tracker.read({ data: [logbook(['2026-11-25T19:10:00.000Z', 'D', 0], ['2026-11-25T19:10:00.000Z', 'C'])] }, NOW + 3 * MINUTE)
      .logbook.map((entry) => entry.event)).toEqual(['D']);
  });

  test('values are frozen when no timestamp moves for a long time while polls work', () => {
    const tracker = new StatusTracker();
    const old = '2026-11-20T08:00:00.000Z';
    // Old timestamps at the start are not enough: only what the app sees counts
    expect(tracker.read({ data: [temperature(old)] }, NOW).frozenSince).toBeNull();
    expect(tracker.read({ data: [temperature(old)] }, NOW + FROZEN_AFTER - MINUTE).frozenSince).toBeNull();
    expect(tracker.read({ data: [temperature(old)] }, NOW + FROZEN_AFTER).frozenSince).toBe(Date.parse(old));
    // Moving again ends it
    expect(tracker.read({ data: [temperature('2026-11-26T18:00:00.000Z')] }, NOW + FROZEN_AFTER + MINUTE).frozenSince).toBeNull();
  });

  test('writes are checked on a poll a minute later: confirmed, rejected, or forgotten', () => {
    const tracker = new StatusTracker();
    tracker.rememberWrite('target_temperature.hotWater', 50, NOW);
    tracker.rememberWrite('thermostat_mode.heating', 'standby', NOW);
    tracker.rememberWrite('target_temperature.heating', 21, NOW);
    const reported = { 'target_temperature.hotWater': 50.004, 'thermostat_mode.heating': 'dhw' };

    // Too early: nothing checked
    expect(tracker.checkWrites((name) => reported[name], NOW + 10 * 1000)).toEqual({ rejected: [], confirmed: [] });
    expect(tracker.checkWrites((name) => reported[name], NOW + WRITE_CHECK_AFTER)).toEqual({
      rejected: [{ capabilityName: 'thermostat_mode.heating', wanted: 'standby', actual: 'dhw' }],
      confirmed: ['target_temperature.hotWater'],
    });
    // Not reported: kept for a while, then forgotten without a message
    expect(tracker.writes.has('target_temperature.heating')).toBe(true);
    expect(tracker.checkWrites(() => undefined, NOW + WRITE_CHECK_EXPIRY + 1)).toEqual({ rejected: [], confirmed: [] });
    expect(tracker.writes.size).toBe(0);
  });
});
