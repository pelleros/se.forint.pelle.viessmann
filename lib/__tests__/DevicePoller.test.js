/* eslint-env jest */

'use strict';

const DevicePoller = require('../DevicePoller');

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

function makePoller(poll) {
  return new DevicePoller({
    homey: { setTimeout, clearTimeout }, poll, getInterval: () => 120000, onError: jest.fn(),
  });
}

test('backs off on failures, honors Retry-After and returns to normal after success', async () => {
  const poll = jest.fn().mockRejectedValueOnce(Object.assign(new Error('rate limited'), { retryAfterMs: 600000 }))
    .mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  const poller = makePoller(poll);
  await poller.start();
  await jest.advanceTimersByTimeAsync(599999);
  expect(poll).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(poll).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(480000);
  expect(poll).toHaveBeenCalledTimes(3);
  await jest.advanceTimersByTimeAsync(120000);
  expect(poll).toHaveBeenCalledTimes(4);
  await poller.stop();
  expect(jest.getTimerCount()).toBe(0);
});

test('slow requests do not overlap and stopping drains an in-flight request', async () => {
  let resolve;
  const poll = jest.fn().mockImplementation(() => new Promise((done) => {
    resolve = done;
  }));
  const poller = makePoller(poll);
  const started = poller.start();
  await poller.start();
  poller.schedule();
  await jest.advanceTimersByTimeAsync(1000000);
  expect(poll).toHaveBeenCalledTimes(1);
  const stopped = poller.stop();
  resolve();
  await Promise.all([started, stopped]);
  expect(jest.getTimerCount()).toBe(0);
});
