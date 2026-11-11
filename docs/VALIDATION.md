# Validation record

Validated on 9 November 2026 on Windows with mocked Viessmann responses and timers.

| Check | Result |
| --- | --- |
| `npm run lint` | Passed, no errors or warnings |
| `npm test -- --runInBand` | Passed: 6 suites, 78 tests |
| `node scripts/generateFlowCompose.js` | Passed; generated Flow definitions unchanged |
| `node scripts/generateDriverCompose.js` | Passed; circuit setting preserved |
| `git diff --check` | Passed |
| `npm ci --ignore-scripts --legacy-peer-deps --dry-run` | Passed; manifest and lockfile consistent |

The full device test suite now runs using the committed synthetic fixture. New tests cover token-refresh preservation and rotation, SDK debug redaction, HTTP 401/403/429 details, Retry-After seconds/dates, command constraints and rejected commands, polling backoff/recovery/shutdown, pairing migration, Flow routing and explicit circuit selection.

The test runner emits an informational notice about its transitive `baseline-browser-mapping` data age. Dependency installation also reports existing dependency audit findings; updating the broader dependency stack is separate from this reliability fix.

The initial automated checks did not include Homey publish validation or live installation. Subsequent deployment results are recorded below. The earlier direct API test was performed by the user and confirmed circuit-1 operation. Use the [manual verification checklist](reliability-improvements.md#manual-verification-before-release) for remaining release checks; mocked tests alone do not establish hardware compatibility.

## Installation build follow-up — 11 November 2026

A live install attempt stopped during preprocessing because the Homey CLI detects the direct TypeScript development dependency and runs `npm run build`. The repository had no build script.

Added `build: tsc --project tsconfig.build.json` and a runtime-only build configuration. The lint configuration is preserved; tests, scripts and scratch files are excluded from compilation output.

- `npm run build`: passed.
- `homey app build`: passed, including TypeScript compilation and Homey debug-level validation.
- Confirmed emitted runtime entry points in `.homeybuild`.
- No upload to Homey or live heating command was performed for this verification. Publish-level validation remains separate.

## Live deployment confirmation — 11 November 2026

- Platform: Homey Pro mini, firmware 13.5.3; Homey CLI 4.6.3 on Windows.
- The user's package passed `homey app validate --level publish`.
- The normal install command initially returned `Missing File` during installation despite successful compilation and validation. The underlying cause of that initial response was not established.
- A direct upload through the Homey CLI's existing API client was accepted. An initial retry used the validation staging folder, which lacked runtime dependencies and crashed. Rebuilding the full bundle with `homey app build` before uploading resolved that startup failure.
- The complete bundle was uploaded using `clean: false`; Homey reported the app running with `crashed: false`.
- The user then confirmed: “Now works.” This confirms operation on the reported installation. It does not establish that every supported model, Flow action, circuit-selection scenario or error-recovery path has been tested on hardware.
- Preservation of the previous paired-device and Flow identifiers was not independently verified during this deployment; the earlier API checks did not return the previous ViCare device.

For future deployments, run a fresh `homey app build` or normal `homey app install` after standalone validation. Do not upload a staging folder produced only by `homey app validate`: it may omit production dependencies. Keep `--clean` omitted unless deliberately resetting all app settings and paired devices. The direct API retry above records the troubleshooting outcome, not a general replacement for the supported CLI install workflow.
