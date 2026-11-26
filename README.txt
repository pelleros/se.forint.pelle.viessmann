Bring your Viessmann heating into Homey. Whether you have a heat pump, a gas boiler or a fuel cell, you can follow temperatures, the operating mode and whether the compressor or burner is running (with runtime and starts), change heating and hot water settings, and let your Flows take care of the rest.

Viessmann asks every user to create their own free Client ID, so getting started takes about five minutes:
1. Install the app and open its settings page in Homey. It has a link to the Viessmann developer portal and the redirect URI, ready to copy.
2. Sign in to the developer portal with your ViCare account and add a new client. Name it Homey, turn Google reCAPTCHA off and paste the redirect URI exactly as shown. Viessmann allows only one client per account: if you already have one (for example for Home Assistant), use it and add the redirect URI to it.
3. Copy the Client ID into the app settings and save it.
4. Add a new device, choose Viessmann ViCare and log in with your ViCare account.

If something goes wrong:
- "Invalid redirection URI" when logging in: the redirect URI in your Viessmann client does not match. Paste it again from the app settings.
- Login works but no devices are found: check that your heating system shows up in the ViCare app and that the Client ID was saved before you added the device.
- Device unavailable after a while: open the device settings, choose Repair and log in again.
The app settings page has more tips, and you can ask for help on the Homey Community Forum.
