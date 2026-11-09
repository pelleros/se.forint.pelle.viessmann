'use strict';

// Schedule after completion, so slow requests never overlap.
module.exports = class DevicePoller {
  constructor({
    homey, poll, getInterval, onError,
  }) {
    this.homey = homey;
    this.poll = poll;
    this.getInterval = getInterval;
    this.onError = onError;
    this.failures = 0;
    this.stopped = false;
    this.retryAt = 0;
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
    try {
      await this.poll(() => this.stopped);
      this.failures = 0;
      this.retryAt = 0;
    } catch (error) {
      this.failures++;
      this.retryAt = Date.now() + (error.retryAfterMs || 0);
      if (!this.stopped) await this.onError(error, this.failures);
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
    if (this.timer) this.homey.clearTimeout(this.timer);
    await this.running;
  }
};
