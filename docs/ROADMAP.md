# Roadmap

What's planned for the Viessmann ViCare app for Homey. This is a hobby project maintained in spare time, so work happens in bursts and there are no dates. Priorities can change when Viessmann changes its API or when users ask for something else.

## Promises that don't change

- **Updates never break what already works.** Your devices, Flows, Insights history and device settings are kept; nothing is renamed or removed.
- **New sensors appear by themselves** when your installation reports them. You never need to remove and re-add a device.
- **Every release goes to the test channel first:** <https://homey.app/a/se.forint.pelle.viessmann/test/>

## Next: 1.0.15

- More reliable updates, clearer error messages instead of a generic "Error", and a clear "repair the device" message when the Viessmann login has expired.
- Support for installations that only have heating circuit 1, and a setting to choose the heating circuit.
- "Forced normal" and "forced reduced" in the operating mode Flow card.
- Clearer setup instructions in English, German, Dutch, French and Swedish.
- Planned: COP and compressor load for heat pumps, and troubleshooting data that is anonymized automatically so it is safe to share.

## Later

- Circulation pump status and more sensors, where your system reports them.
- Condition cards such as "hot water is above …".
- Choosing your system's own operating modes in Flows, including cooling where it is supported.
- A better thermostat view: the device opens on heating and works in Homey's Climate view.
- A setting for how often the app updates.
- Several heating circuits as separate Homey devices, each in its own zone.

From 1.1.0 the app will require Homey 13.5 or later. Homeys on older versions keep the app version they already have.

## Under consideration

- Energy use in Homey Energy, where the installation reports real consumption.
- Radiator valves and room sensors.
- Solar values and hot water heat pumps.
- A dashboard widget.

## How to help

- Try test versions and report what works and what doesn't, here on GitHub or in the [Homey Community thread](https://community.homey.app/t/app-pro-viessmann-vicare-app-for-homey-pro/118749).
- If your system isn't fully supported, the troubleshooting data from the app settings helps a lot. Send it privately rather than posting it publicly.
- Code contributions are welcome: see [CONTRIBUTING.md](../CONTRIBUTING.md).
