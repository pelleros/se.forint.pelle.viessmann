// @ts-check

'use strict';

// A report for the developer, in one step: the installations of a Viessmann login and the
// features of each of its devices, anonymized like the troubleshooting data (lib/anonymize.js),
// plus a compact text summary (one line per feature) that fits in the app's log, so that Homey's
// "Send diagnostic report" carries it. Works with only a login, without an added device, so that
// users whose device cannot be added can still share what Viessmann reports. Nothing is sent
// anywhere by this module: the user decides (diagnostic report, or copy and paste).

const { Anonymizer, anonymizeDumps, TROUBLESHOOTING_STYLE } = require('./anonymize');

// Each device's features cost one API call: radio devices (radiator actuators, sensors, repeaters)
// are many and rarely help, so they are counted but not read, and at most MAX_DEVICES are read
const SKIPPED_TYPES = Object.freeze(['zigbee']);
const MAX_DEVICES = 6;
// The summary in the log stays short: values are cut, and so is the summary as a whole
const MAX_VALUE_LENGTH = 40;
const MAX_ARRAY_ITEMS = 8;
const MAX_SUMMARY_LINES = 600;
const BEGIN = '=== Viessmann ViCare report for the developer (anonymized) ===';
const END = '=== End of the Viessmann ViCare report ===';

/**
 * What a failed request says, without anything identifying (API errors carry a redacted message).
 * @param {any} error
 * @returns {{ status?: number, code?: string, reason?: string, message: string }}
 */
function describeError(error) {
  const message = error?.status && typeof error.message === 'string' ? error.message : 'Request failed';
  return {
    ...(error?.status ? { status: error.status } : {}),
    ...(error?.apiCode ? { code: String(error.apiCode) } : {}),
    ...(error?.apiReason ? { reason: String(error.apiReason) } : {}),
    message: message.slice(0, 300),
  };
}

/**
 * Collects the report with one OAuth client: the installations (one call) and the features of
 * each device (one call per device, see MAX_DEVICES).
 * @param {any} oAuth2Client
 * @param {{ appVersion?: string, anonymizer?: Anonymizer, now?: number }} [options]
 */
async function collectReport(oAuth2Client, { appVersion = '', anonymizer = new Anonymizer({ style: TROUBLESHOOTING_STYLE }), now = Date.now() } = {}) {
  const report = {
    app: appVersion,
    generatedAt: new Date(now).toISOString(),
    installations: /** @type {any} */ (null),
    devices: /** @type {any[]} */ ([]),
    skippedDevices: /** @type {string[]} */ ([]),
    error: /** @type {any} */ (undefined),
  };
  let installations;
  try {
    installations = await oAuth2Client.getInstallations();
  } catch (error) {
    report.error = describeError(error);
    return report;
  }

  const read = [];
  for (const installation of Array.isArray(installations?.data) ? installations.data : []) {
    for (const gateway of Array.isArray(installation?.gateways) ? installation.gateways : []) {
      for (const device of Array.isArray(gateway?.devices) ? gateway.devices : []) {
        const type = String(device?.deviceType || 'unknown');
        if (SKIPPED_TYPES.includes(type) || read.length >= MAX_DEVICES) {
          report.skippedDevices.push(`${type} ${device?.modelId || ''}`.trim());
          continue;
        }
        let features;
        let error;
        try {
          features = await oAuth2Client.getFeatures({ installationId: gateway.installationId, gatewaySerial: gateway.serial, deviceId: device.id });
        } catch (failure) {
          error = describeError(failure);
        }
        read.push({ device, features, error });
      }
    }
  }

  const dumps = anonymizeDumps([installations, ...read.map(({ features }) => features || { data: [] })], anonymizer);
  [report.installations] = dumps;
  report.devices = read.map(({ device, error }, index) => ({
    id: anonymizer.deviceId(String(device?.id)),
    deviceType: device?.deviceType,
    modelId: device?.modelId,
    roles: Array.isArray(device?.roles) ? device.roles : [],
    ...(error ? { error } : {}),
    features: error ? undefined : dumps[index + 1],
  }));
  return report;
}

/**
 * A property value as short text.
 * @param {any} value
 * @returns {string}
 */
function shortValue(value) {
  if (Array.isArray(value)) {
    if (value.some((item) => item && typeof item === 'object')) return `[${value.length} entries]`;
    const shown = value.slice(0, MAX_ARRAY_ITEMS).map(shortValue).join(',');
    return `[${shown}${value.length > MAX_ARRAY_ITEMS ? `,…${value.length}` : ''}]`;
  }
  if (value && typeof value === 'object') return '{…}';
  const text = String(value);
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text;
}

/**
 * One line for a feature: its properties with values and units, and its commands.
 * @param {any} feature
 * @returns {string}
 */
function featureLine(feature) {
  const properties = Object.entries(feature?.properties || {}).map(([name, property]) => {
    const unit = property?.unit ? ` ${property.unit}` : '';
    return `${name}=${shortValue(property?.value)}${unit}`;
  });
  const commands = Object.entries(feature?.commands || {}).map(([name, command]) => {
    const params = Object.keys(command?.params || {});
    return `${name}(${params.join(',')})${command?.isExecutable === false ? '!' : ''}`;
  });
  return `  ${feature?.feature}${feature?.isEnabled === false ? ' [disabled]' : ''}: ${properties.join('; ')}`
    + `${commands.length > 0 ? ` | commands: ${commands.join(', ')}` : ''}`;
}

/**
 * The compact text summary of a report, as lines (for the app's log), within MAX_SUMMARY_LINES.
 * @param {Awaited<ReturnType<typeof collectReport>>} report
 * @returns {string[]}
 */
function summarizeReport(report) {
  const lines = [`${BEGIN} app ${report.app}, ${report.generatedAt}`];
  if (report.error) lines.push(`installations: error ${JSON.stringify(report.error)}`);
  for (const installation of report.installations?.data || []) {
    lines.push(`installation ${installation.id}: ${installation.installationType || ''} ${installation.aggregatedStatus || ''}`.trim());
    for (const gateway of installation.gateways || []) {
      lines.push(`  gateway ${gateway.gatewayType || ''} ${gateway.version || ''} ${gateway.aggregatedStatus || ''}, `
        + `devices: ${(gateway.devices || []).map((device) => `${device.deviceType} ${device.modelId || ''}`.trim()).join(', ')}`);
    }
  }
  for (const device of report.devices) {
    const count = device.features?.data?.length ?? 0;
    lines.push(`device ${device.id}: ${device.deviceType} ${device.modelId || ''}, roles ${device.roles.join(' ')}, ${
      device.error ? `error ${JSON.stringify(device.error)}` : `${count} features`}`);
    for (const feature of device.features?.data || []) lines.push(featureLine(feature));
  }
  if (report.skippedDevices.length > 0) lines.push(`not read: ${report.skippedDevices.join(', ')}`);
  if (lines.length > MAX_SUMMARY_LINES - 1) {
    const cut = lines.length - (MAX_SUMMARY_LINES - 2);
    lines.splice(MAX_SUMMARY_LINES - 2, cut, `… ${cut} more lines in the copied report`);
  }
  lines.push(END);
  return lines;
}

module.exports = {
  collectReport, summarizeReport, describeError, featureLine, MAX_DEVICES, MAX_SUMMARY_LINES, BEGIN, END,
};
