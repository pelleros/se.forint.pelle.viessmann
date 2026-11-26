/* eslint-env jest */

'use strict';

const RateLimiter = require('../rateLimiter');

describe('RateLimiter', () => {
  test('allows `limit` times per window and says how long to wait for the next', () => {
    let now = 0;
    const limiter = new RateLimiter(2, 1000, () => now);

    expect(limiter.take()).toBe(0);
    now = 100;
    expect(limiter.take()).toBe(0);
    now = 400;
    // The first one leaves the window at 1000
    expect(limiter.take()).toBe(600);
    expect(limiter.waitTime()).toBe(600);
    now = 1000;
    expect(limiter.take()).toBe(0);
    // Now the second (100) and the third (1000) are in the window
    expect(limiter.take()).toBe(100);
  });

  test('a refused time is not recorded', () => {
    let now = 0;
    const limiter = new RateLimiter(1, 1000, () => now);
    expect(limiter.take()).toBe(0);
    now = 500;
    expect(limiter.take()).toBe(500);
    expect(limiter.take()).toBe(500);
    now = 1000;
    expect(limiter.take()).toBe(0);
  });

  test('uses the clock by default', () => {
    const limiter = new RateLimiter(1, 60 * 1000);
    expect(limiter.take()).toBe(0);
    expect(limiter.take()).toBeGreaterThan(0);
  });
});
