# Roadmap

This is the development roadmap for the Viessmann ViCare app for Homey (`se.forint.pelle.viessmann`). It says what we want to work on, in which order, and why. It is a plan, not a promise: priorities change when Viessmann changes its API, when we learn something from real installations, or when someone contributes a better idea. The version outline at the end has no dates on purpose.

Status values used below: `in progress`, `planned`. Capability IDs marked *(proposed)* do not exist yet and may still change before release.

## How to help

- **Try test-channel builds.** Every release goes to the test channel first: <https://homey.app/a/se.forint.pelle.viessmann/test/>. Installations of different kinds are the most valuable: heat pump, gas boiler, fuel cell, several heating circuits, cooling, solar, newer E3 controllers.
- **Share an anonymized feature dump.** In the app, open *Settings > Troubleshooting* and copy the output. Real dumps are how we add support for installations we cannot test ourselves. Skim the text before posting it: the in-app anonymization currently strips address and description, but not device serial numbers (extending it is listed under [Ideas / later](#ideas--later)).
- **Open an issue or a pull request** on GitHub. For anything larger than a small fix, please open an issue first so we can agree on the approach. See [CONTRIBUTING.md](../CONTRIBUTING.md) for the practicalities.

## Principles

1. **No breaking changes.** These are frozen, because changing them deletes users' Insights history or breaks their Flows:

   | Frozen | Why |
   |---|---|
   | Capability IDs (e.g. `measure_temperature.buffer`, `target_temperature.heating`, `thermostat_mode.heating`, `measure_compressor_active`) | Insights history and Flows are attached to the ID. Removing a capability breaks Flows that use it. |
   | Flow card IDs, argument names and types, dropdown values, tokens (e.g. `set-operating-mode` and its `mode` argument) | Saved Flows store the argument in the format the card had when it was saved. |
   | Device `data.id` (`installationId-gatewaySerial-deviceId`) | A different ID means a different, new device. |
   | Store keys (`features`, `roles`, `constraints`, `operatingModes`, `version`) | Upgrade migrations read them. |
   | Device class (`heater`) | `setClass()` breaks Flows that depend on the class. |

   A rename in an earlier release already dropped some users' compressor history once. The roadmap exists partly so that does not happen again.

2. **Capabilities are only ever added automatically, never removed.** Today `initializeCapabilities` in `drivers/vicare/device.js` removes every capability that no longer maps to a `PATHS` entry with a stored feature, so a changed path or a temporarily empty feature list can silently delete a capability. Planned: add only; removal happens solely through an explicit `RETIRED_CAPABILITIES` list in `drivers/vicare/config.js`, each entry with a comment explaining why.

3. **Stored feature lists are merged, never replaced.** A refresh takes the union of the old and the new list, so nothing disappears because a sensor happened to report `notConnected` at that moment.

4. **Releases go through the test channel first**, for at least a week, with testers who have different installation types.

5. **A registry test guards the IDs.** A checked-in list of every capability ID and flow card ID ever shipped; the test fails if one can no longer be produced. Adding is fine; removing means moving the entry to `RETIRED_CAPABILITIES` with a comment.

6. **Datapoints are optional and never guessed.** The app is data-driven: a capability appears only where Viessmann reports the datapoint. We do not estimate one value from an unrelated one (for example, power from nominal compressor power).

7. **No rewrite, no language change.** The core design (one device type, capabilities added dynamically from what the API reports, `config.js` as the single source of truth) suits Viessmann's varied API. We refactor from the inside instead (see [Ideas / later](#ideas--later)).

## Phase 0: Safety net (no behavior change, no release)

| # | Item | What and why | Status |
|---|---|---|---|
| 0.1 | Synthetic fixtures in git | Anonymized feature dumps, one per installation type (heat pump, gas boiler with burner, fuel cell, several circuits + solar + ventilation, circuit-1-only as in #4), generated with an anonymization script that strips serials and IDs, addresses and descriptions, rewrites `uri` values and normalizes timestamps. Tests currently read example dumps that are not in the repository, so they cannot run in CI or for contributors. | `in progress` |
| 0.2 | Repository hygiene | Keep raw API dumps (`documentation/`) and `.DS_Store` out of git; decide whether the generated `app.json` is tracked (today it is both committed and ignored). | `in progress` |
| 0.3 | CI | GitHub Actions on push and PR: `npm ci`, lint, tests, `homey app validate --level publish`. There is no CI yet, so outside PRs cannot be assessed reliably. | `in progress` |
| 0.4 | Fix lint | `eslint-config-athom` needs `eslint-plugin-homey-app`, which is not installed, so lint does not run. | `in progress` |
| 0.5 | Registry and upgrade tests | The registry test from principle 5, plus upgrade tests ("a device paired on 1.0.14 keeps at least the same capabilities after `onOAuth2Init`"). Replace the 442-line golden copy of `FEATURES` in `config.test.js` with invariants: every base capability exists in `.homeycompose/capabilities/` or is a system capability, every `PATHS` entry has a `FEATURES` entry, every flow card resolves. | `in progress` |
| 0.6 | Deprecation guard | A script that lists features flagged `deprecated` in the fixtures and warns when one is used in `PATHS`. Viessmann has started flagging datapoints with a `removalDate`, and the flags change between API snapshots. | `in progress` |
| 0.7 | Dependencies and tooling | Update `homey-oauth2app` and `@types/homey`. Decide whether to adopt TypeScript properly (gradually, in `lib/` and `config.js`) or remove the unused scaffolding. Apps run on Node 22 from Homey 12.9. | `in progress` |
| 0.8 | Dead code | Unused helpers (`isCompressorRunning`, `getCompressors`, `_updateAllPollingIntervals`, the commented-out `updateFeaturePaths`), `scripts/generateDriverCompose.js` (it only writes empty lists) and leftover `measure_something_*` capability definitions (once the registry test confirms they are retired). | `in progress` |

## Phase 1: Bug fixes (release 1.0.15, no new capabilities)

Ordered by impact on users.

| # | Fix and impact | Where | Status |
|---|---|---|---|
| 1.1 | `this.setStore(...)` does not exist (should be `setStoreValue`). When an extended poll finds a new feature, an error is thrown, the device is unavailable until the next poll, and the feature is not persisted. As a result, existing devices can never gain new capabilities. **Prerequisite for Phase 2.** | `onFeaturesUpdated` in `device.js` | `in progress` |
| 1.2 | `getFeatures({ useFilter })` passes an object where a boolean is expected, so the filter is always on and the "extended" poll never sees features outside `PATHS`. | `_startPolling` in `driver.js`, `getFeatures` in `device.js` | `in progress` |
| 1.3 | One-time refresh of the stored `features`, `constraints` and `operatingModes` on upgrade, as a union of old and new (principle 3). Devices paired before the endpoint change have outdated lists. | `checkUpgradeSpecifics` in `device.js` | `in progress` |
| 1.4 | Values get stuck when a sensor turns `notConnected` (#7). Read `heating.bufferCylinder.sensors.temperature.top` as a fallback for the same `measure_temperature.buffer` capability when `.main` is `notConnected`, and set the capability to `null` (shown as unknown) when no source is left. Insights currently stays flat on an old value. | `onFeaturesUpdated` in `device.js`, `config.js` | `in progress` |
| 1.5 | The cause of a failed command is swallowed (`throw new Error('Error executing command', error)`), so users only see "Error" or "Unknown error" (#2). Show the HTTP status and Viessmann's message, and check `isExecutable` and constraints before sending. | command execution in `device.js` | `in progress` |
| 1.6 | `'unauthorized'` is compared in lower case against `'Unauthorized - check credentials'`, so a 401 never marks the device "Authentication failed" and users are not told to repair it. | `_startPolling` in `driver.js` | `in progress` |
| 1.7 | `onRefreshToken` does not check `res.ok`; an error response from the identity provider can be saved as a token. | `lib/ViessmannOAuth2Client.js` | `in progress` |
| 1.8 | The `set-operating-mode` flow card has a static dropdown with four values, so `forcedNormal`, `forcedReduced` and `normalStandby` are missing. The existing card is **not** converted (saved Flows would break). Instead: add a new card `set-operating-mode-v2` with autocomplete from the device's `operatingModes`, and mark the old one `deprecated: true` (hidden in the picker, existing Flows keep working). | `flowCards.js` | `in progress` |
| 1.9 | `initializeOperatingModes` calls `splice` on an array while iterating over it, so one of two adjacent modes to remove can be skipped. | `device.js` | `in progress` |
| 1.10 | Polling robustness: the `device_add` listener is registered on every pairing attempt, including aborted ones; no backoff on 429/5xx; fixed interval even when a call takes 30 s. Planned: schedule the next poll after the previous one completes, exponential backoff, respect `Retry-After`. This protects the daily API quota (about 1,450 calls per user). | `onPair`, `_startPolling` in `driver.js` | `in progress` |
| 1.11 | Generate the PKCE verifier and challenge (SHA-256) per login instead of using static constants, and rename the misnamed `CLIENT_SECRET` field. Does not affect existing tokens. | `lib/ViessmannOAuth2Client.js` | `in progress` |
| 1.12 | Flow cards have no `$filter`, so heat pump owners see "Burner is running" and "Set fuel cell mode". Add `$filter: "capabilities=..."` per card. | `flowCards.js` (generates `driver.flow.compose.json`) | `in progress` |
| 1.13 | Reorder `PATHS` so `HEATING_CIRCUIT_0_TARGET` comes before `HOT_WATER_TARGET`: newly paired devices then open on the heating thermostat instead of "Hot water Normal". Existing devices keep their order (reordering would mean removing and re-adding capabilities). | `config.js` | `in progress` |

## Phase 2: New read-only datapoints (release 1.1.0)

All of these have been seen in real installation dumps and are available in Viessmann's free Basic plan. Whether a datapoint exists on a given installation depends on the device (see [Viessmann API notes](#viessmann-api-notes)). Deprecated paths are not used.

| # | Feature | Datapoint | Notes | Status |
|---|---|---|---|---|
| 2.1 | Heating circuit circulation pump on/off | `heating.circuits.N.circulation.pump` (`status`: `on`/`off`) | New base capability `measure_pump_active` *(proposed)* with sub-capability `measure_pump_active.circuit0` *(proposed)*, mapped to boolean with the existing `valueMapping`. Plus a trigger ("Circulation pump started/stopped") and a condition ("Circulation pump is running"); the SDK does not create Flow cards for sub-capabilities, so they are defined explicitly. Latency is the 2-minute poll plus the gateway's own update rate: fine for coordinating other pumps, not instantaneous. Read-only; the datapoint has no commands. | `planned` |
| 2.2 | DHW circulation pump on/off | `heating.dhw.pumps.circulation` | `measure_pump_active.dhwCirculation` *(proposed)*. It can only be controlled indirectly via the schedule, so control is out of scope for the first step. | `planned` |
| 2.3 | COP | `heating.cop.total`, `.heating`, `.dhw` (also `.cooling`, `.photovoltaic`) | New base `measure_cop_number` *(proposed)* with `measure_cop_number.total`, `.heating`, `.dhw` *(proposed)*; the IDs match the proposal in #7. Values seem to be long-term averages that update rarely, so they are described as seasonal COP, not instantaneous. `heating.cop.green` is deprecated (replaced by `.photovoltaic`). | `planned` |
| 2.4 | Compressor load in % | `heating.compressors.0.sensors.power` | `measure_compressor_number.compressorModulation` *(proposed)*, unit `%`. Useful in Insights. | `planned` |
| 2.5 | More temperatures | `heating.bufferCylinder.sensors.temperature.top`, `heating.dhw.sensors.temperature.dhwCylinder.top`/`.bottom`, `heating.circuits.N.sensors.temperature.supply`, `heating.compressors.0.sensors.temperature.{inlet,outlet,ambient,overheat}`, `heating.evaporators.0.sensors.temperature.overheat` | Use the `compressors.N.sensors.*` paths, not the deprecated `heating.sensors.temperature.hotGas`/`suctionGas` or `heating.sensors.pressure.*`. Diagnostic values get `preventTag: true`. | `planned` |
| 2.6 | Primary circuit pump speed | `heating.primaryCircuit.sensors.rotation` (%) | `measure_pump_number.primaryRotation` *(proposed)*. | `planned` |
| 2.7 | Condition cards for temperatures | n/a | For example "Hot water is above X °C". | `planned` |
| 2.8 | Heating rod runtime | `heatingRods.heatGeneration.N.runtime` | Waiting for a dump that contains the new path. The old `heating.heatingRod.runtime` is deprecated and past its removal date. | `planned` |

## Phase 3: Larger improvements (releases 1.2.x)

| # | Feature | What and why | Status |
|---|---|---|---|
| 3.1 | Multiple heating circuits (#4) | Requested by many users. **Step 1 (low risk):** automatically pick the active circuit when circuit 0 does not exist. Installations with only circuit 1 currently get no circuit capabilities at all, so nothing can be lost for them. **Step 2:** one Homey device per extra circuit (a new driver, e.g. `vicare_circuit`, paired against the same Viessmann device), sharing one poll per Viessmann device so the API quota is unaffected. Each circuit then becomes its own thermostat in the right zone. Requires moving polling from the Homey device to the Viessmann device. | `planned` |
| 3.2 | Heating curve (shift and slope) | `heating.circuits.N.heating.curve` with `setCurve` (shift -15 to 40, slope 0 to 3.5). Flow cards "Set curve shift to X" and "Adjust shift by ±N", with rate limiting because this writes to the controller. Useful with hourly prices and power-based tariffs. Direct compressor control (`setActive`/`setPhase`) is `isExecutable: false` on legacy installations. Newer E3 devices expose `device.power.consumption.limitation` and `heating.device.smartGrid` (SG Ready), which suit such tariffs better; they will be added data-driven once we have dumps to test against. | `planned` |
| 3.3 | Programs and holiday | `…programs.comfort`/`eco` (`activate`/`deactivate`), `…programs.reduced`/`normal` (`setTemperature`), `heating.operating.programs.holiday` (`schedule`/`unschedule`), `heating.dhw.temperature.hysteresis` (`setHysteresis`) as Flow actions. | `planned` |
| 3.4 | Alarm / logbook trigger | `device.messages.logbook` (`entries[]` with `event`, `status`, `actor`, `timestamp`): trigger "New logbook entry" with tokens, remembering the last seen timestamp in the store. Complemented by `device.messages.errors.counter.*`. | `planned` |
| 3.5 | Device settings and maintenance | Poll interval (showing the resulting calls per day), circuit selection, and a "Refresh Viessmann features" maintenance action (a `maintenanceAction` on a button capability). | `planned` |
| 3.6 | Better pairing | Enter the Client ID in the pairing flow instead of app settings (also required for Homey Cloud). Clear errors: 401 → wrong Client ID or redirect URI, 429 → quota used up, network error. Name the device after the model (`translationKey`/`modelId`) or installation description instead of `Viessmann (<installationId>)`. | `planned` |
| 3.7 | Translations | German (Viessmann is German), Dutch and Swedish first; contributions welcome. `scripts/generateFlowCompose.js` already picks up new files in `locales/`. | `planned` |

## Viessmann API notes

For contributors working on datapoints. The live reference is <https://api.viessmann-climatesolutions.com/documentation/data-points>.

**Deprecated datapoints.** Viessmann marks datapoints with `deprecated` and a `removalDate`; the flags change between API snapshots. None of the app's current `PATHS` entries is flagged yet (Phase 0.6 will watch for it). Do not build on:

| Deprecated | Use instead | Removal |
|---|---|---|
| `heating.heatingRod.runtime` | `heatingRods.heatGeneration.N.runtime` | 2026-09-30 (passed) |
| `heating.sensors.temperature.hotGas`, `.suctionGas` | `heating.compressors.N.sensors.temperature.{inlet,outlet}` | see live docs |
| `heating.sensors.pressure.*` | `heating.compressors.N.sensors.pressure.{inlet,outlet}` | see live docs |
| `heating.cop.green` | `heating.cop.photovoltaic` | see live docs |

**`heating.compressors.N.power` is not a measurement.** The documentation describes it as the compressor power with a command to set it manually: it is the configured (nominal) power and stays constant whether the compressor runs or not. Do not map it to `measure_power`; Homey Energy would then show invented numbers. For real consumption, see Phase 4.

**Why some installations expose more datapoints.** It depends on the device generation and controller, not on the country. The documentation states that available features vary by device type and controller. Legacy devices connected through Vitoconnect Optolink expose less than newer E3 ("One Base") devices such as the Vitocal 250-A/150-A or Vitodens 200-W E3. For example, `heating.power.consumption.current`, `heating.inverters.N.sensors.power.current`, `device.power.consumption.limitation` and `heating.device.smartGrid` (SG Ready, with commands) are in the free Basic plan, but only on devices that report them.

**Plans.** As of 2026-11-25, Viessmann's pricing page (<https://developer.viessmann-climatesolutions.com/start/pricing.html>) says the paid developer packages are discontinued and no longer available; free Basic access remains, and new packages are announced. Some datapoints (e.g. `heating.compressors.N.power.consumption.current`/`.total`, `heating.heatingRod.power.consumption.current`, `heating.heat.production.*`) belong to the paid tiers and are tied to each user's own Client ID. The app therefore always treats them as optional, which the dynamic model already does.

**Quota.** The Basic plan allows about 1,450 calls per day per user, which is what the poll interval is calculated against.

## Phase 4: Open questions / under consideration

No decisions yet; feedback is welcome in issues.

| Topic | Notes |
|---|---|
| Energy / Homey Energy | Real consumption datapoints exist in Basic for newer devices: `heating.power.consumption.current` (current electrical consumption), `heating.inverters.N.sensors.power.current` (inverter power), `heating.power.consumption.total`/`.heating`/`.dhw` and `.summary.*` (kWh). Idea: optional capabilities that appear only where the datapoint exists: `measure_power` from `…consumption.current` (second choice: the inverter power) and `meter_power` from `…consumption.total`. No estimate from `compressors.N.power`. Needs an anonymized dump from an E3 device to build a fixture. |
| `heatpump` device class | Existing devices cannot be migrated without re-pairing, and `setClass()` breaks Flows. Possibly only for new pairings, after checking the effect on the Devices, Climate and Energy views. Low priority. |
| Raising `compatibility` | Currently `>=10.0.0`. Enum `values` in `capabilitiesOptions` (used for operating modes) need 12.0.1, widgets need 12.3.0, Node 22 arrives with 12.9. Raising to `>=12.3.0` looks reasonable, but users on older Homey versions would stay on their current app version. Would be announced beforehand. |
| Dashboard widget | Supported from Homey 12.3, not on Homey Cloud. Would show compressor, COP, temperatures and pumps; makes sense after Phase 2. |
| Homey Cloud | Has platform constraints: no custom settings pages (the Client ID must move into the pairing flow, see 3.6), no Web API (`api.js`), and unhandled promise rejections crash the app. To be revisited after 3.6. |
| Radiator valves and room sensors | Separate devices inside the installation with their own feature calls. The quota is not enough for several valves at a 2-minute poll, so this needs per-Viessmann-device polling (3.1) first, then slower polling for valves. |

## Ideas / later

Not scheduled; listed so they are not lost.

- **Cooling:** `heating.circuits.N.cooling.*`, `heating.circuits.N.operating.modes.heatingCooling` and `heating.cop.cooling`, with a cooling capability and a longer operating-mode list.
- **Schedules:** read-only first (`heating.circuits.N.heating.schedule`, `heating.dhw.schedule`), writing later.
- **Hot water:** a "boost now" button (`oneTimeCharge.activate`), set DHW comfort and reduced temperature.
- **Solar:** `heating.solar.*` sensors (collector and buffer temperature, sun hours).
- **Gas consumption:** `meter_gas` from `heating.gas.consumption.summary.{heating,dhw}` where present.
- **Read once at pairing and cache** (not polled): `heating.configuration.flow.temperature.min`/`max` (to set `min`/`max` on `target_temperature.heating` instead of hardcoded values), `heating.configuration.buffer.temperature.max`, `heating.configuration.temperature.outside.DampingFactor`, heating rod `useApproved` flags, `heating.coolingCircuits.0.type`, `heating.device.mainECU.runtime`.
- **Statistics:** `heating.compressors.0.statistics.load` (hours per load class) and `heating.compressors.0.sensors.pressure.inlet`, better suited to the troubleshooting view than to polled capabilities.
- **Triggers:** outdoor temperature "dropped below X for Y minutes".
- **Support snapshot:** a button that produces a shareable, anonymized dump (installations, features, roles, store). Extend the anonymization to serial numbers (`device.serial`, `boilerSerial`, `bmuSerial`, `heating.*.serial`).
- **Quota indicator** in the settings page (from `X-RateLimit-*` headers if available, otherwise an internal counter).
- **Refactoring:** a pure `FeatureMapper` (features JSON → capability values, easy to test with fixtures), a `CapabilityReconciler` that only adds, and one `Poller` per Viessmann device.
- **Broader tests:** pairing and polling in `driver.js`, flow card resolution, `ViessmannOAuth2Client` error mapping and token refresh (with an HTTP mock), a coverage threshold in CI.
- **Small cleanups:** ungated `console.log` and an unverified `homey.error` call in `api.js`; `registerCapabilityListeners` de-duplicates by path instead of capability name; `getValue` is redefined per feature in `onFeaturesUpdated`; the empty try/catch in `onOAuth2Init`; `checkUpgradeSpecifics` should bump `version` after migrations; `storeVersionBefore` is a naive semver comparison.
- **Documentation:** a fuller README, a readable `CHANGELOG.md` mirroring `.homeychangelog.json`, a short note on what `api.js` exposes (settings page only), how several installations per account behave, and why `preventInsights` is set where it is.
- **More languages:** Danish and Norwegian after the first three.

## Release outline

| Version | Contents | Risk |
|---|---|---|
| none | Phase 0 (tests, CI, fixtures, cleanup) | None; no behavior change |
| **1.0.15** | Phase 1 bug fixes | Low if the registry test is green; 1-2 weeks in the test channel |
| **1.1.0** | Phase 2: pumps, COP, compressor load, temperatures, condition cards | Low; additions only |
| **1.2.x** | Phase 3: circuit step 1, heating curve, programs, logbook trigger, settings, pairing, translations | Medium; some of it writes to the controller |
| later | Circuits as separate devices, energy (if a source exists), widget, possibly Homey Cloud | Medium |
