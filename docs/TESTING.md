# Testing on a real Homey: the dev twin

The Jest tests in this repository run against anonymized fixtures. Some things can only be checked on a real Homey with a real Viessmann installation: pairing, Repair, commands, and above all the upgrade from the version users have today to the next release. This page describes how to do that without touching the App Store version of the app on the same Homey.

## Why a twin

A Homey that already runs the App Store app (`se.forint.pelle.viessmann`) holds that app's devices and, through them, years of Insights history and the Flows that use them. Installing a development build with `npm run homey:install` would replace that app, and deleting or re-pairing its devices would lose the history.

The **dev twin** is the same code under another app ID:

| | App Store app | Dev twin |
| --- | --- | --- |
| App ID | `se.forint.pelle.viessmann` | `se.forint.pelle.viessmann.dev` |
| Name | Viessmann ViCare | ViCare (dev) |
| Poll interval | 2 minutes per device | 10 minutes per device (`--poll-minutes`) |

Homey treats the twin as a separate app. It has its own app settings (its own Client ID), its own devices, its own Flow cards (listed under "ViCare (dev)") and its own Insights, while pairing the same Viessmann installation. Everything else, including the version number, is exactly as in the git ref it was built from.

`scripts/devTwin.js` builds it (`npm run homey:twin -- <command> ...`):

1. Exports the committed tree of `--ref` (default `HEAD`) with `git archive` into a new temporary directory outside the repository (`$TMPDIR/vicare-dev-twin-<sha>-…`). Uncommitted changes and untracked files such as `documentation/` are not included.
2. Sets the twin's ID and name in `.homeycompose/app.json` (and `app.json`), and the poll interval in `drivers/vicare/driver.js` (`MIN_POLL_INTERVAL`). If a ref defines its poll interval in a way the script doesn't recognise, it stops instead of building a twin that polls at the real app's rate; teach `POLL_PATTERNS` in the script the new form, or pass `--allow-default-poll` if you really mean it.
3. Runs `npm ci --ignore-scripts` (old versions have an npm script named `install` that would run `homey app install`) and the ref's own `scripts/generateFlowCompose.js`, if it has one.
4. Runs `homey app build` (and, for `build`, `homey app validate --level publish`), then checks that the built `app.json` has the twin's ID and name and that the built driver has the new poll interval.
5. For `install` and `run` only: prints the exact Homey CLI command, the directory and the Homey selected in the Homey CLI, and asks `Continue? [y/N]`. Only `y` runs it.

| Command | What it does |
| --- | --- |
| `npm run homey:twin -- build [--ref <ref>] [--keep]` | Build and validate the twin locally. Nothing is installed. With `--keep` the directory is kept and printed. |
| `npm run homey:twin -- install [--ref <ref>]` | Build, then `homey app install` after confirmation. The twin stays installed, and installing again over it is an upgrade: devices and settings are kept. |
| `npm run homey:twin -- run [--ref <ref>] [-- --remote]` | Build, then `homey app run` after confirmation, with live logs. **When `run` stops (Ctrl+C), the Homey CLI uninstalls the twin, and the devices paired to it go with it.** Use it only for throwaway pairings, never for the upgrade test. Without `--remote` it needs Docker on your computer. |

