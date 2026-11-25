'use strict';

// A poll that takes longer than this counts as failed and the next one is scheduled anyway.
// Every API request times out after 30 seconds; a poll can need three (request, token
// refresh, repeated request) plus processing.
const POLL_TIMEOUT = 100 * 1000;
// stop() waits at most this long for a poll in progress (it never applies its result anyway)
const STOP_TIMEOUT = 5 * 1000;

function pollTimeoutError(timeout) {
  const error = new Error(`Poll did not finish within ${Math.round(timeout / 1000)} seconds`);
  error.name = 'PollTimeoutError';
  return error;
}

// Schedule after completion, so slow requests never overlap.
module.exports = class DevicePoller {

  constructor({
    homey, poll, getInterval, onError, timeout = POLL_TIMEOUT, stopTimeout = STOP_TIMEOUT,
  }) {
    this.homey = homey;
    this.poll = poll;
    this.getInterval = getInterval;
    this.onError = onError;
    this.timeout = timeout;
    this.stopTimeout = stopTimeout;
    this.failures = 0;
    this.stopped = false;
    this.retryAt = 0;
    this.attempt = null;
  }

  async start() {
    if (this.stopped || this.running) return;
    this.running = this.run();
    try {
      await this.running;
    } finally {
      this.running = null;
      if (!this.stopped) this.schedule();
    }
  }

  async run() {
    // A poll that is abandoned (timed out or stopped) must not apply its result later
    const attempt = {};
    this.attempt = attempt;
    const abandoned = () => this.stopped || this.attempt !== attempt;
    let deadline;
    try {
      await Promise.race([
        this.poll(abandoned),
        new Promise((resolve, reject) => {
          deadline = this.homey.setTimeout(() => reject(pollTimeoutError(this.timeout)), this.timeout);
        }),
      ]);
      if (abandoned()) return;
      this.failures = 0;
      this.retryAt = 0;
    } catch (error) {
      if (abandoned()) return;
      this.failures++;
      this.retryAt = Date.now() + (error?.retryAfterMs || 0);
      await this.onError(error, this.failures);
    } finally {
      this.homey.clearTimeout(deadline);
      if (this.attempt === attempt) this.attempt = null;
    }
  }

  schedule() {
    if (this.stopped || this.running) return;
    if (this.timer) this.homey.clearTimeout(this.timer);
    const base = this.getInterval();
    const backoff = this.failures ? Math.max(base, Math.min(base * (2 ** Math.min(this.failures, 10)), 30 * 60 * 1000)) : base;
    const delay = Math.max(backoff, this.retryAt - Date.now());
    this.timer = this.homey.setTimeout(() => {
      this.timer = null;
      // A very long Retry-After is checked again instead of overflowing setTimeout.
      if (Date.now() < this.retryAt) this.schedule();
      else this.start().catch((error) => this.homey.error('Polling failed:', error));
    }, Math.min(delay, 2147483647));
  }

  async stop() {
    this.stopped = true;
    this.attempt = null;
    if (this.timer) this.homey.clearTimeout(this.timer);
    this.timer = null;
    await this.waitForPoll();
  }

  // Waits for a poll in progress, but not longer than stopTimeout
  async waitForPoll() {
    if (!this.running) return;
    let timer;
    await Promise.race([
      this.running.catch(() => {}),
      new Promise((resolve) => {
        timer = this.homey.setTimeout(resolve, this.stopTimeout);
      }),
    ]);
    this.homey.clearTimeout(timer);
  }

};

module.exports.POLL_TIMEOUT = POLL_TIMEOUT;
module.exports.STOP_TIMEOUT = STOP_TIMEOUT;
