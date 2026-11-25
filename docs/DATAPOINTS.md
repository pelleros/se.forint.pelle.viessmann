# Datapoint catalogue

This catalogue lists the Viessmann datapoints ("features") the app reads today and proposes, for every other datapoint seen in real installations, whether and how the app should expose it. It is a review document: nothing here is implemented yet, and every capability ID marked *(proposed)* may still change until it ships. Once shipped, an ID is frozen (see [ROADMAP.md, principle 1](ROADMAP.md#principles)).

Snapshot: 2026-11-25. Refresh it per release with [`scripts/featureCoverage.js`](../scripts/featureCoverage.js) (see [Refreshing this catalogue](#refreshing-this-catalogue)).

**Contents:** [Sources](#sources-and-how-to-read-the-tables) · [ID rules](#id-rules) · [Tiers](#tiers) · [Already supported](#1-already-supported) · [Everyday](#2a-everyday-added-automatically) · [Energy](#2b-energy-homey-energy) · [Diagnostic](#2c-diagnostic-opt-in) · [Controls](#2d-controls-later-flow-actions) · [Static configuration](#2e-static-configuration-read-once) · [Not planned](#2f-not-planned) · [Watch list](#3-watch-list-official-list-not-yet-seen-in-a-dump) · [New base capabilities](#4-new-base-capabilities) · [UI improvements](#5-ui-improvements-for-existing-and-new-capabilities) · [Open questions](#6-open-questions)

## Sources and how to read the tables

- **Real dumps.** Eight feature dumps from five real installations. The raw dumps stay outside the repository (they contain serial numbers and IDs); anonymized versions of six of them are in [`test/fixtures/`](../test/fixtures/README.md) (all but the 2025-10 and 2026-05 heat-pump snapshots), and they give the same list of features as the eight raw dumps (see [Refreshing this catalogue](#refreshing-this-catalogue)):

  | Short name | Installation | Gateway | Snapshots |
  |---|---|---|---|
  | **HP** | Heat pump, Vitocal 222 (air source, cooling capable) | legacy, Vitoconnect Optolink | 4: 2024-11, 2025-10, 2026-05, 2026-11 (same installation) |
  | **Gas** | Gas boilers, 3 installations: one Vitodens 200 (2016, legacy, Optolink) and two Vitodens 200 E3 | legacy / E3 | 1 each, 2024 |
  | **FC** | Fuel cell, Vitovalor PT2 (with integrated peak-load boiler) | E3 | 1, 2024 |

  "Seen in" names the installation types where the feature was *usable*: enabled, not flagged `deprecated`, not `notConnected`, with at least one property. "Gas 2/3 (E3)" means two of the three gas boilers, both E3. "HP (2025+)" means only in the newer heat-pump snapshots. Every installation in the dumps has exactly one heating circuit (`heating.circuits` → `enabled: ["0"]`).
- **Official list.** Viessmann's datapoint list retrieved 2026-11-25 from <https://api.viessmann-climatesolutions.com/documentation/data-points>: 766 features, 679 with a Basic plan, 76 Advanced-only, 11 without a plan, 49 flagged deprecated. "Plan" uses: **Basic** = View Basic Feature Data, **Adv** = View Advanced Feature Data, **Ctrl** = Control Basic Features.
- Indexes are written as `N` (`heating.circuits.N.…`). ⓒ marks a per-circuit feature, described for circuit 0 / "the selected circuit". How several circuits are exposed depends on the multi-circuit design in [#4](https://github.com/pelleros/se.forint.pelle.viessmann/issues/4) (roadmap 3.1); the `.circuit0` suffixes below follow the existing IDs and the roadmap and must be confirmed together with that design.
- **Insights / tag** gives the proposed `preventInsights` / `preventTag` defaults as ✓ (on) or – (prevented), following the templates in `drivers/vicare/config.js`: temperatures ✓/✓ (diagnostic ones ✓/–), on/off states ✓/✓, modulation ✓/–, counters –/–.
- **UI** gives the proposed `uiComponent` (`sensor`, `picker`, `thermostat`, …); *ind* means the user can choose it as a device indicator (numbers starting with `measure_`/`meter_`, custom booleans and numbers; not strings); for booleans it says whether the value should drive the device tile (`uiState`, see [5a](#5a-tile-state-uistate-for-running-booleans)).
- Some features real devices deliver are missing from the official list (`heating.burners.N`, `heating.compressors.N`, `heating.circuits.N`, `heating.circuits.N.name`, `device.messages.errors.raw`). Missing from the list is not a reason to drop a mapping; the app already relies on two of them (see [Undocumented but relied on](#undocumented-but-relied-on)).

**Totals.** 142 features are usable in at least one dump. 26 of them are mapped today (the 27th mapped path, `heating.primaryCircuit.sensors.temperature.return`, is not connected in any dump). Of the 116 unmapped ones, 10 are deprecated; the remaining **106** are classified below: 14 everyday, 18 energy, 17 diagnostic, 12 controls, 15 static configuration, 30 not planned.

## ID rules

1. **Hand-picked and stable.** Each ID is written once in `drivers/vicare/config.js`. IDs are never derived from the feature path by code, and never renamed after release (renaming deletes Insights history and breaks Flows).
2. **Format** `<base capability>.<suffix>`, suffix in camelCase (`hotWaterBottom`, `compressorInlet`). Existing snake_case suffixes (`boiler_main`, `circuit0_supply`, `circuit0_room`) stay as they are.
3. **Reuse a base capability when meaning and unit match**: Homey system capabilities (`measure_temperature`, `target_temperature`, `thermostat_mode`, `measure_pressure`, `measure_water`, `measure_power`, `meter_power`, `meter_gas`) or the app's own (`measure_compressor_number`, `measure_burner_number`, `measure_fuelcell_number`, …). New custom bases follow the existing pattern `measure_<thing>_<kind>` (`_active` for booleans, `_number` for numbers).
4. **One ID, one meaning, forever.** Never reuse a shipped ID for another datapoint. A fallback path that reads the *same physical sensor* is fine (e.g. buffer `.top` for `measure_temperature.buffer`, roadmap 1.4). Suffixes are unique per base on the device: `measure_temperature.supply` is already the *primary-circuit* supply, so other supply temperatures need other suffixes.
5. **Never use a deprecated path**, whether it is flagged in the official list or in any dump (the dumps flag some paths the official list does not). Use the named replacement.
6. **Never derive one value from another** (roadmap principle 6): no power from nominal compressor power, no gas m³ from kWh with a guessed calorific value. The one deliberate exception is the running-state fallback in [Undocumented but relied on](#undocumented-but-relied-on). It reads the same component's own measured load, so it reports the same physical state; it is not an estimate.
7. **Discover indexes, never assume 0; index 0 keeps today's IDs.** `N` means there can be several: compressors, burners, circuits, evaporators, condensers, inverters, heating rods. The app hard-codes index 0 today.
   - **Where the indexes come from.** Take the existing indexes from the documented list feature's `enabled` property (`heating.compressors`, `heating.burners`, `heating.circuits`, e.g. `{"enabled": {"value": ["0"]}}`), not from the paths that happen to appear. The 2024 heat-pump dump contains `heating.compressors.1.*` and `heating.circuits.1.*` / `.2.*`, all disabled, while the lists say `["0"]`. The other families (`heating.evaporators`, `heating.condensors`, `heating.inverters`, `heating.coolingCircuits`, …) have no list feature in the official list; there the index counts only if its features are enabled. The open [PR #6](https://github.com/pelleros/se.forint.pelle.viessmann/pull/6) already discovers circuits from `heating.circuits` → `enabled`: circuit 0 if enabled, otherwise the first enabled one.
   - **IDs.** Index 0 (for circuits: the selected circuit) keeps today's IDs unchanged. IDs for index ≥ 1 follow one naming scheme, decided together with the multi-circuit design ([#4](https://github.com/pelleros/se.forint.pelle.viessmann/issues/4)). Proposed: append the unit and index to the sub-ID, e.g. `measure_compressor_active.compressor1`, `measure_compressor_number.compressorHoursCompressor1`, `measure_temperature.compressorInletCompressor1` (Q21).
   - No real dump has a second *enabled* compressor, burner or circuit yet.

## Tiers

| Tier | When the capability is added | Notes |
|---|---|---|
| Everyday | Automatically, wherever the feature is usable (as today) | Values most users want on the device tile and in Insights. |
| Energy | Automatically, wherever present | Needs dedicated code (accumulator, unit check); feeds Homey Energy. |
| Diagnostic | Only when the device setting **Show diagnostic sensors** *(proposed, default off)* is on | Refrigerant circuit, load classes, runtimes, rarely needed sensors. |
| Controls | Later phase, as Flow actions (and a setable capability where it helps) | Always check `isExecutable` and the command's constraints at runtime. |
| Static configuration | Read at pairing and on "Refresh Viessmann features" (roadmap 3.5), stored, never polled | Drives circuit/burner discovery, ranges, support snapshot. |
| Not planned | Never | Reason given per group. |

Implementation needs, beyond today's `config.js` (none exist yet): a `tier` field per feature, a `transform` per capability for unit conversions (seconds → hours, l/h → L/min), multiple source paths per capability (roadmap 1.4), an energy accumulator with its own store key, and a store key for static configuration. New store keys are fine; existing ones are frozen.

## 1. Already supported

27 paths, 31 capabilities (`drivers/vicare/config.js`). All are frozen.

| Viessmann feature | Property → command | Capability ID | Title (en) |
|---|---|---|---|
| `heating.dhw.sensors.temperature.dhwCylinder` | `value` | `measure_temperature.hotWater` | Hot water temperature |
| `heating.dhw.temperature.main` | `value` → `setTargetTemperature` | `target_temperature.hotWater` | Hot water Normal |
| `heating.dhw.temperature.temp2` | `value` → `setTargetTemperature` | `target_temperature.hotWater2` | Hot water Temp 2 |
| `heating.dhw.oneTimeCharge` | `active` → `activate` / `deactivate` | `thermostat_mode.hotWaterOneTimeCharge` | Hot water one time charge |
| `heating.circuits.0.operating.programs.normal` | `temperature` → `setTemperature` | `target_temperature.heating` | Heating thermostat |
| `heating.circuits.0.operating.modes.active` | `value` → `setMode` | `thermostat_mode.heating` | Operating mode |
| `heating.circuits.0.temperature` | `value` | `measure_temperature.circuit0` | Heating circuit target temperature |
| `heating.circuits.0.sensors.temperature.supply` | `value` | `measure_temperature.circuit0_supply` | Heating Circuit Supply Temperature |
| `heating.circuits.0.sensors.temperature.room` | `value` | `measure_temperature.circuit0_room` | Room Temperature |
| `heating.sensors.temperature.outside` | `value` | `measure_temperature.outside` | Outside temperature |
| `heating.sensors.temperature.return` | `value` | `measure_temperature.return` | Heating return temperature |
| `heating.bufferCylinder.sensors.temperature.main` | `value` | `measure_temperature.buffer` | Buffer cylinder temperature |
| `heating.primaryCircuit.sensors.temperature.supply` | `value` | `measure_temperature.supply` | Primary supply temperature |
| `heating.primaryCircuit.sensors.temperature.return` | `value` | `measure_temperature.primaryReturn` | Primary return temperature |
| `heating.secondaryCircuit.sensors.temperature.supply` | `value` | `measure_temperature.secondarySupply` | Secondary supply temperature |
| `heating.boiler.sensors.temperature.main` | `value` | `measure_temperature.boiler_main` | Boiler Main Temperature |
| `heating.boiler.sensors.temperature.commonSupply` | `value` | `measure_temperature.boilerCommonSupply` | Boiler Exit Temperature |
| `heating.compressors.0` | `active` | `measure_compressor_active` | Compressor running |
| `heating.compressors.0.statistics` | `hours`, `starts` | `measure_compressor_number.compressorHours`, `.compressorStarts` | Compressor runtime / starts |
| `heating.burners.0` | `active` | `measure_burner_active` | Burner running |
| `heating.burners.0.modulation` | `value` | `measure_burner_number.burnerModulation` | Burner modulation |
| `heating.burners.0.statistics` | `hours`, `starts` | `measure_burner_number.burnerHours`, `.burnerStarts` | Burner runtime / starts |
| `fuelCell.sensors.temperature.supply` | `value` | `measure_temperature.fuelCellSupply` | Fuel Cell Supply Temperature |
| `fuelCell.sensors.temperature.return` | `value` | `measure_temperature.fuelCellReturn` | Fuel Cell Return Temperature |
| `fuelCell.statistics` | `operationHours`, `productionHours`, `productionStarts` | `measure_fuelcell_number.operationHours`, `.productionHours`, `.productionStarts` | Fuel cell operation hours / production hours / starts |
| `fuelCell.operating.phase` | `value` | `measure_fuelcell_phase` | Fuel cell phase |
| `fuelCell.operating.modes.active` | `value` → `setMode` | `thermostat_mode.fuelCell` | Fuel cell mode |

None of these paths is flagged deprecated in the official list or in any dump.

### Undocumented but relied on

Only the bare `heating.compressors.N` and `heating.burners.N` (with `active` and, for compressors, `phase`) are missing from Viessmann's datapoint list (checked against the 2026-11-25 copy; the maintainer confirmed the same on the live page). The list does document the enabled-list features `heating.compressors` / `heating.burners` and many children:

- **Burner** (`heating.burners.N.…`): `modulation`, `statistics`, `errorStatus`, `manualActivation`, `preConditions`, `demand.modulation`, `demand.temperature`, `sensors.o2`. `automatic` is deprecated in favour of `errorStatus`.
- **Compressor** (`heating.compressors.N.…`): `power`, `statistics` (and `.load`), `heatTarget` (Advanced), `sensors.*`, `speed.current` / `.setpoint`, `heater.crankcase`, plus Advanced-only `power.consumption.*` and `heat.production.*`.

Yet every real dump reports the bare features, including the 2026-11-25 heat-pump dump (`active`, `phase`). The app maps their `active.value` to `measure_compressor_active` and `measure_burner_active`, which the Flow conditions `compressor-is-running` and `burner-is-running` read. Of the documented children, `errorStatus` and `heatTarget` would be worth mapping but are not in our dumps (see the [watch list](#3-watch-list-official-list-not-yet-seen-in-a-dump)).

**Risk.** An undocumented feature can disappear or change without a `deprecated` flag or `removalDate`, so the deprecation checks (`scripts/featureCoverage.js`, roadmap 0.6) would not warn in advance. The capability would freeze on its last value (or turn unknown once roadmap 1.4 lands) and those Flow conditions would stop working.

**Fallback** (proposed). Feed the **same** capability IDs from a documented datapoint of the same component, only when the primary feature is missing or not usable:

| Capability (frozen) | Primary (undocumented) | Fallback (documented, Basic) | Fallback seen in |
|---|---|---|---|
| `measure_compressor_active` | `heating.compressors.N` → `active` | `heating.compressors.N.sensors.power` → `value` > 0 % | HP (2025+), not in the 2024 snapshot |
| `measure_burner_active` | `heating.burners.N` → `active` | `heating.burners.N.modulation` → `value` > 0 % | Gas 3/3, FC |

All eight dumps agree with the rule: `active` is true exactly where the load is above 0, with one running snapshot of each (compressor 42 %, burner 15.1 %). That is a small sample. Phases such as defrost, or a burner at minimum load, should be checked in the test channel before the fallback ships. The fallback needs the multiple-sources mechanism of roadmap 1.4 plus a small transform (number > 0 → true). The primary and fallback sources are never mixed while the primary is usable. The unmapped `phase` property of `heating.compressors.N` (`heating`, `pause`, `preparing`, `off`, …) is a candidate for a later string capability.

### Deprecated names in older dumps

Dumps often contain an old, flagged name next to its replacement, with identical values. Examples: `heating.fuelCell.*` next to `fuelCell.*` (11 features in the fuel-cell dump), `heating.buffer.sensors.temperature.{main,top}` next to `heating.bufferCylinder.…`, and `heating.dhw.sensors.temperature.hotWaterStorage{,.top,.bottom}` next to `heating.dhw.sensors.temperature.dhwCylinder{,.top,.bottom}`. All of them carry `removalDate: 2024-09-15` but were still delivered. The app reads only the new names. The catalogue and `scripts/featureCoverage.js` ignore every flagged name, so the duplicates neither show up as candidates nor count as mapped.

## 2a. Everyday (added automatically)

Ordered by the number of installation types that expose the feature.

| # | Viessmann feature | Property | Unit / type | Seen in | Plan | Capability ID *(proposed)* | Title (en) | Insights / tag | UI | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `heating.circuits.N.circulation.pump` ⓒ | `status` | `on`/`off` → boolean | HP, Gas 3/3, FC | Basic | `measure_pump_active.circuit0` | Circulation pump | ✓ / ✓ | sensor · ind · uiState off | `valueMapping { on: true, off: false }`. Explicit trigger + condition cards (roadmap 2.1). Read-only. |
| 2 | `heating.circuits.N.operating.programs.active` ⓒ | `value` | string (`normal`, `reduced`, `comfort`, `eco`, `standby`, `fixed`, …) | HP, Gas 3/3, FC | Basic | `measure_heating_program.circuit0` | Active program | n/a (string) / ✓ | sensor (string: no ind) | Raw Viessmann program id. Trigger "Active program changed" with a token. String rather than enum, see Q13. Replaces reading the per-program `active` booleans. |
| 3 | `heating.dhw.pumps.circulation` | `status` | `on`/`off` → boolean | HP, Gas 1/3 (legacy), FC | Basic | `measure_pump_active.dhwCirculation` | Hot water circulation pump | ✓ / ✓ | sensor · ind · uiState off | Roadmap 2.2. Control only via schedule (not planned). |
| 4 | `heating.dhw.charging` | `active` | boolean | HP, Gas 1/3 (legacy) | Basic | `measure_dhw_active.charging` | Hot water charging | ✓ / ✓ | sensor · ind · uiState off | True while the cylinder is being heated; not the same as `oneTimeCharge` (a user request). |
| 5 | `heating.cop.total` | `value` | number, no unit | HP (2025+) | Basic + Adv | `measure_cop_number.total` | COP total | ✓ / – | sensor · ind | Long-term average that changes rarely: describe as seasonal COP. 1 decimal. Roadmap 2.3. |
| 6 | `heating.cop.heating` | `value` | number | HP (2025+) | Basic + Adv | `measure_cop_number.heating` | COP heating | ✓ / – | sensor · ind | As above. |
| 7 | `heating.cop.dhw` | `value` | number | HP (2025+) | Basic + Adv | `measure_cop_number.dhw` | COP hot water | ✓ / – | sensor · ind | As above. |
| 8 | `heating.compressors.N.sensors.power` | `value` | % | HP (2025+) | Basic | `measure_compressor_number.compressorModulation` | Compressor modulation | ✓ / – | sensor · ind | Compressor load in %, not watts, despite the path. Roadmap 2.4. |
| 9 | `heating.sensors.pressure.supply` | `value` | bar | Gas 1/3 (E3), FC | Basic + Adv | `measure_pressure.system` | System pressure | ✓ / ✓ | sensor · ind | Water pressure of the heating system; good for a "pressure below X bar" condition. `measure_pressure` is mbar by default: override units to `bar`, 1 decimal (Q2). |
| 10 | `heating.flue.sensors.temperature.main` | `value` | °C | Gas 1/3 (E3), FC | **Adv only** | `measure_temperature.flue` | Flue gas temperature | ✓ / – | sensor · ind | Appears only where the user's Client ID gets Advanced data (Q1). |
| 11 | `heating.dhw.sensors.temperature.dhwCylinder.bottom` | `value` | °C | FC (not connected on HP) | Basic | `measure_temperature.hotWaterBottom` | Hot water bottom temperature | ✓ / – | sensor · ind | |
| 12 | `heating.dhw.sensors.temperature.outlet` | `value` | °C | Gas 1/3 (legacy); not connected elsewhere | Basic | `measure_temperature.hotWaterOutlet` | Hot water outlet temperature | ✓ / – | sensor · ind | |
| 13 | `heating.sensors.temperature.hydraulicSeparator` | `value` | °C | Gas 1/3 (E3) | Basic | `measure_temperature.hydraulicSeparator` | Hydraulic separator temperature | ✓ / – | sensor · ind | |
| 14 | `heating.bufferCylinder.sensors.temperature.top` | `value` | °C | HP | Basic | none: fallback for existing `measure_temperature.buffer` | — | — | — | Roadmap 1.4: used when `.main` is `notConnected` (as in the 2026 snapshots). Where both were connected they had identical values, so a separate `measure_temperature.bufferTop` would duplicate; add it only if a dump shows two different values. |

## 2b. Energy (Homey Energy)

| # | Viessmann feature | Properties used | Unit | Seen in | Plan | Capability ID *(proposed)* | Title (en) | Insights / tag | UI | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `heating.gas.consumption.total` | `year[]`, `yearValueReadAt` | m³ on E3, **kWh on the legacy boiler** | Gas 3/3, FC | Basic | `meter_gas` | Gas consumption | ✓ / ✓ | sensor · ind | Accumulator below. Only when `unit === 'cubicMeter'` (Q4). |
| 2 | `heating.gas.consumption.heating` | as #1 | as #1 | Gas 3/3, FC | Basic | `meter_gas.heating` | Gas for heating | ✓ / – | sensor · ind | Optional split (Q5). |
| 3 | `heating.gas.consumption.dhw` | as #1 | as #1 | Gas 3/3, FC | Basic | `meter_gas.dhw` | Gas for hot water | ✓ / – | sensor · ind | Optional split (Q5). |
| 4 | `heating.power.consumption.total` | `year[]`, `yearValueReadAt` | kWh | Gas 3/3, FC | Basic | `meter_power` | Energy | ✓ / ✓ | sensor · ind | The device's own electricity. On the gas boilers that is fan, pump and controller (0.3–1.8 kWh/day in the dumps); on E3 heat pumps it would be the main consumption (not in our heat-pump dump). |
| 5 | `heating.power.consumption.heating` | as #4 | kWh | Gas 2/3 (E3), FC | Basic | `meter_power.heating` | Energy for heating | ✓ / – | sensor · ind | Optional split (Q5). |
| 6 | `heating.power.consumption.dhw` | as #4 | kWh | Gas 2/3 (E3), FC | Basic | `meter_power.dhw` | Energy for hot water | ✓ / – | sensor · ind | Optional split (Q5). |
| 7 | `heating.gas.consumption.summary.heating` | `currentYear`, `lastYear` | m³ | Gas 2/3 (E3), FC | Basic | none (source only) | — | — | — | Fallback for #2 if the arrays are missing. No timestamps. |
| 8 | `heating.gas.consumption.summary.dhw` | `currentYear`, `lastYear` | m³ | Gas 2/3 (E3), FC | Basic | none (source only) | — | — | — | Fallback for #3. |
| 9 | `heating.power.consumption.summary.heating` | `currentYear`, `lastYear` | kWh | Gas 2/3 (E3), FC | Basic | none (source only) | — | — | — | Fallback for #5. |
| 10 | `heating.power.consumption.summary.dhw` | `currentYear`, `lastYear` | kWh | Gas 2/3 (E3), FC | Basic | none (source only) | — | — | — | Fallback for #6. |
| 11 | `heating.gas.consumption.fuelCell` | as #1 | m³ | FC | **Adv only** | `meter_gas.fuelCell` | Gas for fuel cell | ✓ / – | sensor · ind | Q1, Q8. |
| 12 | `heating.power.production.cumulative` | `value` | kWh, already cumulative | FC | Basic + Adv | `meter_power.produced` (Q6) | Electricity produced | ✓ / ✓ | sensor · ind | A real counter: no accumulator needed. |
| 13 | `heating.power.production.current` | `value` | W | FC | **Adv only** | `measure_power.produced` (Q6) | Power produced | ✓ / ✓ | sensor · ind | Real measurement (734 W in the dump). |
| 14 | `heating.power.purchase.cumulative` | `value` | kWh | FC | Basic + Adv | `meter_power.imported` (Q7) | Grid import | ✓ / – | sensor · ind | Appears to be measured at the household grid connection, not the device. |
| 15 | `heating.power.purchase.current` | `value` | W | FC | Basic + Adv | `measure_power.imported` (Q7) | Grid import power | ✓ / – | sensor · ind | As #14. |
| 16 | `heating.power.sold.cumulative` | `value` | kWh | FC | Basic + Adv | `meter_power.exported` (Q7) | Grid export | ✓ / – | sensor · ind | As #14. |
| 17 | `heating.power.sold.current` | `value` | W | FC | Basic + Adv | `measure_power.exported` (Q7) | Grid export power | ✓ / – | sensor · ind | As #14. |
| 18 | `fuelCell.power.production` | `day[]` … `year[]` | kWh | FC | Adv only | none | — | — | — | Same quantity as #12, which is Basic and already cumulative. Use only if #12 is missing. |

### From day/month/year arrays to a cumulative meter

`meter_gas` and `meter_power` must be monotonic counters. Viessmann instead delivers per-period arrays: `day[]` (8 entries), `week[]` (5–7 on E3, 53 on legacy), `month[]` (13), `year[]` (2 on E3, 3 on legacy). Index 0 is the current, still-growing period; index 1 is the previous, completed one. `dayValueReadAt` … `yearValueReadAt` are UTC timestamps of when the device last delivered the values. They can lag: in one E3 dump the electricity `dayValueReadAt` was three days old and `day[0]` was 0.

Proposed algorithm, per meter, with state `{ offset, lastValue, lastYear, lastReadAt }` in a new store key:

1. Read `y = year[0]` and the year of `yearValueReadAt`, converted to Homey's timezone (`this.homey.clock.getTimezone()`), so 00:30 on 1 January local time is not counted as the old year.
2. **Stale data:** if `yearValueReadAt` is not newer than `lastReadAt`, change nothing.
3. **First run:** `offset = 0`, meter = `y`. The meter then counts from 1 January, not from the physical gas meter reading. Homey Energy works with differences, so the starting value does not matter.
4. **Same year:** meter = `offset + max(y, lastValue)`. A value that goes down is a Viessmann correction; the meter never goes backwards.
5. **New year** (year of `yearValueReadAt` > `lastYear`): the year that just ended is now `year[1]`, and it is complete. `offset += year[1]`, then meter = `offset + y`. This also fills a gap when Homey was off over New Year, because `year[1] ≥ lastValue`. If more than one year was missed, add `year[2]` too where it exists (legacy); otherwise log the gap.
6. **Sources without timestamps** (`summary.*`): treat `currentYear` dropping clearly below `lastValue` as a new year and add `lastYear` instead of `year[1]`.
7. **Unit guard:** feed `meter_gas` only from `unit === 'cubicMeter'` and `meter_power` only from `unit === 'kilowattHour'`. The official description of `heating.gas.consumption.total` says unit and value depend on the configuration, and the legacy boiler indeed reports gas in kWh (Q4).
8. **Resolution:** the resolution of `year[0]` varies by device (0.1 m³ on E3, whole kWh for legacy gas, 0.001 kWh for legacy electricity), and it changes only when the device delivers new data. A finer variant uses `day[0]` with day rollovers (`day[1]`, gaps up to 7 days from `day[1..7]`, longer gaps falling back to the year logic). Start with the year variant; switch only if a live test shows `year[0]` updating less often than `day[0]`.

### `measure_power`: real measurements only

Homey Energy shows live power from `measure_power`. Only measured values qualify:

- **In the dumps:** only the fuel cell (#13, #15, #17 above). None of the gas boilers or the legacy heat pump reports a live electrical power.
- **In the official list, not yet in a dump** (see the [watch list](#3-watch-list-official-list-not-yet-seen-in-a-dump)): `heating.power.consumption.current` (Basic + Adv; first choice), `heating.inverters.N.sensors.power.current` (Basic; second choice), `heating.compressors.N.power.consumption.current` (Adv only).
- **Never:** `heating.compressors.N.power`. Viessmann describes it as "the compressor power" with a command to set it; it is the configured nominal power (10 kW in every heat-pump snapshot that reports it). Neither on its own nor multiplied by compressor modulation. Homey's `energy.approximation` (fixed on/off wattage) is also an estimate and is not used.

### Fuel cell: a device that produces electricity

The Vitovalor PT2 produces electricity (16,099 kWh so far in the dump) and, through its own energy meter, reports grid import and export. At the time of the dump: production 734 W, import 376 W, export 0 W. That is consistent with roughly 1.1 kW household load, which suggests `purchase`/`sold` describe the whole household at the grid connection, not the device (to confirm, Q7).

Homey Energy counts a device's `meter_power` as consumption unless the driver's `energy` block says otherwise. For generation it expects a positive `meter_power` on a producing device (e.g. class `solarpanel`), or a different capability named in `energy.meterPowerExportedCapability`; batteries use `meterPowerImportedCapability` together with `meterPowerExportedCapability` ([Homey SDK: Energy](https://apps.developer.homey.app/the-basics/devices/energy)). The Viessmann device has class `heater`, which is frozen. Options, not decided (Q6, Q7):

- **A. Same device.** Production as `meter_power.produced` / `measure_power.produced` on the heater device, wired into Energy via `setEnergy({ meterPowerExportedCapability: … })` for fuel-cell devices only. Mixes consumer and producer on one device; how Energy shows that needs testing.
- **B. Separate device.** A second driver for the electrical side of a Vitovalor, class `solarpanel`, with `measure_power` (production) and `meter_power` (cumulative production), sharing the poll of the Viessmann device (needs per-Viessmann-device polling, roadmap 3.1). Clean Energy semantics, more pairing UI.
- **Grid import/export** either way: Insights-only by default (custom suffixes, not wired into Energy), because most homes already have a smart meter integration and Energy would count the grid twice. A whole-home meter (`energy.cumulative`) could be an opt-in for homes without one.

## 2c. Diagnostic (opt-in)

Added only while the device setting **Show diagnostic sensors** *(proposed, default off)* is on. What happens when it is switched off again is Q12.

| # | Viessmann feature | Property | Unit / type | Seen in | Plan | Capability ID *(proposed)* | Title (en) | Insights / tag | UI | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `heating.circuits.N.frostprotection` ⓒ | `status` | `on`/`off` → boolean | HP, Gas 3/3, FC | Basic | `measure_frost_active.circuit0` | Frost protection | ✓ / – | sensor · ind · uiState off | |
| 2 | `heating.boiler.temperature` | `value` | °C | Gas 3/3 | Basic | `measure_temperature.boilerTarget` (Q9) | Boiler set temperature | ✓ / – | sensor · ind | Values 5 °C and 15 °C in the dumps look like a set point, not a measurement. |
| 3 | `heating.compressors.N.sensors.temperature.inlet` | `value` | °C | HP (2025+) | Basic | `measure_temperature.compressorInlet` | Compressor inlet temperature | ✓ / – | sensor · ind | Replaces deprecated `heating.sensors.temperature.suctionGas`. |
| 4 | `heating.compressors.N.sensors.temperature.outlet` | `value` | °C | HP (2025+) | Basic | `measure_temperature.compressorOutlet` | Compressor outlet temperature | ✓ / – | sensor · ind | Replaces deprecated `heating.sensors.temperature.hotGas`. |
| 5 | `heating.compressors.N.sensors.temperature.ambient` | `value` | °C | HP (2025+) | Basic | `measure_temperature.compressorAmbient` | Compressor ambient temperature | ✓ / – | sensor · ind | |
| 6 | `heating.compressors.N.sensors.temperature.overheat` | `value` | °C (a difference, K) | HP (2025+) | Basic | `measure_temperature.compressorOverheat` | Compressor superheat | ✓ / – | sensor · ind | A temperature difference although the API says celsius. |
| 7 | `heating.evaporators.N.sensors.temperature.overheat` | `value` | °C (a difference, K) | HP (2025+) | Basic | `measure_temperature.evaporatorOverheat` | Evaporator superheat | ✓ / – | sensor · ind | As #6. |
| 8 | `heating.compressors.N.sensors.pressure.inlet` | `value` | bar | HP (2025+) | Basic | `measure_pressure.compressorInlet` | Compressor inlet pressure | ✓ / – | sensor · ind | Replaces deprecated `heating.sensors.pressure.suctionGas`. Units as Q2. |
| 9 | `heating.compressors.N.statistics.load` | `hoursLoadClassOne` … `hoursLoadClassFive` | hours | HP (2025+) | Basic | `measure_compressor_number.compressorLoadClass1Hours` … `compressorLoadClass5Hours` | Compressor hours load class 1 … 5 | – / – | sensor · ind | Five counters. |
| 10 | `heating.primaryCircuit.sensors.rotation` | `value` | % | HP (2025+) | Basic | `measure_pump_number.primaryRotation` | Primary circuit speed | ✓ / – | sensor · ind | ID from roadmap 2.6, but Viessmann describes it as *fan* speed, which fits this air-source unit (Q3). |
| 11 | `heating.device.mainECU` | `runtime` | seconds → hours (÷ 3600) | HP (2025+) | Basic | `measure_controller_number.mainEcuHours` | Controller runtime | – / – | sensor · ind | A growing counter, so it is polled here rather than read once (the roadmap lists it under "read once"). |
| 12 | `heating.cop.cooling` | `value` | number | HP (2025+) | Basic + Adv | `measure_cop_number.cooling` | COP cooling | ✓ / – | sensor · ind | 0 on this installation. |
| 13 | `heating.cop.photovoltaic` | `value` | number | HP (2026 only) | Basic | `measure_cop_number.photovoltaic` | COP photovoltaic | ✓ / – | sensor · ind | Replaces deprecated `heating.cop.green`. 0 on this installation. |
| 14 | `heating.dhw.pumps.primary` | `status` | `on`/`off` → boolean | HP (2024 only), Gas 1/3 (legacy) | Basic | `measure_pump_active.dhwPrimary` | Hot water primary pump | ✓ / – | sensor · ind · uiState off | Gone from the heat pump after 2024. |
| 15 | `heating.circuits.N.circulation.secondaryPump` ⓒ | `status` | `on`/`off` → boolean | FC | Basic | `measure_pump_active.circuit0Secondary` | Secondary circulation pump | ✓ / – | sensor · ind · uiState off | |
| 16 | `heating.sensors.temperature.allengra` | `value` | °C | FC | Basic + Adv | `measure_temperature.allengraReturn` | Return temperature (flow sensor) | ✓ / – | sensor · ind | Return temperature measured by the flow sensor. |
| 17 | `heating.sensors.volumetricFlow.allengra` | `value` | l/h → L/min (÷ 60) | FC | Basic | `measure_water.volumetricFlow` | Return flow | ✓ / – | sensor · ind | `measure_water` is a flow in L/min. |

## 2d. Controls (later, Flow actions)

Commands seen in the dumps. Ranges differ between devices, so the app must read `params.*.constraints` and `isExecutable` from the feature at runtime, never hard-code them (roadmap 1.5). Ordered by installation coverage.

| # | Viessmann feature | Command(s) → params (constraints) | Seen in (executable) | Plan | Proposed exposure | UI | Notes |
|---|---|---|---|---|---|---|---|
| 1 | `heating.circuits.N.heating.curve` ⓒ | `setCurve(slope, shift)`: slope 0–3.5 (HP) or 0.2–3.5 (gas, FC), step 0.1; shift −15…40 (HP) or −13…40 (gas, FC), step 1; both required | HP, Gas 3/3, FC (all) | Basic + Ctrl | Actions "Set curve shift to X", "Adjust curve shift by ±N", "Set curve slope to X"; read-back `measure_curve_number.circuit0Shift`, `.circuit0Slope` *(proposed)* | read-back: sensor · ind | Roadmap 3.2. Send the current value of the other parameter. Rate-limit: it writes to the controller. |
| 2 | `heating.circuits.N.operating.programs.reduced` ⓒ | `setTemperature(targetTemperature)`: 10–30 (HP) or 3–37 (gas, FC), step 1 | HP, Gas 3/3, FC (all) | Basic + Ctrl | `target_temperature.heatingReduced` *(proposed)* + action | thermostat (unpaired, see 5b) | Same pattern as `target_temperature.heating`; reads `temperature`. |
| 3 | `heating.circuits.N.operating.programs.comfort` ⓒ | `activate(temperature?)`, `deactivate()`, `setTemperature(targetTemperature)`: ranges as #2 (4–37 on the legacy boiler) | HP, Gas 3/3, FC; `activate`/`deactivate` **not executable** on E3 gas and FC | Basic + Ctrl | `target_temperature.heatingComfort` *(proposed)*; actions "Start / stop comfort program" | thermostat (unpaired, see 5b) | Roadmap 3.3. |
| 4 | `heating.circuits.N.operating.programs.eco` ⓒ | `activate()`, `deactivate()` | HP, Gas 1/3 (legacy); E3 gas lists the program without commands | Basic + Ctrl | Actions "Start / stop eco program" | — | Roadmap 3.3. |
| 5 | `heating.operating.programs.holiday` | `schedule(start, end)`: dates `YYYY-MM-DD`, `sameDayAllowed` false (HP, legacy gas) / true (E3); `unschedule()`; `changeEndDate(end)` | All; `changeEndDate` not executable anywhere | Basic + Ctrl | Actions "Schedule holiday from … to …", "Cancel holiday"; condition "Holiday program is active" (reads `active`) | — | Roadmap 3.3. |
| 6 | `heating.operating.programs.holidayAtHome` | as #5 | Gas 2/3 (E3), FC | Basic + Ctrl | As #5, "at home" variant | — | Has priority over holiday when both overlap (official description). |
| 7 | `heating.circuits.N.operating.programs.forcedLastFromSchedule` ⓒ | `activate()`, `deactivate()` | Gas 2/3 (E3), FC | Basic + Ctrl | Actions "Keep current schedule program" / "Resume schedule" (titles to be refined) | — | Keeps the last scheduled program until deactivated. |
| 8 | `heating.dhw.operating.modes.active` | `setMode(mode)`: enum `balanced`, `off` in the dumps; the official list also has `efficient`, `efficientWithMinComfort` | Gas 2/3 (E3), FC | Basic + Ctrl | `thermostat_mode.hotWater` *(proposed)*, values from the command's enum; action with autocomplete | picker (titles ≤ 3 words, see 5c) | Like roadmap 1.8 (autocomplete, no static dropdown). Enum `values` in `capabilitiesOptions` need Homey ≥ 12.0.1, covered by 1.1.0's `>=13.5.0`. |
| 9 | `heating.dhw.hygiene` | `enable()`, `disable()`, `activate()`; executability follows the current state | Gas 2/3 (E3), FC | Basic + Ctrl | `measure_dhw_active.hygiene` *(proposed)* from `active`; actions "Run hot water hygiene now", "Enable / disable hygiene function" | read-back: sensor · ind · uiState off | Anti-legionella heating to the hygiene set point. |
| 10 | `heating.dhw.temperature.hysteresis` | `setHysteresis(hysteresis)`: 1–10 K, step 0.5; `setHysteresisSwitchOnValue(hysteresis)`: same; `setHysteresisSwitchOffValue`: not executable | HP | Basic + Ctrl | Action "Set hot water hysteresis" | — | Roadmap 3.3. |
| 11 | `heating.dhw.temperature.hygiene` | `setTemperature(targetTemperature)`: 10–85, step 1 | Gas 1/3 (E3) | Basic + Ctrl | `target_temperature.hotWaterHygiene` *(proposed)*, low priority | thermostat (unpaired, see 5b) | |
| 12 | `heating.increasedReturn.temperature` | `setTargetTemperature(temperature)`: 10–95, step 1 | FC | Basic + Ctrl | None for now | — | Installer-level return-temperature set point; low value for Flows. |

Commands seen but not worth exposing: `heating.compressors.N` `setActive` / `setPhase` (not executable on legacy), `heating.circuits.N.temperature.levels` `setMin` / `setMax` / `setLevels` (installer limits; not executable on E3), `heating.circuits.N` / `.name` `setName`, `heating.dhw.hygiene.trigger` `triggerDaily` / `triggerOncePerWeek`, schedule `setSchedule` / `resetSchedule` / `resetDay`, `device.serial` `setPrin`.

## 2e. Static configuration (read once)

Read at pairing and on "Refresh Viessmann features" (roadmap 3.5), stored under a new store key, not polled into capabilities.

| # | Viessmann feature | Properties | Seen in | Plan | Use |
|---|---|---|---|---|---|
| 1 | `heating.circuits` | `enabled[]`, `internal[]` | All | Basic | Circuit indexes: circuit selection / one device per circuit (#4; ID rule 7). |
| 2 | `heating.circuits.N` ⓒ | `active`, `name`, `type` | All | not in official list | Circuit name for device naming (#4). |
| 3 | `heating.circuits.N.name` ⓒ | `name` | All | not in official list | Same name as #2; use whichever exists. |
| 4 | `heating.burners` | `enabled[]` | All (empty on HP) | Basic | Burner indexes (today hard-coded `0`; ID rule 7). |
| 5 | `heating.compressors` | `enabled[]` | HP | Basic | Compressor indexes (today hard-coded `0`; ID rule 7). |
| 6 | `heating.dhw` | `active`, `status` | All | Basic | Whether hot water is present and activated. |
| 7 | `heating.circuits.N.temperature.levels` ⓒ | `min`, `max` (°C) | HP, Gas 2/3 (E3) | Basic + Ctrl | Supply-temperature limits of the circuit. Informational. |
| 8 | `heating.configuration.flow.temperature.min` | `value` (°C) | HP (2025+) | Basic | Minimum *supply (flow)* temperature. Not the room set-point range (Q10). |
| 9 | `heating.configuration.flow.temperature.max` | `value` (°C) | HP (2025+) | Basic | Maximum supply temperature. As #8. |
| 10 | `heating.configuration.buffer.temperature.max` | `value` (°C) | HP (2025+) | Basic | Informational. |
| 11 | `heating.configuration.dhwHeater` | `useApproved` | HP (2025+) | Basic | Whether an electric DHW heater may be used. Informational. |
| 12 | `heating.dhw.temperature.levels` | `min`, `max`, `default` (°C) | FC | Basic | DHW set-point range on E3. The FC dump says min 10 / max 10, so it cannot be trusted; use the `setTargetTemperature` constraints instead. |
| 13 | `heating.coolingCircuits.N.type` | `value` (string) | HP (2025+) | Basic | Refrigerant circuit type. Support snapshot. |
| 14 | `heating.compressors.N.power` | `value` (kW) | HP (2025+) | Basic | Nominal compressor power. **Never** `measure_power`. |
| 15 | `heating.circuits.N.operating.programs.screedDrying.heatpump` | `useApproved` | HP (2025+) | Basic | Informational. |

## 2f. Not planned

| Group | Features | Reason |
|---|---|---|
| Duplicates of a value already read (19) | `heating.circuits.N.operating.modes.{standby, dhw, dhwAndHeating, forcedNormal, forcedReduced, normalStandby, heating}`; `heating.circuits.N.operating.programs.{standby, fixed, external, reducedEnergySaving}`; `heating.dhw.operating.modes.{balanced, off}`; `fuelCell.operating.modes.{ecological, economical, heatControlled, maintenance, standby}`; `heating.dhw.sensors.temperature.dhwCylinder.top` | One boolean per mode/program duplicates `…modes.active` / `…programs.active` (already mapped or proposed above). `dhwCylinder.top` had the same value as `dhwCylinder` in every dump where both exist. |
| Serial numbers and identity (2) | `device.serial`, `heating.controller.serial` | Personal data with no use in Homey; must stay out of logs and support dumps. |
| Raw schedules (3) | `heating.circuits.N.heating.schedule`, `heating.dhw.schedule`, `heating.dhw.pumps.circulation.schedule` | Large structures with no capability equivalent. Read-only schedules are listed under roadmap "Ideas / later". |
| Events, not values (3) | `device.messages.logbook`, `device.messages.errors.raw` (not in official list), `device.messages.errors.counter.d6` | Belong to the logbook / alarm trigger, roadmap 3.4, not to polled capabilities. |
| Installer settings or unclear meaning (3) | `heating.dhw.hygiene.trigger`, `heating.circuits.N.zone.mode`, `ventilation.operating.state` | Hygiene trigger is installer configuration. `zone.mode` only says whether a zone is attached. Ventilation was only in the 2024/2025 heat-pump snapshots and needs its own design. |
| Deprecated (10; not in the 106) | `heating.sensors.temperature.hotGas` / `.suctionGas`, `heating.sensors.pressure.hotGas` / `.suctionGas`, `heating.cop.green`, `heating.heatingRod.runtime`, `heating.configuration.heatingRod.dhw` / `.heating`, `heating.configuration.temperature.outside.DampingFactor`, `heating.boiler.serial` | Use the replacements: `heating.compressors.N.sensors.temperature.{inlet,outlet}`, `heating.compressors.N.sensors.pressure.{inlet,outlet}`, `heating.cop.photovoltaic`, `heatingRods.heatGeneration.N(.runtime)`, `heating.configuration.temperature.outside.dampingFactor`, `device.serial`. Five are flagged only in the heat-pump dumps, not in the official list: `heating.cop.green` since 2026-05, `heating.heatingRod.runtime`, `heating.configuration.heatingRod.*` and `…DampingFactor` since 2026-11. |
| Advanced-only, no dump evidence | e.g. `heating.compressors.N.power.consumption.*`, `heating.heat.production.{total,heating,dhw,cooling}`, `heating.heatingRod.power.consumption.current`, `heating.flue.sensors.o2.lambda` | Not planned until a dump shows them. Most have Basic `summary.*` / `currentYear.*` siblings (watch list). |

## 3. Watch list (official list, not yet seen in a dump)

Basic features worth mapping as soon as an anonymized dump shows them (mostly newer E3 heat pumps). IDs are suggestions only.

| Feature | Why | Suggested ID |
|---|---|---|
| `heating.power.consumption.current` | Real electrical power (Basic + Adv) | `measure_power` (first choice) |
| `heating.inverters.N.sensors.power.current` | Inverter power | `measure_power` (only if the above is missing) |
| `heating.heat.production.summary.{heating,dhw}`, `heating.heat.production.currentYear.*` | Heat produced; with electricity gives a real COP | new base for thermal kWh, kept out of Homey Energy |
| `heating.compressors.N.sensors.temperature.{oil,motorChamber}` | Compressor diagnostics | `measure_temperature.compressorOil`, `.compressorMotorChamber` (diagnostic) |
| `heating.evaporators.N.sensors.temperature.liquid` | Replacement for deprecated `liquidGas` | `measure_temperature.evaporatorLiquid` (diagnostic) |
| `heating.compressors.N.sensors.pressure.outlet` | Named replacement for deprecated `heating.sensors.pressure.hotGas`, but missing from the official list | `measure_pressure.compressorOutlet` (diagnostic) |
| `heatingRods.heatGeneration.N.runtime` | Named replacement for `heating.heatingRod.runtime` (roadmap 2.8), missing from the official list | per roadmap 2.8 |
| `heating.configuration.temperature.outside.dampingFactor` | Named replacement, missing from the official list | static |
| `heating.solar.sensors.temperature.{collector,dhw}`, `heating.solar.power.cumulativeProduced` | Solar thermal (roadmap "Ideas") | `measure_temperature.solarCollector`, `.solarDhw` |
| `heating.sensors.temperature.systemReturn` | Common return of a cascade | `measure_temperature.systemReturn` |
| `heating.circuits.N.operating.programs.{comfortHeating, reducedHeating}` and cooling variants | Newer E3 naming of the programs in 2d #2–#3 | extends 2d |
| `device.power.consumption.limitation`, `heating.device.smartGrid` (no plan listed) | Power-limiting tariffs, SG Ready (roadmap 3.2) | controls |
| `heating.burners.N.errorStatus` (Basic) | Burner error state; documented replacement of the deprecated `heating.burners.N.automatic`. Not seen in our dumps, so its properties are unknown | `alarm_generic.burnerFault` *(proposed)*, see [5f](#5f-alarms) |
| `heating.compressors.N.heatTarget` (Advanced only) | What the compressor is heating right now (e.g. hot water or heating). Not seen in our dumps. Everyday string sensor plus a trigger "Compressor started heating hot water". For Basic users, `heating.dhw.charging` (2a #4) together with `measure_compressor_active` gives a similar signal | `measure_compressor_heattarget` *(proposed)*, a new string base like `measure_heating_program` |

## 4. New base capabilities

Sketches in the style of `.homeycompose/capabilities/*.json`. The first three are already named in the roadmap. Icons do not exist yet. Custom capabilities and sub-capabilities get no automatic Flow cards; triggers and conditions are defined explicitly (roadmap 2.1).

**`measure_pump_active`**: circulation and DHW pumps (2a #1, #3; 2c #14, #15)

```json
{
  "type": "boolean",
  "title": { "en": "Pump running" },
  "getable": true,
  "setable": false,
  "insights": true,
  "insightsTitleTrue": { "en": "On" },
  "insightsTitleFalse": { "en": "Off" },
  "uiComponent": "sensor",
  "uiQuickAction": false,
  "uiState": false,
  "icon": "/assets/pump.svg"
}
```

**`measure_pump_number`**: pump or fan speed in % (2c #10)

```json
{
  "type": "number",
  "title": { "en": "Pump speed" },
  "units": { "en": "%" },
  "min": 0,
  "max": 100,
  "getable": true,
  "setable": false,
  "insights": true,
  "uiComponent": "sensor",
  "icon": "/assets/pump.svg"
}
```

**`measure_cop_number`**: coefficient of performance (2a #5–#7; 2c #12, #13)

```json
{
  "type": "number",
  "title": { "en": "COP" },
  "decimals": 1,
  "getable": true,
  "setable": false,
  "insights": true,
  "uiComponent": "sensor",
  "icon": "/assets/cop.svg"
}
```

**`measure_heating_program`**: active program of a heating circuit (2a #2)

```json
{
  "type": "string",
  "title": { "en": "Active program" },
  "getable": true,
  "setable": false,
  "uiComponent": "sensor",
  "icon": "/assets/program.svg"
}
```

**`measure_dhw_active`**: hot water states: charging, hygiene run (2a #4; 2d #9)

```json
{
  "type": "boolean",
  "title": { "en": "Hot water active" },
  "getable": true,
  "setable": false,
  "insights": true,
  "insightsTitleTrue": { "en": "Yes" },
  "insightsTitleFalse": { "en": "No" },
  "uiComponent": "sensor",
  "uiQuickAction": false,
  "uiState": false,
  "icon": "/assets/hotwater.svg"
}
```

**`measure_frost_active`**: frost protection (2c #1)

```json
{
  "type": "boolean",
  "title": { "en": "Frost protection" },
  "getable": true,
  "setable": false,
  "insights": true,
  "insightsTitleTrue": { "en": "On" },
  "insightsTitleFalse": { "en": "Off" },
  "uiComponent": "sensor",
  "uiQuickAction": false,
  "uiState": false,
  "icon": "/assets/frost.svg"
}
```

**`measure_controller_number`**: controller counters (2c #11)

```json
{
  "type": "number",
  "title": { "en": "Controller runtime" },
  "units": { "en": "hours" },
  "getable": true,
  "setable": false,
  "insights": true,
  "uiComponent": "sensor",
  "step": 1,
  "icon": "/assets/controller.svg"
}
```

**`measure_curve_number`**: heating curve read-back (2d #1)

```json
{
  "type": "number",
  "title": { "en": "Heating curve" },
  "decimals": 1,
  "getable": true,
  "setable": false,
  "insights": true,
  "uiComponent": "sensor",
  "icon": "/assets/curve.svg"
}
```

System capabilities reused (no new definition): `measure_temperature`, `target_temperature`, `thermostat_mode`, `measure_pressure` (unit override, Q2), `measure_water`, `measure_power`, `meter_power`, `meter_gas`. Existing custom bases reused: `measure_compressor_number`.

The boolean sketches set `"uiState": false` explicitly: none of them should drive the device tile ([5a](#5a-tile-state-uistate-for-running-booleans)). The key needs `compatibility` `>=13.5.0`, which 1.1.0 introduces.

## 5. UI improvements for existing and new capabilities

Source: [Homey SDK: Capabilities](https://apps.developer.homey.app/the-basics/devices/capabilities) (sections Custom capabilities, Device indicators, UI components, Maintenance actions), read 2026-11-25. "Validated" below means: checked with `homey app validate --level publish` (Homey CLI 4.4.0) on a scratch copy of the app, options declared in the driver's static `capabilitiesOptions`, with `compatibility` `>=10.0.0` and, for `uiState`, `>=13.5.0`. Nothing was run on a Homey, so runtime behavior is marked *to verify*.

Facts that shape every item below:

- **Homey version (decided).** 1.0.15 keeps `compatibility: ">=10.0.0"`; 1.1.0 raises it to `">=13.5.0"`. Everything proposed here ships in 1.1.0 or later, so version-gated features need no fallbacks: enum `values` in `capabilitiesOptions` (12.0.1), widgets (12.3.0), `uiState` (13.5.0). Users on older Homey versions stay on 1.0.15.

- The driver declares no capabilities statically; every capability is added at runtime (`setCapabilityOptions` + `addCapability` in `initializeCapabilities`). Options in `driver.compose.json` therefore never reach existing devices; per-device changes go through runtime options. Custom capability definitions in `.homeycompose/capabilities/` are app-wide and do apply to existing devices.
- Today `initializeCapabilities` removes every capability that no `PATHS` entry produces. Buttons and alarms that are not tied to a feature path therefore depend on the roadmap's add-only fix (principle 2), or they are removed again at the next app start.
- Device indicators are chosen by the user in the Homey app. Numbers starting with `measure_`/`meter_` show with their unit, `alarm_*` booleans are grouped behind a warning icon, custom booleans and numbers can also be indicators; strings cannot. Class `heater` is not one of the classes with a fixed indicator.
- Sub-capabilities get no automatic Flow cards; every trigger, condition and action for them is defined explicitly.

### 5a. Tile state (`uiState`) for "running" booleans

**Proposal.** `uiState: true` on `measure_compressor_active` and `measure_burner_active`, so the device tile shows the device as active while the heat generator runs. Not on `measure_pump_active`, `measure_dhw_active` or `measure_frost_active`: the circuit pump runs for most of the heating season, so the tile would be "on" almost permanently. Fuel cell: no `active` datapoint in the dumps; the existing but unused base `measure_fuelcell_active` could be fed from `fuelCell.operating.phase` (e.g. `generation` → true) and get `uiState` too (Q20). When several booleans have `uiState: true`, Homey uses the first one in the device's capability list. Here that is the order in which capabilities were added (compressor before burner in `PATHS`), which suits hybrid systems.

**Non-breaking.** IDs, Flows and Insights are unchanged; only the tile changes. No capability is the tile state today (all booleans have `uiQuickAction: false`), so nothing is displaced.

**How (decided, Q14).** Put `"uiState": true` statically in `.homeycompose/capabilities/measure_compressor_active.json` and `measure_burner_active.json`, and ship it with 1.1.0, which raises `compatibility` to `>=13.5.0`. Give the proposed booleans `"uiState": false` explicitly (section 4); `measure_fuelcell_active` waits for Q20. Validated: with `>=13.5.0` and these keys, publish validation passes; with `>=10.0.0` it fails ("requires a compatibility of at least >=13.5.0"). The definition is app-wide, so existing devices should pick up the tile state with the update, without a migration (*to verify* in the test channel).[^uistate-runtime]

[^uistate-runtime]: Not used after the decision: keeping `>=10.0.0` would have required setting `uiState` at runtime with `setCapabilityOptions` only on Homey ≥ 13.5.0, with unverified behavior on older versions.

### 5b. Thermostat pairing by dot suffix

The thermostat component pairs `target_temperature.X` with `measure_temperature.X`; the suffixes must be identical.

| Set point | Measured value | State |
|---|---|---|
| `target_temperature.hotWater` | `measure_temperature.hotWater` | Paired. |
| `target_temperature.hotWater2` | — | Unpaired. Temp 2 is a second set point for the same cylinder; pairing would need a duplicate. Leave as is. |
| `target_temperature.heating` | room temperature is `measure_temperature.circuit0_room` | Unpaired: the heating dial shows no current temperature. |
| `target_temperature.heatingReduced`, `.heatingComfort`, `.hotWaterHygiene` *(proposed, 2d)* | — | Would be unpaired, and each adds another dial. |

Renaming is ruled out: both heating IDs are frozen. Options for heating:

- **A. Additive.** New `measure_temperature.heating` *(proposed)*, fed from the same path as `circuit0_room` (`heating.circuits.N.sensors.temperature.room`) and added only where that sensor is connected (2 of 5 installations in the dumps). Set `preventInsights: true` and `preventTag: true` on it, so Insights and Flow tokens are not doubled; `circuit0_room` keeps its history. Trade-off: the same value appears twice on the device, one more ID is frozen forever, and "set/read capability" style Flows offer two room temperatures. *To verify:* whether `uiComponent: null` on the duplicate keeps it in the dial but out of the sensor list.
- **B. Leave unpaired** (today).
- **New circuit devices** (roadmap 3.1 step 2) have no frozen IDs yet: pair them from the start.

Two related notes. `target_temperature.heating` is the set point of the *normal* program; while reduced or comfort runs it is not the current target, which the dial does not show. For the proposed reduced, comfort and hygiene set points, Flow actions without a dial (or `uiComponent: null`, see 5g) avoid three extra dials (Q15).

### 5c. Picker titles (at most 3 words)

Picker value titles must fit on one line and be at most 3 words. Only titles change; value IDs, which saved Flows store, stay the same, and `thermostat_mode` has Insights prevented.

| Capability | Value ID | Title today | Proposed title |
|---|---|---|---|
| `thermostat_mode.heating` | `dhw` | Hot water | Hot water only (matches the Flow card) |
| | `heating` | Heating | Heating only (matches the Flow card) |
| | `dhwAndHeating` | Hot water and heating (4 words; "Hot water and Heating" on devices migrated from 1.0.2) | Heating & hot water |
| | `standby` | Standby | unchanged |
| | `forcedNormal` | Forced Normal (generated) | Always normal (meaning to confirm) |
| | `forcedReduced` | Forced Reduced (generated) | Always reduced (meaning to confirm) |
| | `normalStandby` | Normal Standby (generated) | Standby (normal) (meaning to confirm) |
| `thermostat_mode.hotWaterOneTimeCharge` | `activate` / `deactivate` | Active / Inactive | unchanged |
| `thermostat_mode.fuelCell` | all five | Standby, Maintenance, Heat controlled, Economical, Ecological | unchanged |
| `thermostat_mode.hotWater` *(proposed)* | `balanced`, `off`, `efficient`, `efficientWithMinComfort` | — | Balanced, Off, Efficient, Efficient, min comfort |

How titles reach devices: `config.js` titles are applied only when a capability is added. `initializeOperatingModes` keeps the titles already on the device and appends modes from the store with titles generated at pairing (`formatString` in `driver.js`: "Forced Normal", "Normal Standby"). Existing devices therefore need a one-time migration in `checkUpgradeSpecifics` that rewrites the `title` of known value IDs and leaves unknown IDs alone. One title map in `config.js` should feed the capability values, the stored `operatingModes` and the autocomplete of the planned `set-operating-mode-v2` card (roadmap 1.8). Q19.

### 5d. "Heat hot water now" button

**Proposal.** `button.dhwBoost` *(proposed)*: a stateless button (system `button`, setable, not getable) titled "Heat hot water now" that sends `heating.dhw.oneTimeCharge` → `activate` (executable on every installation in the dumps). Added only where `heating.dhw.oneTimeCharge` exists. Validated. The existing Flow action `do-one-time-hot-water-charge` already covers Flows, so the button only serves the device view; it needs no Flow card of its own.

**Coexistence.** `thermostat_mode.hotWaterOneTimeCharge` (picker Active/Inactive) stays: it also shows whether a charge is running and can cancel it.

**What retiring the old picker later would take:**

1. It is frozen; removal only through `RETIRED_CAPABILITIES` with a comment, guarded by the registry test (roadmap principles 2 and 5).
2. The Flow action `do-one-time-hot-water-charge` finds its feature path *through this capability's entry in `FEATURES`* (action listener in `driver.js`). Rewire it to the path first, or the card stops working.
3. If the card gets a `$filter` on this capability (roadmap 1.12), change the filter too, or the card disappears from devices without the capability and saved Flows break.
4. Users' Advanced Flows, scripts and dashboards that use the capability directly break. Insights loses nothing (`preventInsights: true`).
5. The picker is the only place that shows a running charge on E3 devices; `measure_dhw_active.charging` (2a #4) covers that only on the heat pump and the legacy boiler.

Lower-risk alternative: never remove it; hide it with `uiComponent: null` (5g) once the button exists (Q16).

### 5e. Maintenance action "Refresh Viessmann features"

**Proposal** (roadmap 3.5). `button.refreshFeatures` *(proposed)* with options `{ "maintenanceAction": true, "title": { "en": "Refresh Viessmann features" }, "desc": { "en": "Reads the datapoints from Viessmann again and adds new sensors. Nothing is removed." } }`. It appears under *Device settings > Maintenance actions*, not in the device view. Validated.

**Listener.** Fetch the features unfiltered (roadmap 1.2), merge `features`, `constraints` and `operatingModes` into the store as a union (principle 3), re-read the static configuration (2e), run the add-only capability init and re-apply the operating modes. Throw an `Error` with a readable message on failure; the user sees it. Rate-limit it (e.g. once per 10 minutes), because each refresh uses API calls from the daily quota.

**Rollout.** Add it at runtime for all devices in `onOAuth2Init`, with the options set through `setCapabilityOptions`. *To verify:* that `maintenanceAction` is accepted as a runtime option. Otherwise declare it in `driver.compose.json` (`capabilities` + `capabilitiesOptions`) for new pairings and add it in a migration for existing devices. Depends on the add-only fix. Non-breaking: a new capability only.

### 5f. Alarms

`alarm_*` booleans get the grouped warning indicator and flash red in the sensor list while true. Validated as sub-capabilities.

| Capability *(proposed)* | Source | Seen in | Notes |
|---|---|---|---|
| `alarm_generic.fault` | `device.messages.errors.raw`: true while `entries[]` is non-empty | HP (2024 only), Gas 3/3, FC | Not in the official list, and gone from the newer heat-pump snapshots. Candidates for newer devices: `device.messages.status.raw`, `.service.raw`, `.info.raw`, `heating.burners.N.errorStatus` (official list, not yet in a dump). Error codes as trigger tokens; ties in with the logbook trigger (roadmap 3.4). |
| `alarm_generic.lowPressure` | `heating.sensors.pressure.supply` below a threshold set in the device settings | Gas 1/3 (E3), FC | Compares a real measurement, but the threshold is the app's choice, not Viessmann's; a wrong default gives false alarms. Alternative: only a Flow condition "System pressure is below X bar" on `measure_pressure.system`. |
| `alarm_generic.burnerFault` | `heating.burners.N.errorStatus` (Basic; replaces deprecated `…automatic`) | not seen in our dumps | Burner-specific, so kept apart from the device-wide `fault`. The mapping to true/false can only be defined once a dump shows the feature's properties. |

Sub-capabilities get no automatic Flow cards: define a trigger ("Fault alarm turned on / off") and a condition ("Fault alarm is on") explicitly, with a `$filter`. Alarm booleans are logged in Insights by default, which is useful here. `alarm_generic.lowPressure` is not produced by a feature path, so it depends on the add-only fix (Q17).

### 5g. Hiding diagnostic capabilities (`uiComponent: null`)

`uiComponent: null` hides a capability's UI component; the value stays available to Insights and Flows (whether it can still be an indicator is *to verify*). It complements the **Show diagnostic sensors** setting:

- **Custom bases:** the SDK documents `uiComponent` in the capability definition, which applies to *every* sub-capability of that base. `measure_compressor_number` carries both everyday values (hours, starts, modulation) and proposed diagnostic ones (load classes), so hiding at base level would also hide tiles that show today: not breaking for IDs, but a visible change. A diagnostic-only base such as `measure_controller_number` can set it in its definition.
- **System capabilities** (`measure_temperature.compressorInlet`, `measure_pressure.compressorInlet`, `measure_water.volumetricFlow`, …) have no definition of their own, so it would have to be a per-device option. The SDK page does not show `uiComponent` in `capabilitiesOptions`, but the CLI accepts it there for a `measure_temperature.*` sub-capability (validated). *To verify:* whether `setCapabilityOptions` applies it at runtime, per device, which is what this app needs.
- **If it works per device**, the setting could have three values: Off (not added), Insights only (added with `uiComponent: null`), Show (added and visible). If it does not, keep the two-state setting (Q18).

## 6. Open questions

1. **Advanced-only datapoints** that do appear in real dumps (flue temperature, current fuel-cell production, fuel-cell gas): map them "where present", or leave them out because Advanced packages are discontinued?
2. **Pressure in bar:** `measure_pressure` with units overridden to `bar` (proposed), convert to the system unit mbar, or a custom `measure_pressure_number`?
3. **`heating.primaryCircuit.sensors.rotation`** is fan speed per Viessmann (air-source unit). Keep the roadmap's `measure_pump_number.primaryRotation`, or use a fan base (e.g. `measure_fan_number.primaryRotation`) before it ships?
4. **Legacy boiler gas in kWh:** skip `meter_gas` there, convert with a user-entered calorific value, or expose a kWh counter outside Homey Energy?
5. **Per-use splits** (`meter_gas.heating/.dhw`, `meter_power.heating/.dhw`): ship them at all? Confirm in a test that Homey Energy does not add suffixed meters to the device total.
6. **Fuel-cell production:** option A (same heater device, `setEnergy` exported meter) or B (separate `solarpanel`-class device)?
7. **Grid import/export** (`heating.power.purchase.*`, `.sold.*`): confirm they are measured at the household grid connection; Insights-only by default (proposed), with an opt-in whole-home meter?
8. Does `heating.gas.consumption.total` on a Vitovalor include the fuel cell's own gas (`heating.gas.consumption.fuelCell`)? Needs a fresh FC dump to compare sums.
9. **`heating.boiler.temperature`** (5 °C / 15 °C): set point or measurement? Decides between `measure_temperature.boilerTarget` and dropping it.
10. **Roadmap correction:** `heating.configuration.flow.temperature.min/max` are supply-temperature limits, not the room set-point range; take `target_temperature.heating` min/max from the `setTemperature` constraints instead. Agree?
11. **Roadmap correction:** `heating.configuration.temperature.outside.DampingFactor` and `heating.configuration.heatingRod.*` are flagged deprecated in the 2026-11 dump. Remove them from "read once at pairing"?
12. **Diagnostic setting switched off:** remove the diagnostic capabilities (user-initiated, Insights history is lost; warn in the setting hint) or keep them and stop updating? Principle 2 only covers automatic removal.
13. **Program as `string` or `enum`:** string (proposed) tolerates unknown program ids but is not logged in Insights and gives no dropdown in Flows; enum needs a per-device value list (its Homey 12.0.1 requirement is covered from 1.1.0).
14. ~~**Tile state:** set `uiState` at runtime, or raise `compatibility`?~~ **Decided:** 1.1.0 raises `compatibility` to `>=13.5.0` (1.0.15 stays `>=10.0.0`); `uiState` goes statically into the capability definitions (5a).
15. **Heating thermostat:** add a duplicate `measure_temperature.heating` (Insights and tag prevented) so the dial shows the room temperature, or leave it unpaired? And should the reduced, comfort and hygiene set points get dials at all, or be Flow-only?
16. **One-time charge:** once `button.dhwBoost` exists, keep the picker, hide it, or retire it (steps in 5d)?
17. **Alarms:** `alarm_generic.lowPressure` with which default threshold, or only a Flow condition? Which datapoint should drive `alarm_generic.fault` on devices without `device.messages.errors.raw`?
18. **Diagnostic visibility:** a three-level setting (Off / Insights only / Show) if per-device `uiComponent: null` works at runtime?
19. **Mode titles:** confirm the meaning and English wording of `forcedNormal`, `forcedReduced` and `normalStandby`. Is "Heating & hot water" acceptable under the 3-word rule?
20. **Fuel-cell tile state:** feed `measure_fuelcell_active` from `fuelCell.operating.phase`, and which phases count as running?
21. **IDs for index ≥ 1** (ID rule 7): append the unit and index to the sub-ID (`…Compressor1`, `…Burner1`, proposed) or put the index inside it (`compressor1Hours`)? Decide together with #4. With one Homey device per circuit (roadmap 3.1 step 2) circuit capabilities may never need an index suffix, but compressors, burners and evaporators on the same device would.

## Refreshing this catalogue

`scripts/featureCoverage.js` lists every feature that is usable in at least one dump, not deprecated, and not mapped in `config.js`, with a state per dump and the plan from the official list. It prints only feature names, no property values.

Against the anonymized fixtures in the repository (the default when no input is given):

```bash
node scripts/featureCoverage.js
```

Against a local folder of raw dumps, for example the untracked `documentation/json-example-files/`, alone or together with the fixtures:

```bash
node scripts/featureCoverage.js documentation/json-example-files test/fixtures
```

- Directories are scanned recursively for `*_features.json`, so the `*_installations.json` fixtures are skipped; other file names (such as a raw `myvies.json`) can be passed directly.
- The official datapoint list is picked up automatically from the newest local `documentation/viessmann-datapoints-*.json`. Use `--official <file>` to choose one, or `--no-official` to skip it. Without it, officially deprecated features are not filtered: `heating.boiler.serial` then shows up as a 107th row.
- `--all` includes mapped features, `--exact` keeps indexes (`circuits.1`) instead of `N`, and `--json` gives machine-readable output. A warning is printed if a mapped path is flagged deprecated anywhere.
- The fixtures with the 2026-11-25 official list give exactly the 106 features classified above, the same set as the eight raw dumps.
- `test/featureCoverage.test.js` runs the script's analysis on the fixtures in `npm test`, so it keeps working as `config.js` and the fixtures change.

New rows in the output are features to classify here. After a new dump is turned into a fixture (`npm run fixtures`, see `test/fixtures/README.md`), the plain command is enough.
