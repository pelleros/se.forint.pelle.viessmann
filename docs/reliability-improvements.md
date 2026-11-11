# ViCare reliability improvements

## Problem and reproduced behavior

A Vitoconnect Optolink installation exposed only heating circuit `1`. Homey operating-mode Flows showed a generic error because the app used circuit `0`. A direct API command to circuit `1` with `{"mode":"dhwAndHeating"}` returned HTTP 200 / `COMMAND_EXECUTION_SUCCESS`, and the user confirmed the mode changed in ViCare. No credentials or installation identifiers are required to reproduce the code-level issue.

Investigation also found that failed token-refresh responses could overwrite saved credentials, SDK rate-limit errors lost their HTTP metadata, fixed-interval polling could overlap slow requests, and existing device tests depended on example files absent from Git.

## Resulting behavior

### Authentication and error reporting

- Token responses are checked for HTTP success, valid JSON, a nonempty access token, and a valid refresh token when supplied. Failed refreshes leave the saved token unchanged.
- Refresh-token rotation is supported. When a successful response omits a refresh token, the previous refresh token is retained.
- Token endpoint requests use the existing 30-second timeout.
- Access and refresh tokens are no longer logged explicitly. SDK debug messages redact bearer headers, token objects, form token fields, client secrets and PKCE verifiers, including known saved token values.
- Errors retain HTTP status and safe Viessmann details. Authentication failures, forbidden API access, missing resources, invalid commands and rate limits have distinct messages. Request identifiers and API error codes remain attached for diagnostics.
- HTTP 401 after the SDK's one refresh/retry remains an authentication error. HTTP 429 retains `Retry-After` rather than becoming the SDK's generic `Rate Limited` error.

### Commands

- Device metadata retains each command's parameters and `isExecutable` flag. Poll responses update command availability in memory.
- Flow and device controls check command existence, executability, required arguments, supported simple types, enumerated values, numeric ranges/steps, and string lengths before sending a request.
- Successful HTTP responses reporting `data.success: false` are treated as command failures. Rejected commands do not optimistically update the displayed capability value.
- Validation reflects the latest metadata; a device can still reject a command if its state changes between polling and execution. That error is reported to the caller.

### Polling

- Each device schedules its next poll after the previous request finishes. There is at most one in-flight poll per device.
- The normal delay remains two minutes multiplied by the number of devices, with a minimum of two minutes.
- Consecutive failures double the delay up to 30 minutes, without shortening the normal device-count-based delay. A longer server `Retry-After` takes precedence. Both seconds and HTTP-date forms are supported.
- Successful polling resets backoff. Repeated failures mark the device unavailable; authentication failures provide repair guidance immediately.
- Removing/reinitializing a device or changing its circuit cancels scheduled polling and waits for an in-flight poll to finish. A stopped poller does not start another request or apply an obsolete response.
- Commands are not automatically retried; this avoids repeating a command whose result is uncertain.

### Heating circuit selection

- Automatic discovery prefers enabled circuit `0`, otherwise the first enabled circuit. This preserves existing circuit-0 behavior.
- In the Homey device's advanced settings, **Heating circuit** defaults to `auto`. Enter an enabled circuit number such as `1` to choose explicitly.
- Invalid or unavailable circuits are rejected before changing the device. Applying a valid setting refreshes capabilities, constraints, operating modes and command metadata, then restarts polling.
- Existing paired-device identifiers and Flow identifiers are preserved. A one-time metadata refresh handles older pairings without deleting devices.
- One Homey device controls one selected heating circuit. Simultaneous independent control of multiple circuits is outside this change.

### Development checks

- Device tests now use a small synthetic fixture under `drivers/vicare/__tests__/fixtures`, rather than untracked files in `documentation`. Values are illustrative; the fixture contains no real serial numbers or account data.
- The Homey ESLint plugin is an explicit development dependency. A pinned TypeScript version supports the Node 18 tsconfig used by the lint parser. The lockfile matches `package.json`.
- Mock/test files may contain multiple mock classes. Runtime lint rules remain enabled.
- `.gitattributes` specifies LF endings for JavaScript, JSON and Markdown; scratch files under `work/` are ignored.
- Existing Jest configuration and mock whitespace were corrected only where necessary to pass lint. Production code has not been broadly reformatted.

## Reproducible validation

Use Node.js 18 or newer. Install development dependencies without invoking the repository's Homey installation lifecycle:

```sh
npm ci --ignore-scripts --legacy-peer-deps
npm run build
npm run lint
npm test -- --runInBand
node scripts/generateFlowCompose.js
node scripts/generateDriverCompose.js
git diff --check
```

`--legacy-peer-deps` accommodates the existing Athom lint stack's older ESLint peer declarations. `--ignore-scripts` prevents dependency installation from invoking `homey app install` or moving documentation. Installing/running on Homey remains an explicit separate action.

Automated coverage includes circuits 0/1/2, explicit selection and invalid settings, pairing migration, Flow routing, per-device mode isolation, rejected commands, temperature constraints, token refresh failures/rotation, debug redaction, HTTP error metadata, polling backoff/recovery and stopping slow requests. API responses and timers are mocked; tests do not contact or change a heating system.

The recorded test result is in [VALIDATION.md](VALIDATION.md). Homey publish validation and live hardware testing remain separate checks.

## Manual verification before release

1. Install the branch on a test Homey using the normal Homey CLI workflow. Keep existing device pairing and Flows.
2. On a circuit-1 installation, compare operating mode, temperature target and supply readings with ViCare. Repeat on a circuit-0 installation.
3. Run existing operating-mode and temperature Flows. Verify supported forced modes, and confirm an unsupported mode produces a useful error.
4. On a multi-circuit installation, select another enabled circuit in advanced settings. Check readings and commands follow that circuit. Verify `auto` restores automatic choice and an invalid circuit is rejected.
5. After temporary loss of network/API access, verify polling recovers and the device becomes available again. Do not deliberately exhaust the production API quota; rate-limit behavior is covered by mocked tests.

## Review and contribution scope

These changes follow `CONTRIBUTING.md`: describe the failure and evidence, keep fixes relevant to the requested reliability work, include regression tests and document limitations. The work is kept in focused development-check and runtime commits. Before sending an upstream PR, squash each independently submitted change as requested by the contributing guide, and check for upstream conflicts. No upstream issue, PR, review request or release is created by this change.


## Homey CLI build compatibility

The Homey CLI detects the direct TypeScript development dependency used by lint tooling and invokes `npm run build`. The build script compiles only runtime JavaScript through `tsconfig.build.json` into `.homeybuild`, preserving the existing app ID and source directory layout. Tests, development scripts and scratch files are excluded from compiler inputs. The CLI copies assets and production dependencies as part of its normal preprocessing.
