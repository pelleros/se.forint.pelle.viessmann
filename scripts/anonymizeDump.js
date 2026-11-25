/* eslint-disable no-console */

/*
 * Anonymize raw Viessmann API dumps (a features response or an installations response)
 * so they can be committed as test fixtures.
 *
 * Usage:
 *   node scripts/anonymizeDump.js <input.json> <output.json> [<input.json> <output.json> ...]
 *
 * All input/output pairs given in one invocation share one mapping, so an installation id or
 * gateway serial gets the same fake value in a features dump and in the installations dump of
 * the same installation. Fake values are assigned in order of first appearance, so the output
 * is deterministic for a given list of inputs.
 *
 * Replaced:
 *   - installation ids: `id` of an installation, `installationId`, `/installations/<id>` in URIs
 *   - gateway serials: `gatewaySerial`, `gatewayId`, gateway `serial`, `/gateways/<serial>` in URIs
 *   - `boilerSerial`, `bmuSerial` and the value of every feature whose name ends in `.serial`
 *     (`device.serial`, `heating.boiler.serial`, `heating.controller.serial`, ...)
 *   - `materialNumber`
 *   - device ids that identify hardware (zigbee ids, ...). Generic ids that every installation
 *     has (`0`, `gateway`, `TCU`, `HEMS`, `RoomControl-1`) are kept.
 *   - `address` (every leaf), `description`, `buildingName`, `buildingEmail`, `buildingPhone`,
 *     `servicedBy`, `vin`/`materialId` uids, pagination cursors and user-defined heating circuit
 *     names (they can contain street names)
 *   - every ISO-8601 timestamp (`timestamp`, `createdAt`, `*ValueReadAt`, ...) -> FAKE_TIMESTAMP
 *   - the old API host api.viessmann.com -> api.viessmann-climatesolutions.com
 * As a safety net, every original identifier collected above is also replaced wherever else it
 * appears inside a string.
 *
 * Kept as is: feature names, properties, commands, constraints, roles, model ids, firmware
 * versions and everything else the app's logic depends on.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const OLD_HOST = 'api.viessmann.com';
const NEW_HOST = 'api.viessmann-climatesolutions.com';
const FAKE_TIMESTAMP = '2000-01-01T00:00:00.000Z';
const REDACTED = 'anonymized';

// Every fake value matches one of these patterns. test/fixtures.privacy.test.js relies on them.
const FAKE_PATTERNS = Object.freeze({
  installationId: /^900\d{3}$/, // 900001, 900002, ...
  serial: /^9999\d{12}$/, // 9999000000000001, ...
  materialNumber: /^99\d{5}$/, // 9900001, ...
  deviceId: /^(zigbee-fa4e\d{12}|device-\d{3})$/, // zigbee-fa4e000000000001, device-001
  circuitName: /^Heating circuit \d+$/,
});

// Device ids that are the same for every installation and therefore not identifying.
const GENERIC_DEVICE_ID = /^(\d{1,3}|gateway|TCU|HEMS|RoomControl-\d{1,3})$/;

// Values that the app's troubleshooting view (or an earlier manual redaction) already put in.
const PLACEHOLDERS = new Set(['***', 'XXXXX', '-1']);

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const OLD_HOST_PATTERN = /\bapi\.viessmann\.com\b/g;
const CIRCUIT_FEATURE = /^heating\.circuits\.(\d+)(\.name)?$/;

const SERIAL_KEYS = new Set(['gatewaySerial', 'gatewayId', 'boilerSerial', 'bmuSerial', 'serial']);
const REDACT_KEYS = new Set(['description', 'buildingName', 'buildingEmail', 'buildingPhone', 'servicedBy', 'uid']);

function pad(n, length) {
  return String(n).padStart(length, '0');
}

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

  constructor() {
    this._maps = {
      installationId: new Map(),
      serial: new Map(),
      materialNumber: new Map(),
      deviceId: new Map(),
    };
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

  installationId(original) {
    const fake = this._fake('installationId', original, (n) => String(900000 + n));
    if (fake === original) return original;
    return typeof original === 'number' ? Number(fake) : fake;
  }

  serial(original) {
    return this._fake('serial', original, (n) => `9999${pad(n, 12)}`);
  }

  materialNumber(original) {
    return this._fake('materialNumber', original, (n) => `99${pad(n, 5)}`);
  }

  deviceId(original) {
    if (GENERIC_DEVICE_ID.test(String(original))) return original;
    return this._fake('deviceId', original, (n) => (/^zigbee-/i.test(String(original))
      ? `zigbee-fa4e${pad(n, 12)}`
      : `device-${pad(n, 3)}`));
  }

  _fake(kind, original, makeFake) {
    if (original === null || original === undefined) return original;
    const key = String(original);
    if (key === '' || isPlaceholder(key) || FAKE_PATTERNS[kind].test(key)) return original;
    const map = this._maps[kind];
    if (!map.has(key)) {
      map.set(key, makeFake(map.size + 1));
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
    if (ISO_TIMESTAMP.test(value)) return FAKE_TIMESTAMP;
    let out = value.replace(OLD_HOST_PATTERN, NEW_HOST);
    out = out
      .replace(/\/installations\/([^/?#]+)/g, (match, id) => `/installations/${this.installationId(id)}`)
      .replace(/\/gateways\/([^/?#]+)/g, (match, serial) => `/gateways/${this.serial(serial)}`)
      .replace(/\/devices\/([^/?#]+)/g, (match, id) => `/devices/${this.deviceId(id)}`);
    const safetyNet = this._safetyNetPattern();
    return safetyNet ? out.replace(safetyNet, (match) => this._lookup(match)) : out;
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

    // Dumps copied from the troubleshooting view have `id: -1` and `serial: "***"`. Restore
    // them from the (anonymized) child objects so the fixture stays internally consistent.
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
      out.properties.name.value = `Heating circuit ${circuit[1]}`;
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

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function main(args) {
  if (args.length === 0 || args.length % 2 !== 0 || args.includes('--help') || args.includes('-h')) {
    console.error('Usage: node scripts/anonymizeDump.js <input.json> <output.json> [<input.json> <output.json> ...]');
    return 1;
  }
  const pairs = [];
  for (let i = 0; i < args.length; i += 2) {
    if (path.resolve(args[i]) === path.resolve(args[i + 1])) {
      console.error(`Refusing to overwrite the input file ${args[i]}`);
      return 1;
    }
    pairs.push({ input: args[i], output: args[i + 1] });
  }
  const results = anonymizeDumps(pairs.map(({ input }) => JSON.parse(fs.readFileSync(input, 'utf8'))));
  pairs.forEach(({ output }, i) => {
    writeJson(output, results[i]);
    console.log(`Wrote ${output}`);
  });
  return 0;
}

module.exports = {
  Anonymizer,
  anonymizeDumps,
  writeJson,
  FAKE_PATTERNS,
  FAKE_TIMESTAMP,
  GENERIC_DEVICE_ID,
  ISO_TIMESTAMP,
  NEW_HOST,
  OLD_HOST,
  REDACTED,
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
