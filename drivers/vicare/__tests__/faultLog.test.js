/* eslint-env jest */

'use strict';

// Faults and logbook entries from the features (faultLog.js): each fault reported once while it
// lasts (also across restarts), and only new logbook entries.

const { FaultLog, readFaults, readLogbook } = require('../faultLog');
const { PATHS } = require('../config');

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
const temperature = { feature: PATHS.OUTSIDE_TEMP, isEnabled: true, properties: { value: { value: 3 } } };
const codes = (faults) => faults.map((fault) => fault.code);

test('faults are listed once per code, from the device and the fuel cell; no fault feature says nothing', () => {
  expect(readFaults({ data: [temperature] })).toBeUndefined();
  expect(readFaults({ data: [errors()] })).toEqual([]);
  const fuelCell = { feature: PATHS.FUEL_CELL_ERRORS, isEnabled: true, properties: { entries: { value: [{ errorCode: 'F.454' }, null, 'odd'] } } };
  expect(codes(readFaults({ data: [errors('F.160', 'F.160'), fuelCell] }))).toEqual(['F.160', 'F.454']);
});

test('logbook entries come oldest first, without unusable entries', () => {
  const entries = readLogbook({ data: [logbook(['2026-11-25T19:34:15.000Z', 'A'], ['2026-11-25T19:32:13.000Z', 'B'], ['', 'C'])] });
  expect(entries.map((entry) => entry.event)).toEqual(['B', 'A']);
  expect(entries[1]).toEqual({
    event: 'A', actor: 'SEK_PUMPE1', status: 1, circuit: 'Heizkreis', timestamp: '2026-11-25T19:34:15.000Z',
  });
  expect(readLogbook({ data: [] })).toBeUndefined();
});

test('a fault is new once while it lasts, also across a restart, and again when it returns', () => {
  const log = new FaultLog();
  let result = log.read({ data: [errors('F.160')] });
  expect(codes(result.newFaults)).toEqual(['F.160']);
  expect(result.changed).toBe(true);
  expect(log.read({ data: [errors('F.160')] })).toMatchObject({ newFaults: [], changed: false });

  // After a restart the stored state knows it
  const restarted = new FaultLog(log.state);
  expect(codes(restarted.read({ data: [errors('F.160', 'F.454')] }).newFaults)).toEqual(['F.454']);

  // Cleared, then back
  result = restarted.read({ data: [errors()] });
  expect(result).toMatchObject({ faults: [], changed: true });
  expect(codes(restarted.read({ data: [errors('F.160')] }).newFaults)).toEqual(['F.160']);
});

test('a response without the fault feature keeps the known faults', () => {
  const log = new FaultLog({ faults: ['F.160'] });
  log.read({ data: [errors('F.160')] });
  expect(codes(log.read({ data: [temperature] }).faults)).toEqual(['F.160']);
});

test('the first logbook is history; later entries are new, oldest first', () => {
  const log = new FaultLog();
  expect(log.read({ data: [logbook(['2026-11-25T19:00:00.000Z', 'A'])] })).toMatchObject({ logbook: [], changed: true });
  const result = log.read({
    data: [logbook(['2026-11-25T19:10:00.000Z', 'C'], ['2026-11-25T19:05:00.000Z', 'B'], ['2026-11-25T19:00:00.000Z', 'A'])],
  });
  expect(result.logbook.map((entry) => entry.event)).toEqual(['B', 'C']);
  expect(log.read({ data: [logbook(['2026-11-25T19:10:00.000Z', 'C'])] })).toMatchObject({ logbook: [], changed: false });
  // Same second, another entry
  expect(log.read({ data: [logbook(['2026-11-25T19:10:00.000Z', 'D', 0], ['2026-11-25T19:10:00.000Z', 'C'])] })
    .logbook.map((entry) => entry.event)).toEqual(['D']);
});

test('a broken stored state starts empty', () => {
  expect(new FaultLog({ faults: 'x', logbook: { at: 5, keys: [] } }).state).toEqual({ faults: [], logbook: null });
});