Options: `--ref <commit|branch|tag>`, `--poll-minutes <n>` (default 10; never shorter than the ref's own interval), `--keep`, `--allow-default-poll`, `--fixture <name>` (see [Fixture mode](#fixture-mode)). Arguments after a second `--` go to the Homey CLI. Don't pass `--clean` to `install` during an upgrade test: it deletes the twin's devices and settings first.

## API quota

Viessmann's free plan allows about 1,450 API calls per day per user. The app makes about one call per poll, and the interval is multiplied by the number of devices, so an app polls about 720 times a day at 2 minutes and 144 times a day at 10 minutes, however many devices it has. App Store app and twin together come to roughly 864 calls a day plus a few for pairing, starting and commands: below the limit even if both count against the same one. Every install or restart polls once immediately, so avoid reinstall loops, and don't lower `--poll-minutes` for long.

## One-time setup

1. Install the Homey CLI (`npm install --global homey`), log in with `homey login` and select your Homey with `homey select`. The twin script never logs in or changes the selection; it shows which Homey is selected before it installs anything. If an install fails with "Missing File" right after `homey login`, run it once more before looking further: that happened once and the repeated install worked.
2. The twin needs a Client ID. If the [Viessmann developer portal](https://app.developer.viessmann-climatesolutions.com/) lets you add a second client, create one for the twin as for the real app (a name such as "Homey dev twin", Google reCAPTCHA **off**, redirect URI `https://callback.athom.com/oauth2/callback`): it keeps the twin's tokens apart from the real app's. The free "Developer Portal Basic" package shows no way to add a second client; then use the real app's Client ID. The twin logs in on its own and gets its own tokens, and the API quota is shared either way (see above). After the twin's first login, check that the real app's device keeps updating.
3. After the first install of the twin, open *ViCare (dev)* in the Homey app (*More* > *Apps*), go to its settings and enter the Client ID. App settings survive reinstalls over the same app ID; they are only lost when the twin is uninstalled (or installed with `--clean`).

## Upgrade test

Checks that a user on the App Store version (1.0.14, commit `874e0df`) who updates to the release candidate keeps everything. Use `install` for both steps, never `run`, and don't uninstall the twin in between.

1. Install the twin as the App Store version:

   ```bash
   npm run homey:twin -- install --ref 874e0df
   ```

2. Enter the twin's Client ID in its app settings (first time only).
3. Pair: *Devices* > *+* > *ViCare (dev)* > *ViCare*, log in with your ViCare account and add the device(s).
4. Wait for at least two polls (10 minutes each) and write down the baseline for every twin device:
   - its capabilities and current values (the device tile, or the device in the [Homey Developer Tools](https://tools.developer.homey.app/));
   - the operating modes in the mode picker;
   - a few test Flows that use the twin device: the "heating mode changed" trigger, the "compressor/burner is running" condition, an action such as setting the hot water temperature, and a Homey number trigger such as "hot water temperature becomes greater than".
5. Install the twin from the release candidate over it (a branch, tag or commit; the version number doesn't need to differ):

   ```bash
   npm run homey:twin -- install --ref <release-candidate>
   ```

6. Check, for every twin device:
   - **No capability disappeared** compared with the baseline (new ones may appear), and its Insights history is still there and continues.
   - **Values update** after the next poll; the device stays available.
   - **Commands work** from the device and from the Flow actions (operating mode, temperatures, one-time hot water charge), and the change shows up in the ViCare app.
   - **Flows still work:** no card shows as missing or broken, and the trigger fires when the operating mode changes.
   - **Repair works:** device > settings > *Repair*, log in again; the device keeps its capabilities and keeps updating.
7. Leave the twin installed for the next release candidate, or remove it (see below). To repeat the test from scratch, remove the twin and start again at step 1.

## Pairing test

Checks that a new user can pair with the release candidate.

1. Make sure the twin has no device for the installation you want to pair: an app does not offer a device it has already paired. Delete the twin's device (only the one under *ViCare (dev)*) or remove the twin first.
2. Install the release candidate and pair:

   ```bash
   npm run homey:twin -- install --ref <release-candidate>
   ```

   For live logs during pairing, use `run` instead (`npm run homey:twin -- run --ref <release-candidate>`, add `-- --remote` to run it on the Homey instead of in Docker), keeping in mind that the twin and its devices are uninstalled when `run` stops.
3. Check that the device gets capabilities that match its type (heat pump, boiler, fuel cell), that values arrive after the first poll, that the operating modes are the device's own, that commands and Flow cards work and that Repair works, as in the upgrade test.
4. Also try the errors a new user meets: pairing without a Client ID in the twin's settings, and with a wrong one.

## Fixture mode

With `--fixture <name>` the script builds the **fixture twin** instead: the same code, answering from one of the fixtures in `test/fixtures/` instead of the Viessmann API. It needs no Viessmann account, no Client ID and no API quota, so you can see how a gas boiler, a fuel cell, an E3 device or an installation with two heating circuits looks on a real Homey: the device tile, Climate, Insights, the Flow cards it offers and how commands behave.

| | Dev twin | Fixture twin |
| --- | --- | --- |
| App ID | `se.forint.pelle.viessmann.dev` | `se.forint.pelle.viessmann.fixture` |
| Name | ViCare (dev) | ViCare (fixture) |
| Data | Your Viessmann installation | One fixture, bundled into the twin |

```bash
npm run homey:twin -- install --fixture vitodens_200_e3
```

- **Names:** our fixtures by their file name without `_features.json` (`vitocal_222`, `vitodens_200_e3`, `vitovalor_pt2`, …) and PyViCare's as `pyvicare/<file name>` (`pyvicare/Vitocal250A_TwoCircuits`). An unknown name lists them all; the capability matrix (`drivers/vicare/__tests__/capabilityMatrix.json`) shows what each one gets.
- **Pairing and Repair** ask for a user name and password instead of the Viessmann login: anything works. The twin lists the fixture's installation (PyViCare responses get a made-up one with one heating device).
- **Polls** return the fixture's features, with fresh timestamps. **Commands** (from the device, Flows or voice) change the fixture's values in the twin, so the next poll shows them; a command the fixture does not offer is refused. Values do not change otherwise. Restarting the twin starts again from the fixture.
- The fixture and the fixture client come from this checkout (`test/fixtures/`, `scripts/fixtureTwin/`), the app code from `--ref`. That also works for older refs: install `--ref <old version> --fixture <name>`, pair, then install the release candidate with the same `--fixture` to test the upgrade of an installation type you don't have.
- To try another fixture, remove the fixture twin's devices (or the fixture twin) first: devices keep the identity of the installation they were paired from.
- How it works: the script copies `scripts/fixtureTwin/FixtureOAuth2Client.js` and the fixture into the twin's `fixtureMode/`, renames `app.js` to `app.store.js` and writes an `app.js` that uses the fixture client, and switches the pairing and Repair views to `login_credentials`. None of this can reach the App Store package: `scripts/checkPackage.js` fails on `fixtureMode/`, `app.store.js`, fixture files and the fixture mode marker.

## Removing the twin

Uninstall *ViCare (dev)* (or *ViCare (fixture)*) on the Homey (*More* > *Apps* > *ViCare (dev)* > *Uninstall*). Its devices, their Insights, its app settings and the Flow cards that used them go with it; Flows that used them show the cards as missing. The App Store app, its devices and its Flows are untouched. Optionally delete the twin's client in the Viessmann developer portal.

Build directories are removed after each run unless you passed `--keep` (or the run failed); kept ones are under `$TMPDIR/vicare-dev-twin-*`.
