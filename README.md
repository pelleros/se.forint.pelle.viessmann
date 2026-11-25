An app to control Viessmann devices. Control it with flows in Homey, check its status, and more.
Get it set up:
* Log in to Viessmann dev portal https://app.developer.viessmann-climatesolutions.com/ with your existing ViCare app user.
* At the Viessmann dev portal add a new client to get a Viessmann Client ID. Name it Homey, ensure Google reCaptcha is turned off and set redirect URI to https://callback.athom.com/oauth2/callback.
* After installation of the Viessmann ViCare Homey app go to settings of the app and enter the ‘Client ID’ generated in the step above.
* Now add your new Viessmann device in Homey and log in with your ViCare app user when asked to.

## Development

Requirements: Node.js 22 and the Homey CLI (`npm install --global homey`).

| Command | What it does |
| --- | --- |
| `npm ci --ignore-scripts` | Install dependencies. Nothing is built or deployed. |
| `npm test` | Run the Jest tests against the anonymized fixtures in `test/fixtures/` (plus local dumps in `documentation/json-example-files/`, if present). |
| `npm run lint` | Run ESLint. |
| `npm run homey:validate` | Regenerate the compose files and run `homey app validate --level publish`. |
| `npm run homey:run` | Regenerate the compose files and run the app on your Homey (`homey app run`). Extra arguments go to the Homey CLI, e.g. `npm run homey:run -- --remote`. |
| `npm run homey:install` | Regenerate the compose files and install the app on your Homey (`homey app install`). |
| `npm run homey:publish` | Regenerate the compose files and publish the app (`homey app publish`). |
| `npm run doc` / `npm run nodoc` | Move the local `documentation/` folder back into / out of the app folder by hand. |
| `npm run fixtures` | Regenerate `test/fixtures/` from the raw dumps in `documentation/json-example-files/` (maintainer only). |

The `homey:*` commands run `scripts/homey.js`. It regenerates `drivers/vicare/driver.flow.compose.json` and `driver.compose.json`, moves the local `documentation/` folder out of the app while the Homey CLI runs (so it is not packaged), and always moves it back afterwards, also when the CLI fails or is stopped with Ctrl+C. If the process is killed hard, run `npm run doc`.

`documentation/` holds raw API dumps from real installations (serial numbers, installation ids) and is never committed. To add test coverage for a new installation type, anonymize the dump into `test/fixtures/` (see [test/fixtures/README.md](test/fixtures/README.md)); `test/fixtures.privacy.test.js` fails if anything identifying is left.

CI (`.github/workflows/ci.yml`) runs lint, the tests, a check that `driver.flow.compose.json` is up to date and `homey app validate --level publish` on every push and pull request.
