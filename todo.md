# Todo

## Energy reading shows lifetime total instead of today's consumption

**Observed (device currently idle, not drawing power):**
- Homey `Energy`: **94,300 kWh**
- Homey `Power`: **0 W**  (looks correct)
- Viessmann app, consumption today: **12.5 kWh**

**Question:** Why does Homey show 94,300 kWh instead of 12.5 kWh?

**Answer (root cause, by design):** The Viessmann API only exposes today's
kWh in `heating.power.consumption.total` -> `day.value.0`, which resets at
midnight. Homey's Energy tab requires `meter_power` to be a monotonically
increasing lifetime counter (`energy.cumulative: true`), so the driver
builds its own lifetime accumulator (`lifetimeKwh` in device store) by
summing positive deltas every poll. See `drivers/vicare/device.js:401-460`
and `drivers/vicare/config.js:53,396-417`.

- 12.5 kWh = today's value Viessmann's app shows (raw API value)
- 94,300 kWh = accumulator built up by the Homey driver since pairing

**New symptom (12 hours stuck):** `meter_power` value in Homey Insights
has not moved for 12 hours despite Viessmann app showing today's
consumption growing. That means `day.value.0` deltas are not being
applied.

**Findings from `scripts/testConnection.js` on installation 3063056,
device 0 (Vitocal 222S, E3_Vitocal_16):**

- [x] **Bug 1 fixed.** `extendedRequest` arg-shape mismatch in
      `driver.js:142` — now passes positional boolean.
- [x] **Bug 2 dismissed.** Filter works correctly; both filtered and
      unfiltered requests return `heating.power.consumption.total`.
- [x] Extended `scripts/testConnection.js` to dump the full feature
      tree. Confirmed two distinct issues on the Vitocal 222S:

  **Issue A — `total.day` array is stale.** Outer `feature.timestamp`
  = 2026-05-17T12:58 (fresh), but the inner `dayValueReadAt` =
  **2026-05-15T20:31** (~40h old). The driver gates updates on
  `feature.timestamp` (`device.js:409`), so each poll reads the same
  frozen `day.value[0] = 1.1`, deltaKwh = 0, lifetime stays at 94,300.

  **Issue B — `total.day[0]` doesn't equal "today's total".**
  Doesn't match `summary.heating + summary.dhw + summary.cooling`.
  The clean source on this device is `heating.power.consumption.summary.*`,
  each with a `currentDay` property and a fresh outer timestamp:
  summary.heating.currentDay (1.1) + summary.dhw.currentDay (9.7) +
  summary.cooling.currentDay (0) = 10.8 kWh ~ Viessmann app's 12.5.

- [x] **Switched source feature(s)** — `config.js` now declares three new
      PATHS (`POWER_CONSUMPTION_SUMMARY_{HEATING,DHW,COOLING}`), and
      `device.js` collects each `currentDay` during the feature loop, then
      aggregates the sum into `meter_power` / `measure_power` once the
      loop finishes. Delta is gated on the freshest summary timestamp
      (no longer trusts the outer `total.timestamp` which lies). Added a
      `storeVersionBefore('1.0.16')` migration that refreshes `_features`
      from the API and unsets `lastDayKwh` / `lastApiTimestamp` so the
      accumulator seeds cleanly from the new source on the next poll.
      `scripts/testConnection.js` confirms the three new paths come back
      YES/YES (both unfiltered and filtered).
      **Bump `app.json` to 1.0.16 before publishing** so the migration runs.
- [x] **Simulation verification.** `scripts/testConnection.js` now
      mirrors the new driver math against live API data with state
      persisted in `scripts/.testConnection.state.json`. Confirmed:
      - First poll after migration with `VIESSMANN_LIFETIME_SEED=94300`:
        deltaKwh = 10.8 (seeded), meter_power → 94,310.8 kWh.
      - Second poll with no consumption: deltaKwh = 0, unchanged.
      - Once `summary.heating.timestamp` advances + currentDay grows,
        positive delta will produce a real `measure_power` watts value.

- [ ] Add a seed-value sanity guard: if first-reading is implausibly
      large (e.g. > 100 kWh), seed to 0 instead of trusting the value
      (`device.js:419-421`).
- [ ] Optionally add a separate, non-cumulative "today's kWh" capability
      so the value matches what Viessmann's own app displays.
