/* eslint-env jest */

'use strict';

const WriteLimiter = require('../writeLimiter');

describe('WriteLimiter', () => {
  let now;
  let timers;
  let limiter;

  // Timers that run only when the test says so
  const advance = async (ms) => {
    now += ms;
    for (const timer of [...timers]) {
      if (timer.at <= now) {
        timers.delete(timer);
        timer.callback();
      }
    }
    await new Promise((resolve) => setImmediate(resolve));
  };

  beforeEach(() => {
    now = 0;
    timers = new Set();
    limiter = new WriteLimiter({
      minInterval: 10,
      maxPerWindow: 3,
      window: 100,
      now: () => now,
      setTimeout: (callback, ms) => {
        const timer = { callback, at: now + ms };
        timers.add(timer);
        return timer;
      },
      clearTimeout: (timer) => timers.delete(timer),
    });
  });

  test('runs a command right away, and the same command again only after the interval', async () => {
    const task = jest.fn(async () => {});
    await expect(limiter.run('a', task)).resolves.toBe(true);
    const second = limiter.run('a', task);
    expect(task).toHaveBeenCalledTimes(1);
    await advance(10);
    await expect(second).resolves.toBe(true);
    expect(task).toHaveBeenCalledTimes(2);
  });

  test('a newer command replaces a waiting one, which resolves false without running', async () => {
    const first = jest.fn(async () => {});
    const replaced = jest.fn(async () => {});
    const latest = jest.fn(async () => {});
    await limiter.run('a', first);
    const waiting = limiter.run('a', replaced);
    const newest = limiter.run('a', latest);
    await expect(waiting).resolves.toBe(false);
    await advance(10);
    await expect(newest).resolves.toBe(true);
    expect(replaced).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  test('other commands do not wait', async () => {
    const task = jest.fn(async () => {});
    await limiter.run('a', task);
    await expect(limiter.run('b', task)).resolves.toBe(true);
    expect(task).toHaveBeenCalledTimes(2);
  });

  test('refuses commands over the window\'s limit without running them, and allows them again later', async () => {
    const task = jest.fn(async () => {});
    for (const key of ['a', 'b', 'c']) await limiter.run(key, task);
    await expect(limiter.run('d', task)).rejects.toMatchObject({ code: 'too_many_commands' });
    expect(task).toHaveBeenCalledTimes(3);
    await advance(100);
    await expect(limiter.run('d', task)).resolves.toBe(true);
  });

  test('passes on the error of a command, also of one that waited', async () => {
    await expect(limiter.run('a', async () => {
      throw new Error('rejected');
    })).rejects.toThrow('rejected');
    const waited = limiter.run('a', async () => {
      throw new Error('again');
    });
    const assertion = expect(waited).rejects.toThrow('again');
    await advance(10);
    await assertion;
  });

  test('stop drops the waiting commands', async () => {
    const task = jest.fn(async () => {});
    await limiter.run('a', task);
    const waiting = limiter.run('a', task);
    limiter.stop();
    await expect(waiting).resolves.toBe(false);
    expect(timers.size).toBe(0);
    expect(task).toHaveBeenCalledTimes(1);
  });

  test('defaults to 10 seconds between the same command and 30 commands an hour', () => {
    const defaults = new WriteLimiter();
    expect([defaults.minInterval, defaults.maxPerWindow, defaults.window]).toEqual([10 * 1000, 30, 60 * 60 * 1000]);
  });
});
