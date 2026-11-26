/* eslint-env jest */

'use strict';

const DevicePoller = require('../DevicePoller');

const { POLL_TIMEOUT, STOP_TIMEOUT } = DevicePoller;

// Starts polling without waiting for the first poll
function startInBackground(poller) {
  poller.start().catch(() => {});
}

// Stops a poller whose poll never settles, without waiting for it
function stopAndForget(poller) {
  poller.stop().catch(() => {});
  jest.clearAllTimers();
}

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

test('slow requests within the deadline do not overlap and stopping drains an in-flight request', async () => {
  let resolve;
  const poll = jest.fn().mockImplementation(() => new Promise((done) => {
    resolve = done;
  }));
  const poller = makePoller(poll);
  const started = poller.start();
  await poller.start();
  poller.schedule();
  await jest.advanceTimersByTimeAsync(POLL_TIMEOUT - 1);
  expect(poll).toHaveBeenCalledTimes(1);
  const stopped = poller.stop();
  resolve();
  await Promise.all([started, stopped]);
  expect(jest.getTimerCount()).toBe(0);
});

describe('a poll that never settles (e.g. a request on a half-open connection)', () => {
  const never = () => new Promise(() => {});

  test('fails after the deadline and the next poll is still scheduled', async () => {
    const poll = jest.fn(never);
    const poller = makePoller(poll);
    startInBackground(poller);

    await jest.advanceTimersByTimeAsync(POLL_TIMEOUT);
    expect(poller.onError).toHaveBeenCalledWith(expect.objectContaining({ name: 'PollTimeoutError' }), 1, expect.any(Object));
    expect(poller.running).toBeNull();

    // Backoff after one failure: twice the interval
    await jest.advanceTimersByTimeAsync(2 * 120000);
    expect(poll).toHaveBeenCalledTimes(2);
    stopAndForget(poller);
  });

  test('keeps polling day after day while every request hangs', async () => {
    const poll = jest.fn(never);
    const poller = makePoller(poll);
    startInBackground(poller);

    await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    // Backoff caps at 30 minutes between polls (plus the deadline)
    expect(poll.mock.calls.length).toBeGreaterThan(40);
    stopAndForget(poller);
  });

  test('a result that arrives after the deadline is not applied', async () => {
    let finish;
    const applied = jest.fn();
    const poll = jest.fn(async (isStopped) => {
      await new Promise((done) => {
        finish = done;
      });
      if (!isStopped()) applied();
    });
    const poller = makePoller(poll);
    startInBackground(poller);
    await jest.advanceTimersByTimeAsync(POLL_TIMEOUT);

    finish();
    await jest.advanceTimersByTimeAsync(0);
    expect(applied).not.toHaveBeenCalled();
    expect(poller.failures).toBe(1);
    await poller.stop();
  });

  test('stop() returns after a short wait instead of waiting for it', async () => {
    const poll = jest.fn(never);
    const poller = makePoller(poll);
    startInBackground(poller);
    await jest.advanceTimersByTimeAsync(1000);

    let stopped = false;
    poller.stop().then(() => {
      stopped = true;
    }, () => {});
    await jest.advanceTimersByTimeAsync(STOP_TIMEOUT);
    expect(stopped).toBe(true);

    // The abandoned poll ends at its deadline without reporting an error or polling again
    await jest.advanceTimersByTimeAsync(POLL_TIMEOUT);
    expect(poller.onError).not.toHaveBeenCalled();
    expect(poll).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('pause() and resume()', () => {
  test('keep the backoff and Retry-After and add no poll', async () => {
    const poll = jest.fn().mockRejectedValue(Object.assign(new Error('rate limited'), { retryAfterMs: 3600000 }));
    const poller = makePoller(poll);
    await poller.start();
    const { retryAt } = poller;

    await jest.advanceTimersByTimeAsync(600000);
    await poller.pause();
    await jest.advanceTimersByTimeAsync(3600000);
    expect(poll).toHaveBeenCalledTimes(1);

    poller.resume();
    expect(poller.failures).toBe(1);
    expect(poller.retryAt).toBe(retryAt);
    // Retry-After has passed meanwhile: the backoff (twice the interval) applies from now
    await jest.advanceTimersByTimeAsync(2 * 120000 - 1);
    expect(poll).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(2);
    await poller.stop();
  });

  test('drop a poll in progress without counting it', async () => {
    let finish;
    const applied = jest.fn();
    const poll = jest.fn(async (isStopped) => {
      await new Promise((done) => {
        finish = done;
      });
      if (!isStopped()) applied();
    });
    const poller = makePoller(poll);
    startInBackground(poller);

    const paused = poller.pause();
    finish();
    await paused;
    poller.resume();

    expect(applied).not.toHaveBeenCalled();
    expect(poller.failures).toBe(0);
    expect(jest.getTimerCount()).toBe(1);
    await poller.stop();
  });
});

test('pollNow polls at once and keeps the interval after it; not while backing off', async () => {
  const poll = jest.fn().mockResolvedValue(undefined);
  const poller = makePoller(poll);
  await poller.start();
  await jest.advanceTimersByTimeAsync(30000);
  await poller.pollNow();
  expect(poll).toHaveBeenCalledTimes(2);
  // The next poll is an interval after this one, not after the first
  await jest.advanceTimersByTimeAsync(119999);
  expect(poll).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(1);
  expect(poll).toHaveBeenCalledTimes(3);
  poll.mockRejectedValueOnce(new Error('offline'));
  await jest.advanceTimersByTimeAsync(120000);
  expect(poll).toHaveBeenCalledTimes(4);
  await poller.pollNow();
  expect(poll).toHaveBeenCalledTimes(4);
  await poller.stop();
  await poller.pollNow();
  expect(poll).toHaveBeenCalledTimes(4);
});

test('pollSoon brings the next poll forward once for several callers, also while a poll runs', async () => {
  let finish;
  const poll = jest.fn().mockResolvedValue(undefined);
  const poller = makePoller(poll);
  await poller.start();
  poller.pollSoon(10000);
  poller.pollSoon(10000);
  // A later time does not postpone it
  poller.pollSoon(60000);
  await jest.advanceTimersByTimeAsync(10000);
  expect(poll).toHaveBeenCalledTimes(2);
  // While a poll runs: the poll after it comes that soon
  poll.mockImplementationOnce(() => new Promise((done) => {
    finish = done;
  }));
  await jest.advanceTimersByTimeAsync(120000);
  expect(poll).toHaveBeenCalledTimes(3);
  poller.pollSoon(5000);
  finish();
  await jest.advanceTimersByTimeAsync(5000);
  expect(poll).toHaveBeenCalledTimes(4);
  // After a failure the backoff stands
  poll.mockRejectedValueOnce(new Error('offline'));
  await jest.advanceTimersByTimeAsync(120000);
  expect(poll).toHaveBeenCalledTimes(5);
  poller.pollSoon(1000);
  await jest.advanceTimersByTimeAsync(1000);
  expect(poll).toHaveBeenCalledTimes(5);
  await poller.stop();
});

test('pollNow while a poll runs polls right after it', async () => {
  let finish;
  const poll = jest.fn().mockImplementationOnce(() => new Promise((done) => {
    finish = done;
  })).mockResolvedValue(undefined);
  const poller = makePoller(poll);
  const first = poller.start();
  await poller.pollNow();
  expect(poll).toHaveBeenCalledTimes(1);
  finish();
  await first;
  await jest.advanceTimersByTimeAsync(0);
  expect(poll).toHaveBeenCalledTimes(2);
  await poller.stop();
});
