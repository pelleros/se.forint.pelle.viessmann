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

No Homey publish validation, live installation or live heating command was performed during this implementation. The earlier direct API test was performed by the user and confirmed circuit-1 operation. Use the [manual verification checklist](reliability-improvements.md#manual-verification-before-release) before release. No hardware compatibility claim is inferred from mocked tests.

## Installation build follow-up — 11 November 2026

A live install attempt stopped during preprocessing because the Homey CLI detects the direct TypeScript development dependency and runs `npm run build`. The repository had no build script.

Added `build: tsc --project tsconfig.build.json` and a runtime-only build configuration. The lint configuration is preserved; tests, scripts and scratch files are excluded from compilation output.

- `npm run build`: passed.
- `homey app build`: passed, including TypeScript compilation and Homey debug-level validation.
- Confirmed emitted runtime entry points in `.homeybuild`.
- No upload to Homey or live heating command was performed for this verification. Publish-level validation remains separate.
