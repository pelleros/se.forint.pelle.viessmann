/* eslint-env jest */

'use strict';

// The heating curve cards (heatingCurve.js): both values are sent together, checked against the
// device's limits, rounded to its steps, limited per hour, and unchanged values are not sent.

// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const { polledFixtureDevice } = require('../../../test/helpers/polledFixtureDevice');
const heatingCurve = require('../heatingCurve');
const { WRITE_LIMITS } = require('../writeLimits');

const { SHIFT, SLOPE } = heatingCurve;

let now;
beforeEach(() => {
  now = Date.parse('2026-11-26T12:00:00Z');
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => jest.restoreAllMocks());

const sent = (device) => device.oAuth2Client.executeCommand.mock.calls.map(([request]) => request);

test('the read-back capabilities show the curve (Vitocal 222: shift -8, slope 0.9)', async () => {
  const { device } = await polledFixtureDevice();
  expect(device.getCapabilityValue(SHIFT)).toBe(-8);
  expect(device.getCapabilityValue(SLOPE)).toBe(0.9);
});

test('setting the shift sends the current slope with it and shows the new value', async () => {
  const { device } = await polledFixtureDevice();
  await expect(heatingCurve.writeCurve(device, { shift: -5 })).resolves.toBe(true);
  expect(sent(device)).toEqual([expect.objectContaining({
    feature: 'heating.circuits.0.heating.curve', command: 'setCurve', body: { slope: 0.9, shift: -5 },
  })]);
  expect(device.getCapabilityValue(SHIFT)).toBe(-5);
  expect(device.getCapabilityValue(SLOPE)).toBe(0.9);
});

test('setting the slope sends the current shift, rounded to the device\'s steps', async () => {
  const { device } = await polledFixtureDevice();
  await heatingCurve.writeCurve(device, { slope: 1.34 });
  expect(sent(device)[0].body).toEqual({ slope: 1.3, shift: -8 });
  // Steps of 0.1 counted from the minimum (0.2 on this gas boiler); no float noise
  const gas = await polledFixtureDevice({ fixture: 'vitodens_200_e3_features.json', roles: ['type:heating', 'type:boiler'] });
  await heatingCurve.writeCurve(gas.device, { slope: 1.4 + 0.1 });
  expect(sent(gas.device)[0].body).toEqual({ slope: 1.5, shift: 2 });
});

test('adjusting the shift adds to the current shift', async () => {
  const { device } = await polledFixtureDevice();
  await heatingCurve.adjustShift(device, 3);
  await heatingCurve.adjustShift(device, -1);
  expect(sent(device).map((request) => request.body.shift)).toEqual([-5, -6]);
});

test('a write to the device\'s other heating circuit goes to that circuit', async () => {
  const { device } = await polledFixtureDevice({ fixture: 'pyvicare/Vitocal250A_TwoCircuits.json', heatingCircuitId: '1' });
  const shift = device.getCapabilityValue(SHIFT);
  await heatingCurve.writeCurve(device, { shift: shift + 1 });
  expect(sent(device)[0].feature).toBe('heating.circuits.1.heating.curve');
});

test('a value the curve already has is not sent and not counted', async () => {
  const { device } = await polledFixtureDevice();
  await expect(heatingCurve.writeCurve(device, { shift: -8, slope: 0.9 })).resolves.toBe(false);
  await expect(heatingCurve.adjustShift(device, 0)).resolves.toBe(false);
  expect(sent(device)).toEqual([]);
  expect(device._writeLimiters).toBeUndefined();
});

test('a value outside the device\'s limits is refused before anything is sent or counted', async () => {
  const { device } = await polledFixtureDevice();
  await expect(heatingCurve.writeCurve(device, { shift: 41 })).rejects.toThrow('shift is outside the supported range');
  await expect(heatingCurve.adjustShift(device, -8)).rejects.toThrow('shift is outside the supported range');
  expect(sent(device)).toEqual([]);
  expect(device._writeLimiters).toBeUndefined();
});

test('at most 12 changes per hour; the next one says when it is possible again', async () => {
  const { device } = await polledFixtureDevice();
  const limit = WRITE_LIMITS.heatingCurve;
  expect(limit).toBe(12);
  for (let i = 1; i <= limit; i++) {
    await heatingCurve.writeCurve(device, { shift: -8 + i });
    now += 60 * 1000;
  }
  await expect(heatingCurve.writeCurve(device, { shift: 10 })).rejects.toThrow('at most 12 per hour). Try again in 48 minutes.');
  expect(sent(device)).toHaveLength(limit);
  now += 48 * 60 * 1000;
  await expect(heatingCurve.writeCurve(device, { shift: 0 })).resolves.toBe(true);
});

test('an unknown curve value fails the card and sends nothing', async () => {
  const { device } = await polledFixtureDevice();
  device.__values.set(SLOPE, null);
  await expect(heatingCurve.writeCurve(device, { shift: 1 })).rejects.toThrow('No current value from Viessmann yet');
  expect(sent(device)).toEqual([]);
});

test('a command Viessmann rejects fails the card and the curve shows the old values', async () => {
  const { device } = await polledFixtureDevice();
  device.oAuth2Client.executeCommand.mockResolvedValueOnce({ data: { success: false, reason: 'busy' } });
  await expect(heatingCurve.writeCurve(device, { shift: 1 })).rejects.toThrow('Error executing command: Viessmann rejected command: busy');
  expect(device.getCapabilityValue(SHIFT)).toBe(-8);
  device.oAuth2Client.executeCommand.mockRejectedValueOnce('offline');
  await expect(heatingCurve.writeCurve(device, { shift: 1 })).rejects.toThrow('Error executing command: offline');
});

test('roundToStep without a stepping leaves the value alone', () => {
  expect(heatingCurve.roundToStep(1.234, undefined)).toBe(1.234);
  expect(heatingCurve.roundToStep(7, { stepping: 1 })).toBe(7);
});
