'use strict';

/*
 * Anonymizes Viessmann API responses (a features response or an installations response).
 *
 * Used in two places, with the same rules and a different look of the replacement values:
 *   - FIXTURE_STYLE (scripts/anonymizeDump.js, scripts/generateFixtures.js): realistic fake
 *     values (`900001`, `9999000000000001`, ...) for committed test fixtures. Timestamps are
 *     normalized.
 *   - TROUBLESHOOTING_STYLE (api.js): placeholders that say what they replace
 *     (`anonymized-installation-1`, `anonymized-serial-1`, ...) for the troubleshooting data that
 *     users share. Timestamps are kept, because they help to spot stale values.
 *
 * One Anonymizer keeps one mapping: every original value gets the same replacement in every
 * dump it anonymizes, so an installation id or gateway serial matches across a features dump and
 * the installations dump. Replacements are numbered in order of first appearance, so the output
 * is deterministic for a given sequence of inputs.
 *
 * Replaced:
 *   - installation ids: `id` of an installation, `installationId`, `/installations/<id>` in URIs
 *   - gateway serials: `gatewaySerial`, `gatewayId`, gateway `serial`, `/gateways/<serial>` in URIs
 *   - `boilerSerial`, `bmuSerial` and the value of every feature whose name ends in `.serial`
 *   - `materialNumber`
 *   - device ids that identify hardware: `deviceId`, `id` of a device, `/devices/<id>` in URIs
 *     and every string that is a zigbee id. Generic ids that every installation has (`0`,
 *     `gateway`, `TCU`, `HEMS`, `RoomControl-1`) are kept.
 *   - `address` (every leaf), `description`, `buildingName`, `buildingEmail`, `buildingPhone`,
 *     `servicedBy`, `uid`, pagination cursors and user-defined heating circuit names
 *   - FIXTURE_STYLE only: every ISO-8601 timestamp -> FAKE_TIMESTAMP
 *   - the old API host api.viessmann.com -> api.viessmann-climatesolutions.com
 * As a safety net, every original identifier collected above is also replaced wherever else it
 * appears inside a string.
 *
 * Kept as is: feature names, properties, values, units, commands, constraints, roles, model ids,
 * firmware versions and everything else the app's logic depends on.
 */

const OLD_HOST = 'api.viessmann.com';
const NEW_HOST = 'api.viessmann-climatesolutions.com';
const FAKE_TIMESTAMP = '2000-01-01T00:00:00.000Z';
const REDACTED = 'anonymized';

// Every fixture fake value matches one of these patterns. test/fixtures.privacy.test.js relies on them.
const FAKE_PATTERNS = Object.freeze({
  installationId: /^900\d{3}$/, // 900001, 900002, ...
  serial: /^9999\d{12}$/, // 9999000000000001, ...
  materialNumber: /^99\d{5}$/, // 9900001, ...
  deviceId: /^(zigbee-fa4e\d{12}|device-\d{3})$/, // zigbee-fa4e000000000001, device-001
  circuitName: /^Heating circuit \d+$/,
});

// Every troubleshooting placeholder matches one of these patterns.
const PLACEHOLDER_PATTERNS = Object.freeze({
  installationId: /^anonymized-installation-\d+$/,
  serial: /^anonymized-serial-\d+$/,
  materialNumber: /^anonymized-material-\d+$/,
  deviceId: /^anonymized-(device|zigbee)-\d+$/,
  circuitName: new RegExp(`^${REDACTED}$`),
});

function pad(n, length) {
  return String(n).padStart(length, '0');
}

const FIXTURE_STYLE = Object.freeze({
  patterns: FAKE_PATTERNS,
  installationId: (n) => String(900000 + n),
  serial: (n) => `9999${pad(n, 12)}`,
  materialNumber: (n) => `99${pad(n, 5)}`,
  deviceId: (n, isZigbee) => (isZigbee ? `zigbee-fa4e${pad(n, 12)}` : `device-${pad(n, 3)}`),
  circuitName: (circuit) => `Heating circuit ${circuit}`,
  timestamp: () => FAKE_TIMESTAMP,
});

