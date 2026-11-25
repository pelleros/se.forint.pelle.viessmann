# Troubleshooting

This page helps you set up the Viessmann ViCare app for Homey Pro and fix the problems people run
into most often. The same tips, in short, are on the app's settings page in Homey.

- [Setup](#setup)
- [Common problems](#common-problems)
- [Sending a useful report](#sending-a-useful-report)
- [Viessmann API limits](#viessmann-api-limits)
- [Viessmann outages and maintenance](#viessmann-outages-and-maintenance)

## Setup

Viessmann's free API plan requires every user to create their own Client ID. This is a one-time
step and takes about five minutes.

1. **Install the app** on your Homey Pro.
2. **Open the Viessmann developer portal**, <https://app.developer.viessmann-climatesolutions.com/>,
   and sign in with your ViCare account (the same email address and password as in the ViCare app).
3. **Add a new client:**
   - Name: anything, for example `Homey`.
   - Google reCAPTCHA: **off**. Logging in from Homey does not work while it is on.
   - Redirect URI: exactly `https://callback.athom.com/oauth2/callback`, with no extra spaces,
     slashes or characters. The app's settings page has a copy button for it.
4. **Copy the Client ID** of the new client.
5. **Open the app's settings** in Homey (More > Apps > Viessmann ViCare), paste the Client ID and
   press Save.
6. **Add a device:** add a new device in Homey, choose Viessmann ViCare and log in with your
   ViCare account. Pick your heating system from the list.

Save the Client ID before you start adding a device. If you change it later, open each device and
choose Repair so it logs in with the new Client ID.

## Common problems

### "Invalid redirection URI" on the Viessmann login page

**Cause:** the redirect URI in your Viessmann client does not match the one Homey uses. Even one
extra character (a space, a trailing slash, `http` instead of `https`) is enough.

**Fix:** open your client in the developer portal, set the redirect URI to exactly
`https://callback.athom.com/oauth2/callback` (copy it from the app's settings page), save, and
start adding the device again.

### "No Viessmann Client ID has been saved yet" when adding a device

Older versions say "Viessmann Client ID is not configured".

**Cause:** the app has no Client ID.

**Fix:** follow the [setup](#setup) steps, save the Client ID in the app's settings, then add the
device again.

### Login works, but no devices are found or an unknown error appears

**Cause:** usually one of these:

- The heating system is not linked to the ViCare account you logged in with, or its gateway is
  offline.
- The Client ID was saved (or changed) while the window for adding devices was already open.

**Fix:**

1. Check that the heating system shows up and is online in the ViCare app, with the same account.
2. Check in the developer portal that reCAPTCHA is off for your client.
3. Check that the app's settings show the right Client ID, close the window for adding devices and
   start again.

If it still fails, [send a diagnostic report](#sending-a-useful-report).

### "No OAuth2 Client Found" (or "No device found") in the troubleshooting tools

**Cause:** the troubleshooting tools on the settings page use the login of a device you have
already added. Before the first device is added, there is no login to use.

**Fix:** add a Viessmann ViCare device first, then try again.

### Device unavailable: "Multiple communication errors" or "Viessmann HTTP …"

**Cause:** the app could not reach Viessmann three times in a row. This is usually a temporary
Viessmann outage, an internet problem at home or the [daily API limit](#viessmann-api-limits). When
Viessmann did answer, the device shows that answer instead, for example
"Viessmann HTTP 503: Service Unavailable".

**Fix:** usually nothing. The app keeps trying, waiting longer between attempts while the problem
lasts (at most 30 minutes), and the device becomes available again as soon as Viessmann answers. If it stays unavailable for more than an hour or two while the ViCare app works,
your login has probably expired: see the next problem.

### Device unavailable after weeks or months: "Authentication failed" or connection lost

**Cause:** your Viessmann login for Homey has expired or been revoked, for example after a password
change, after you deleted or changed the client in the developer portal, or after a long time
without contact. In a diagnostic report this often shows up as `invalid_grant`; the device then says
"Authentication failed, open the device and choose Repair".

**Fix:** open the device in Homey, go to its settings (gear icon), choose **Repair** and log in with
your ViCare account again. Your flows and settings stay as they are.

### "Viessmann HTTP 429: API rate limit exceeded"

**Cause:** your ViCare account has used up its [daily API calls](#viessmann-api-limits).

**Fix:** wait; the limit resets over the following day. If it happens often, check whether other
systems use the Viessmann API with your ViCare account.

## Sending a useful report

A good report makes the difference between a quick fix and a lot of guessing.

1. **Diagnostic report:** in the Homey app, open the Viessmann ViCare app (More > Apps > Viessmann
   ViCare) and send a diagnostic report. Add a short message: what you did, what you expected, what
   you saw (the exact error text), roughly when it happened, your Homey and app version, and which
   heating system you have. The report contains the app's log and goes to the developer only.
2. **Raw data from the settings page (optional):** under Troubleshooting on the app's settings
   page, press "Get Installation Data", pick your device, press "Get Feature Data", and copy both.
   This shows exactly what Viessmann sends to the app and is very useful when a value is missing or
   wrong.

   The app anonymizes this data before it shows it: serial numbers, installation, gateway and
   device IDs, your address and similar details are replaced with placeholders such as
   `anonymized-serial-1`. The same value always gets the same placeholder, so the data stays
   useful. Still, it is best to send it privately, for example in a private message on the forum,
   rather than post it publicly.
3. **Where to ask:** the
   [Homey Community Forum topic](https://community.homey.app/t/app-pro-viessmann-vicare-app-for-homey-pro/118749)
   or [GitHub issues](https://github.com/pelleros/se.forint.pelle.viessmann/issues).

Want to fix something yourself? See [CONTRIBUTING.md](../CONTRIBUTING.md) for the ground rules and
[ARCHITECTURE.md](ARCHITECTURE.md) for how the app works.

## Viessmann API limits

On the free plan, Viessmann allows about **1,450 API calls per day** per ViCare user. When the
limit is reached, Viessmann refuses further calls for a while and the app shows errors such as
"Viessmann HTTP 429: API rate limit exceeded". When Viessmann says how long to wait, the app waits
that long before it tries again.

The app spreads its requests so that it stays well below that limit. It fetches data about once
every 2 minutes in total: with one device, that device is updated every 2 minutes; with two
devices, each is updated every 4 minutes, and so on. That is roughly 720 calls per day, plus a few
more for commands from flows, adding devices and the troubleshooting tools.

Because the limit is per user, other systems that use the Viessmann API with your ViCare account
(for example Home Assistant, ioBroker or your own scripts) share it with Homey, even if each has its
own client. If you hit the limit, make those systems poll less often.

## Viessmann outages and maintenance

The Viessmann API is a cloud service, and it sometimes has outages or planned maintenance. During
that time, devices can show as unavailable, values stop updating and commands from flows fail,
often with errors such as "Viessmann HTTP 503: Service Unavailable". This is not something the app or your
Homey can fix.

If the ViCare app has problems at the same time, it is almost certainly on Viessmann's side. Wait
and the app will recover by itself on the next successful update. Only if the device stays
unavailable after Viessmann works again, use **Repair** as described above.
