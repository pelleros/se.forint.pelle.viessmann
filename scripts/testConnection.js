/*
 * Standalone connectivity test for the Viessmann ViCare API.
 *
 *   1. Reads VIESSMANN_CLIENT_ID + VIESSMANN_REFRESH_TOKEN from .env
 *   2. Exchanges the refresh token for an access token
 *   3. GET /equipment/installations?includeGateways=true
 *   4. Picks the first installation -> first gateway -> first device
 *   5. Fetches /features TWICE (unfiltered + filtered with the driver's
 *      exact filter string) and diffs them.
 *   6. Dumps the new primary source feature
 *      (heating.power.consumption.summary.heating) plus every feature
 *      whose name matches /consumption|power|energy/i so the right
 *      counter can be confirmed.
 *   7. SIMULATION: runs the exact same delta math as device.js (the new
 *      summary.* accumulator) against live API data. State persists in
 *      scripts/.testConnection.state.json between runs so calling the
 *      script twice in a row simulates two consecutive driver polls.
 *      Optional env: VIESSMANN_LIFETIME_SEED to seed lifetimeKwh on the
 *      first run (e.g. 94300 to start from the user's current Homey value).
 *
 * Run from the viessmann/ directory:   node scripts/testConnection.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const querystring = require('querystring');

const { PATHS } = require('../drivers/vicare/config');

const API_URL = 'https://api.viessmann-climatesolutions.com/iot/v2';
const TOKEN_URL = 'https://iam.viessmann-climatesolutions.com/idp/v3/token';

// The driver's primary energy source feature (since 1.0.16).
const POWER_FEATURE = PATHS.POWER_CONSUMPTION_SUMMARY_HEATING;
const DRIVER_FILTER = Object.values(PATHS).join(',');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.error(`[FAIL] .env not found at ${envPath}`);
    console.error('       Copy .env.example to .env and fill in your credentials.');
    process.exit(1);
  }
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function refreshAccessToken(clientId, refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: querystring.stringify({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Token refresh failed (${res.status}): ${JSON.stringify(body)}`);
  }
  if (!body.access_token) {
    throw new Error(`Token refresh returned no access_token: ${JSON.stringify(body)}`);
  }
  return body.access_token;
}

async function apiGet(accessToken, pathAndQuery) {
  const res = await fetch(`${API_URL}${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`GET ${pathAndQuery} failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

async function homeyGetDevice() {
  const baseUrl = process.env.HOMEY_LOCAL_URL;
  const token = process.env.HOMEY_TOKEN;
  const deviceId = process.env.HOMEY_DEVICE_ID;
  if (!baseUrl || !token || !deviceId) return null;
  try {
    const res = await fetch(`${baseUrl}/api/manager/devices/device/${deviceId}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      return { error: `HTTP ${res.status}` };
    }
    const body = await res.json();
    const caps = body.capabilitiesObj || {};
    return {
      meter_power: caps.meter_power ? caps.meter_power.value : null,
      meter_power_at: caps.meter_power ? new Date(caps.meter_power.lastUpdated).toISOString() : null,
      measure_power: caps.measure_power ? caps.measure_power.value : null,
      measure_power_at: caps.measure_power ? new Date(caps.measure_power.lastUpdated).toISOString() : null,
    };
  } catch (err) {
    return { error: err.message };
  }
}

async function main() {
  loadEnv();

  const clientId = process.env.VIESSMANN_CLIENT_ID;
  const refreshToken = process.env.VIESSMANN_REFRESH_TOKEN;
  if (!clientId || !refreshToken) {
    console.error('[FAIL] VIESSMANN_CLIENT_ID and VIESSMANN_REFRESH_TOKEN must be set in .env');
    process.exit(1);
  }

  console.log('[1/5] Refreshing access token...');
  const accessToken = await refreshAccessToken(clientId, refreshToken);
  console.log(`      OK (token length ${accessToken.length})`);

  console.log('[2/5] GET /equipment/installations?includeGateways=true');
  const installations = await apiGet(accessToken, '/equipment/installations?includeGateways=true');
  const list = installations.data || [];
  console.log(`      OK (${list.length} installation${list.length === 1 ? '' : 's'})`);
  if (list.length === 0) {
    console.error('[FAIL] No installations returned for this account.');
    process.exit(1);
  }

  const installation = list[0];
  const installationId = installation.id;
  const gateways = installation.gateways || [];
  if (gateways.length === 0) {
    console.error(`[FAIL] Installation ${installationId} has no gateways.`);
    process.exit(1);
  }
  const gateway = gateways[0];
  const gatewaySerial = gateway.serial;
  console.log(`      installationId=${installationId}  gatewaySerial=${gatewaySerial}`);

  console.log('[3/5] GET devices');
  const devicesResp = await apiGet(
    accessToken,
    `/equipment/installations/${installationId}/gateways/${gatewaySerial}/devices`,
  );
  const devices = devicesResp.data || [];
  console.log(`      OK (${devices.length} device${devices.length === 1 ? '' : 's'})`);
  for (const d of devices) {
    console.log(`        - deviceId=${d.id}  type=${d.deviceType || 'n/a'}  model=${d.modelId || 'n/a'}  roles=${(d.roles || []).join('|') || 'n/a'}`);
  }
  // Match the driver's logic (drivers/vicare/driver.js:211): only deviceType === 'heating'
  const heatingDevices = devices.filter((d) => d.deviceType === 'heating');
  if (heatingDevices.length === 0) {
    console.error('[FAIL] No devices with deviceType === "heating" — the Homey driver would skip all of these.');
    process.exit(1);
  }
  const device = heatingDevices[0];
  const deviceId = device.id;
  console.log(`      picked first heating device: deviceId=${deviceId}  model=${device.modelId || 'n/a'}`);

  const basePath = `/features/installations/${installationId}/gateways/${gatewaySerial}/devices/${deviceId}/features`;

  console.log('[4/5] GET /features UNFILTERED (skipDisabled=true)');
  const unfilteredResp = await apiGet(accessToken, `${basePath}?skipDisabled=true`);
  const unfilteredFeatures = unfilteredResp.data || [];
  const unfilteredNames = new Set(unfilteredFeatures.map((f) => f.feature));
  console.log(`      OK (${unfilteredFeatures.length} features)`);

  console.log('[5/5] GET /features FILTERED (the driver\'s exact filter string)');
  console.log(`      filter = ${DRIVER_FILTER.slice(0, 80)}${DRIVER_FILTER.length > 80 ? '...' : ''}`);
  console.log(`      filter length = ${DRIVER_FILTER.length} chars`);
  const filteredResp = await apiGet(
    accessToken,
    `${basePath}?filter=${encodeURIComponent(DRIVER_FILTER)}&skipDisabled=true`,
  );
  const filteredFeatures = filteredResp.data || [];
  const filteredNames = new Set(filteredFeatures.map((f) => f.feature));
  console.log(`      OK (${filteredFeatures.length} features)`);

  console.log('\n=== DIFF: PATHS members vs filtered/unfiltered responses ===');
  const pathValues = Object.entries(PATHS);
  console.log(`PATH KEY                              | unfiltered | filtered`);
  console.log(`--------------------------------------+------------+---------`);
  for (const [key, value] of pathValues) {
    const inUnfiltered = unfilteredNames.has(value) ? 'YES' : ' . ';
    const inFiltered = filteredNames.has(value) ? 'YES' : ' . ';
    console.log(`${key.padEnd(38)}|    ${inUnfiltered}     |   ${inFiltered}`);
  }

  const missingInFiltered = [...unfilteredNames].filter(
    (n) => Object.values(PATHS).includes(n) && !filteredNames.has(n),
  );
  if (missingInFiltered.length > 0) {
    console.log('\n[!] Features present unfiltered but DROPPED by the driver\'s filter:');
    for (const n of missingInFiltered) console.log(`    - ${n}`);
  } else {
    console.log('\n[OK] No PATHS features were dropped by the filter.');
  }

  console.log(`\n=== ${POWER_FEATURE} raw shape ===`);
  const powerInUnfiltered = unfilteredFeatures.find((f) => f.feature === POWER_FEATURE);
  const powerInFiltered = filteredFeatures.find((f) => f.feature === POWER_FEATURE);
  if (!powerInUnfiltered) {
    console.log(`[!] ${POWER_FEATURE} is NOT present even in the unfiltered response.`);
    console.log('    -> Either disabled by skipDisabled=true, or this device does not expose it.');
  } else {
    console.log(`Unfiltered: present. timestamp=${powerInUnfiltered.timestamp}`);
    console.log(`Filtered:   ${powerInFiltered ? 'present' : 'MISSING (filter drops it)'}`);
    console.log('FULL properties =');
    console.log(JSON.stringify(powerInUnfiltered.properties, null, 2));
  }

  // Dump every feature whose name suggests power/energy/consumption so we can
  // find the counter that matches what the Viessmann mobile app displays.
  console.log('\n=== All features matching /consumption|power/ ===');
  const consumptionLike = unfilteredFeatures.filter(
    (f) => /consumption|power|energy/i.test(f.feature),
  );
  console.log(`(${consumptionLike.length} features)\n`);
  for (const f of consumptionLike) {
    console.log(`---- ${f.feature}  (ts=${f.timestamp || 'n/a'}) ----`);
    const props = f.properties || {};
    for (const [propName, propValue] of Object.entries(props)) {
      const v = propValue && typeof propValue === 'object' ? propValue.value : propValue;
      const unit = propValue && propValue.unit ? ` ${propValue.unit}` : '';
      if (Array.isArray(v)) {
        const preview = v.slice(0, 4).map((x) => (typeof x === 'number' ? x.toFixed(2) : String(x))).join(', ');
        const tail = v.length > 4 ? `, ... (${v.length} total)` : '';
        console.log(`  ${propName}: [${preview}${tail}]${unit}`);
      } else if (v !== undefined && v !== null && typeof v !== 'object') {
        console.log(`  ${propName}: ${v}${unit}`);
      } else if (v !== undefined && v !== null) {
        console.log(`  ${propName}: ${JSON.stringify(v)}${unit}`);
      }
    }
  }

  // ----------------------------------------------------------------------
  // Simulation: mirror the exact delta math from device.js so we can verify
  // what meter_power / measure_power WOULD be set to on the live device.
  // State persists in scripts/.testConnection.state.json across runs, so
  // running this script multiple times simulates multiple driver polls.
  // ----------------------------------------------------------------------
  console.log('\n=== SIMULATION: driver delta math against live API data ===');
  const summaryPaths = [
    PATHS.POWER_CONSUMPTION_SUMMARY_HEATING,
    PATHS.POWER_CONSUMPTION_SUMMARY_DHW,
    PATHS.POWER_CONSUMPTION_SUMMARY_COOLING,
  ];
  const summaryCurrentDay = {};
  let latestSummaryTimestampMs = null;
  for (const featurePath of summaryPaths) {
    const f = unfilteredFeatures.find((x) => x.feature === featurePath);
    if (!f) {
      console.log(`  [skip] ${featurePath} not present in API response`);
      continue;
    }
    const v = f.properties && f.properties.currentDay && f.properties.currentDay.value;
    const tsMs = f.timestamp ? Date.parse(f.timestamp) : NaN;
    if (typeof v === 'number') summaryCurrentDay[featurePath] = v;
    if (Number.isFinite(tsMs) && (latestSummaryTimestampMs === null || tsMs > latestSummaryTimestampMs)) {
      latestSummaryTimestampMs = tsMs;
    }
    console.log(`  ${featurePath.split('.').pop().padEnd(8)} currentDay=${v}  ts=${f.timestamp || 'n/a'}`);
  }

  const summaryKeys = Object.keys(summaryCurrentDay);
  if (summaryKeys.length === 0 || latestSummaryTimestampMs === null) {
    console.log('\n[!] No summary.* features with currentDay returned — driver would not update meter_power.');
  } else {
    const todayKwh = Object.values(summaryCurrentDay).reduce((sum, v) => sum + v, 0);
    const apiTimestampMs = latestSummaryTimestampMs;

    const statePath = path.join(__dirname, '.testConnection.state.json');
    const seedFromEnv = process.env.VIESSMANN_LIFETIME_SEED
      ? Number(process.env.VIESSMANN_LIFETIME_SEED) : undefined;
    let prior;
    if (fs.existsSync(statePath)) {
      prior = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } else if (Number.isFinite(seedFromEnv)) {
      prior = { lifetimeKwh: seedFromEnv };
    } else {
      // Auto-seed from the live Homey value if HOMEY_* env vars are set.
      // Falls back to 0 if not available.
      const homeyForSeed = await homeyGetDevice();
      if (homeyForSeed && typeof homeyForSeed.meter_power === 'number') {
        // Subtract today's running sum so the upcoming first-reading-seeded
        // delta produces a lifetimeKwh that matches what Homey already has.
        prior = { lifetimeKwh: homeyForSeed.meter_power - todayKwh };
        console.log(`  [auto-seed]  prior lifetimeKwh = ${prior.lifetimeKwh} (Homey actual ${homeyForSeed.meter_power} - todayKwh ${todayKwh})`);
      } else {
        prior = { lifetimeKwh: 0 };
      }
    }

    const lastDayKwh = prior.lastDayKwh;
    const lastApiTimestamp = prior.lastApiTimestamp;
    const lifetimeBase = typeof prior.lifetimeKwh === 'number' ? prior.lifetimeKwh : 0;

    let deltaKwh;
    let deltaReason;
    if (typeof lastDayKwh !== 'number') {
      deltaKwh = todayKwh;
      deltaReason = 'first reading (seeded)';
    } else if (todayKwh >= lastDayKwh) {
      deltaKwh = todayKwh - lastDayKwh;
      deltaReason = 'today >= last';
    } else {
      deltaKwh = todayKwh;
      deltaReason = 'midnight reset';
    }

    const lifetimeKwh = lifetimeBase + deltaKwh;
    const apiAdvanced = typeof lastApiTimestamp === 'number' && apiTimestampMs > lastApiTimestamp;
    const deltaHours = typeof lastApiTimestamp === 'number'
      ? (apiTimestampMs - lastApiTimestamp) / 3600000
      : null;

    console.log(`\n  prior state from ${fs.existsSync(statePath) ? statePath : 'env/defaults'}:`);
    console.log(`    lifetimeKwh        = ${lifetimeBase}`);
    console.log(`    lastDayKwh         = ${lastDayKwh}`);
    console.log(`    lastApiTimestamp   = ${lastApiTimestamp ? new Date(lastApiTimestamp).toISOString() : 'undefined'}`);
    console.log(`\n  inputs from live API:`);
    console.log(`    todayKwh           = ${todayKwh}  (${Object.entries(summaryCurrentDay).map(([k, v]) => `${k.split('.').pop()}=${v}`).join(' + ')})`);
    console.log(`    apiTimestamp       = ${new Date(apiTimestampMs).toISOString()}`);
    console.log(`\n  driver would set:`);
    console.log(`    deltaKwh           = ${deltaKwh}  (${deltaReason})`);
    console.log(`    meter_power        = ${lifetimeKwh.toFixed(3)} kWh   (lifetimeBase ${lifetimeBase} + deltaKwh ${deltaKwh})`);
    // Live compressor-based measure_power estimate (matches device.js logic
    // when the user has maxCompressorW > 0 — defaults to 3500). Falls back
    // to the kWh-delta path when compressor data isn't present.
    const MAX_STALE_POWER_MS = 15 * 60 * 1000;
    const MAX_COMPRESSOR_RPS = 120;
    const cf = unfilteredFeatures.find((x) => x.feature === PATHS.COMPRESSOR);
    const csf = unfilteredFeatures.find((x) => x.feature === PATHS.COMPRESSOR_SPEED);
    const ff = unfilteredFeatures.find((x) => x.feature === PATHS.PRIMARY_FAN_MODULATION);
    const compressorActive = cf && cf.properties && cf.properties.active ? cf.properties.active.value : null;
    const compressorSpeedRps = csf && csf.properties && csf.properties.value ? csf.properties.value.value : null;
    const fanModulationPct = ff && ff.properties && ff.properties.value ? ff.properties.value.value : null;
    const maxCompressorW = Number(process.env.VIESSMANN_MAX_COMPRESSOR_W);
    const baselineW = Number(process.env.VIESSMANN_BASELINE_W) || 150;
    const maxCompressorWEffective = Number.isFinite(maxCompressorW) ? maxCompressorW : 3500;

    if (maxCompressorWEffective > 0 && typeof compressorActive === 'boolean') {
      let watts;
      if (compressorActive) {
        const speedRatio = Math.min(1, Math.max(0, (compressorSpeedRps || 0) / MAX_COMPRESSOR_RPS));
        watts = baselineW + speedRatio * maxCompressorWEffective;
      } else {
        watts = baselineW;
      }
      console.log(`    measure_power      = ${Math.round(watts)} W   (live: compressor=${compressorActive} speed=${compressorSpeedRps}rps fan=${fanModulationPct}% baselineW=${baselineW} maxCompressorW=${maxCompressorWEffective})`);
    } else if (apiAdvanced && deltaHours > 0) {
      const watts = Math.max(0, (deltaKwh / deltaHours) * 1000);
      console.log(`    measure_power      = ${Math.round(watts)} W   (kWh-delta: ${deltaKwh} / ${deltaHours.toFixed(3)}h * 1000)`);
    } else if (typeof lastApiTimestamp !== 'number') {
      console.log('    measure_power      = unchanged  (first reading)');
    } else {
      const staleMs = Date.now() - lastApiTimestamp;
      if (staleMs > MAX_STALE_POWER_MS) {
        console.log(`    measure_power      = 0 W   (API timestamp stale for ${Math.round(staleMs / 60000)} min — assuming idle)`);
      } else {
        console.log(`    measure_power      = unchanged  (API timestamp has not advanced)`);
      }
    }

    const newState = {
      lifetimeKwh,
      lastDayKwh: todayKwh,
      lastApiTimestamp: apiAdvanced || typeof lastApiTimestamp !== 'number' ? apiTimestampMs : lastApiTimestamp,
    };
    fs.writeFileSync(statePath, `${JSON.stringify(newState, null, 2)}\n`);
    console.log(`\n  state persisted to ${path.relative(process.cwd(), statePath)} — run again to simulate the next poll.`);

    // Cross-check against the live Homey device, if HOMEY_* env vars are set.
    const homey = await homeyGetDevice();
    if (homey === null) {
      console.log('\n  [no comparison]  HOMEY_LOCAL_URL / HOMEY_TOKEN / HOMEY_DEVICE_ID not set in .env');
    } else if (homey.error) {
      console.log(`\n  [Homey fetch failed]  ${homey.error}`);
    } else {
      const drift = typeof homey.meter_power === 'number'
        ? (lifetimeKwh - homey.meter_power).toFixed(3) : 'n/a';
      console.log('\n  Homey actual values (from local API):');
      console.log(`    meter_power        = ${homey.meter_power} kWh   (updated ${homey.meter_power_at})`);
      console.log(`    measure_power      = ${homey.measure_power} W   (updated ${homey.measure_power_at})`);
      console.log(`    drift (sim - homey) = ${drift} kWh   ${Math.abs(Number(drift)) <= 1 ? '[MATCH]' : '[CHECK]'}`);
    }
  }

  console.log('\n[DONE]');
}

main().catch((err) => {
  console.error('\n[FAIL]', err.message);
  process.exit(1);
});
