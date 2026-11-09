An app to control Viessmann devices. Control it with flows in Homey, check its status, and more.
Get it set up:
* Log in to Viessmann dev portal https://app.developer.viessmann-climatesolutions.com/ with your existing ViCare app user.
* At the Viessmann dev portal add a new client to get a Viessmann Client ID. Name it Homey, ensure Google reCaptcha is turned off and set redirect URI to https://callback.athom.com/oauth2/callback.
* After installation of the Viessmann ViCare Homey app go to settings of the app and enter the ‘Client ID’ generated in the step above.
* Now add your new Viessmann device in Homey and log in with your ViCare app user when asked to.


Heating circuit support:
- The app detects enabled heating circuits when pairing and refreshes existing pairings once after this update; removing devices or recreating Flows is not required.
- Circuit 0 is preferred when enabled. Otherwise the first enabled circuit is used (for example circuit 1 on some Vitoconnect Optolink installations).
- The same circuit is used for operating modes, heating target temperatures, readings, and polling. Each Homey device currently controls one heating circuit.
- Forced normal and forced reduced modes are available in Flows when supported by the installation. Unsupported mode requests report an error.

After installing this version, verify the operating mode and heating target temperature against ViCare. Test both the device controls and existing Flow actions. Automated tests use mocked API responses; hardware validation is still required.

See [reliability improvements and testing instructions](docs/reliability-improvements.md) for circuit selection, command validation, authentication handling and polling behavior.