const TROUBLESHOOTING_STYLE = Object.freeze({
  patterns: PLACEHOLDER_PATTERNS,
  installationId: (n) => `anonymized-installation-${n}`,
  serial: (n) => `anonymized-serial-${n}`,
  materialNumber: (n) => `anonymized-material-${n}`,
  deviceId: (n, isZigbee) => `anonymized-${isZigbee ? 'zigbee' : 'device'}-${n}`,
  circuitName: () => REDACTED,
  timestamp: null, // keep timestamps
});

// Device ids that are the same for every installation and therefore not identifying.
const GENERIC_DEVICE_ID = /^(\d{1,3}|gateway|TCU|HEMS|RoomControl-\d{1,3})$/;
const ZIGBEE_ID = /^zigbee-[0-9a-f]+$/i;

// Values that an earlier version of the troubleshooting view (or a manual redaction) put in.
const PLACEHOLDERS = new Set(['***', 'XXXXX', '-1']);

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const OLD_HOST_PATTERN = /\bapi\.viessmann\.com\b/g;
const CIRCUIT_FEATURE = /^heating\.circuits\.(\d+)(\.name)?$/;

const SERIAL_KEYS = new Set(['gatewaySerial', 'gatewayId', 'boilerSerial', 'bmuSerial', 'serial']);
const REDACT_KEYS = new Set(['description', 'buildingName', 'buildingEmail', 'buildingPhone', 'servicedBy', 'uid']);
const KINDS = ['installationId', 'serial', 'materialNumber', 'deviceId'];

function isPlaceholder(value) {
  return PLACEHOLDERS.has(String(value));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactLeaves(node) {
  if (Array.isArray(node)) return node.map(redactLeaves);
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, redactLeaves(value)]));
  }
  if (typeof node === 'string') return node === '' ? '' : REDACTED;
  if (typeof node === 'number') return 0;
  return node;
}

class Anonymizer {

  /**
   * @param {object} [options]
   * @param {object} [options.style] FIXTURE_STYLE (default) or TROUBLESHOOTING_STYLE
   * @param {Iterable<string>} [options.reserved] replacement values that are already in use
   *   elsewhere (for example in fixtures that are kept) and must not be handed out again
   */
  constructor({ style = FIXTURE_STYLE, reserved = [] } = {}) {
    this._style = style;
    this._maps = Object.fromEntries(KINDS.map((kind) => [kind, new Map()]));
    this._counters = Object.fromEntries(KINDS.map((kind) => [kind, 0]));
    this._reserved = new Set([...reserved].map(String));
    this._safetyNet = undefined;
  }

  /**
   * Anonymize one dump. Returns a new object; the input is not modified.
   * Call it once for every related dump before using the results (or use anonymizeDumps),
   * so the safety net knows about identifiers that only appear in a later dump.
   */
  anonymize(dump) {
    return this._transform(dump, null);
  }

  /**
   * Replace every identifier this Anonymizer has seen so far wherever it appears in a free
   * text, for example a device name.
   */
  text(value) {
    if (typeof value !== 'string') return value;
    const safetyNet = this._safetyNetPattern();
    return safetyNet ? value.replace(safetyNet, (match) => this._lookup(match)) : value;
  }

  installationId(original) {
    const fake = this._fake('installationId', original);
    if (fake === original) return original;
    return typeof original === 'number' && /^\d+$/.test(fake) ? Number(fake) : fake;
  }

  serial(original) {
    return this._fake('serial', original);
  }

  materialNumber(original) {
    return this._fake('materialNumber', original);
  }

  deviceId(original) {
    if (GENERIC_DEVICE_ID.test(String(original))) return original;
    return this._fake('deviceId', original, /^zigbee-/i.test(String(original)));
  }

  _fake(kind, original, ...styleArgs) {
    if (original === null || original === undefined) return original;
    const key = String(original);
    if (key === '' || isPlaceholder(key) || this._style.patterns[kind].test(key)) return original;
    const map = this._maps[kind];
    if (!map.has(key)) {
      let fake;
      do {
        this._counters[kind] += 1;
        fake = this._style[kind](this._counters[kind], ...styleArgs);
      } while (this._reserved.has(fake));
      map.set(key, fake);
      this._safetyNet = undefined;
    }
    return map.get(key);
  }

  _lookup(original) {
    for (const map of Object.values(this._maps)) {
      if (map.has(original)) return map.get(original);
    }
    return original;
  }

  _safetyNetPattern() {
    if (this._safetyNet === undefined) {
      const originals = Object.values(this._maps)
        .flatMap((map) => [...map.keys()])
        .sort((a, b) => b.length - a.length)
        .map(escapeRegExp);
      this._safetyNet = originals.length > 0
        ? new RegExp(`(?<![A-Za-z0-9])(?:${originals.join('|')})(?![A-Za-z0-9])`, 'g')
        : null;
    }
    return this._safetyNet;
  }

  _rewriteString(value) {
    if (this._style.timestamp && ISO_TIMESTAMP.test(value)) return this._style.timestamp(value);
    if (ZIGBEE_ID.test(value)) return this.deviceId(value);
    const out = value
      .replace(OLD_HOST_PATTERN, NEW_HOST)
      .replace(/\/installations\/([^/?#]+)/g, (match, id) => `/installations/${this.installationId(id)}`)
      .replace(/\/gateways\/([^/?#]+)/g, (match, serial) => `/gateways/${this.serial(serial)}`)
      .replace(/\/devices\/([^/?#]+)/g, (match, id) => `/devices/${this.deviceId(id)}`);
    return this.text(out);
  }

  _transform(node, key) {
    if (Array.isArray(node)) return node.map((item) => this._transform(item, key));
    if (node && typeof node === 'object') return this._transformObject(node, key);
    if (typeof node === 'string') return this._rewriteString(node);
    return node;
  }

  _transformObject(node, containerKey) {
    const context = {
      containerKey,
      isInstallation: Array.isArray(node.gateways),
      isDevice: containerKey === 'devices',
    };
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = this._transformField(key, value, context);
    }

    if (typeof node.feature === 'string') this._transformFeature(node, out);

    // Dumps copied from an earlier troubleshooting view have `id: -1` and `serial: "***"`.
    // Restore them from the (anonymized) child objects so the output stays internally consistent.
    if (context.isInstallation && isPlaceholder(out.id)) {
      const ids = [...new Set(out.gateways.map((gateway) => gateway.installationId))];
      if (ids.length === 1 && !isPlaceholder(ids[0])) [out.id] = ids;
    }
    if (Array.isArray(out.devices) && isPlaceholder(out.serial)) {
      const serials = [...new Set(out.devices.map((device) => device.gatewaySerial))];
      if (serials.length === 1 && serials[0]) [out.serial] = serials;
    }
    return out;
  }

  _transformField(key, value, context) {
    if (value === null || value === undefined) return value;
    if (key === 'address') return redactLeaves(value);
    if (typeof value !== 'object') {
      if (key === 'installationId' || (key === 'id' && context.isInstallation)) return this.installationId(value);
      if (key === 'deviceId' || (key === 'id' && context.isDevice)) return this.deviceId(value);
      if (SERIAL_KEYS.has(key)) return this.serial(value);
      if (key === 'materialNumber') return this.materialNumber(value);
      if (REDACT_KEYS.has(key)) return value === '' ? '' : REDACTED;
      if (key === 'next' && context.containerKey === 'cursor') return '';
    }
    return this._transform(value, key);
  }

  _transformFeature(node, out) {
    const serialValue = node.properties?.value?.value;
    if (node.feature.endsWith('.serial') && typeof serialValue === 'string' && serialValue !== '') {
      out.properties.value.value = this.serial(serialValue);
    }

    const circuit = CIRCUIT_FEATURE.exec(node.feature);
    const circuitName = node.properties?.name?.value;
    if (circuit && typeof circuitName === 'string' && circuitName !== '') {
      out.properties.name.value = this._style.circuitName(circuit[1]);
    }
  }

}

/**
 * Anonymize related dumps with one shared mapping. Runs twice over the input: the first pass
 * collects every identifier, the second produces output with a complete safety net.
 */
function anonymizeDumps(dumps, anonymizer = new Anonymizer()) {
  dumps.forEach((dump) => anonymizer.anonymize(dump));
  return dumps.map((dump) => anonymizer.anonymize(dump));
}

module.exports = {
  Anonymizer,
  anonymizeDumps,
  FAKE_PATTERNS,
  FAKE_TIMESTAMP,
  FIXTURE_STYLE,
  GENERIC_DEVICE_ID,
  ISO_TIMESTAMP,
  NEW_HOST,
  OLD_HOST,
  PLACEHOLDER_PATTERNS,
  REDACTED,
  TROUBLESHOOTING_STYLE,
};
