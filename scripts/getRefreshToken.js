/*
 * One-time helper to mint a Viessmann refresh token from a browser login.
 *
 * Why this exists: the Viessmann API uses OAuth2 + PKCE only (no password
 * grant). To run scripts/testConnection.js we need a refresh_token; this
 * script walks through the one-time browser flow to get one.
 *
 * Flow:
 *   1. Reads VIESSMANN_CLIENT_ID from .env (must already be set).
 *   2. Prints an authorization URL. You open it in a browser, log in with
 *      your Viessmann account, and approve.
 *   3. Browser redirects to the registered redirect URI
 *      (https://callback.athom.com/oauth2/callback) with ?code=... in the
 *      URL. Copy that `code` value from the URL bar.
 *   4. Paste the code back into this script when prompted.
 *   5. Script exchanges code for access + refresh tokens, writes
 *      VIESSMANN_REFRESH_TOKEN into .env, and exits.
 *
 * Reuses the same CODE_VERIFIER / code_challenge constants as the Homey
 * app (lib/ViessmannOAuth2Client.js), so PKCE matches.
 *
 * Run from the viessmann/ directory:   node scripts/getRefreshToken.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const querystring = require('querystring');

const AUTHORIZATION_URL = 'https://iam.viessmann-climatesolutions.com/idp/v3/authorize';
const TOKEN_URL = 'https://iam.viessmann-climatesolutions.com/idp/v3/token';
const REDIRECT_URI = 'https://callback.athom.com/oauth2/callback';
const SCOPES = ['IoT', 'User', 'offline_access'];

// Lifted verbatim from lib/ViessmannOAuth2Client.js so the PKCE pair matches.
const CODE_VERIFIER = '6PygdmeK8JKPuuftlkc6q4ceyvjhMM_a_cJrPbcmcLc-SPjx2ZXTYr-SOofPUBydQ3McNYRy7Hibc2L2WtVLJFpOQ~Qbgic455ArKjUz9_UiTLnO6q8A3e.I_fIF8hAo';
const CODE_CHALLENGE = '5M5nhkBfkWZCGfLZYcTL-l7esjPUN7PpZ4rq8k4cmys';

const ENV_PATH = path.join(__dirname, '..', '.env');

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) {
    console.error(`[FAIL] .env not found at ${ENV_PATH}`);
    console.error('       Copy .env.example to .env and put your VIESSMANN_CLIENT_ID in it first.');
    process.exit(1);
  }
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
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

function writeRefreshTokenToEnv(refreshToken) {
  const original = fs.readFileSync(ENV_PATH, 'utf8');
  const lines = original.split(/\r?\n/);
  let found = false;
  const updated = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed.includes('=')) return line;
    const key = trimmed.slice(0, trimmed.indexOf('=')).trim();
    if (key === 'VIESSMANN_REFRESH_TOKEN') {
      found = true;
      return `VIESSMANN_REFRESH_TOKEN=${refreshToken}`;
    }
    return line;
  });
  if (!found) {
    if (updated.length > 0 && updated[updated.length - 1] !== '') updated.push('');
    updated.push(`VIESSMANN_REFRESH_TOKEN=${refreshToken}`);
  }
  fs.writeFileSync(ENV_PATH, updated.join('\n'));
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function extractCode(input) {
  // Accept either a bare code or the whole redirect URL pasted in.
  if (input.includes('code=')) {
    try {
      const url = new URL(input);
      const code = url.searchParams.get('code');
      if (code) return code;
    } catch {
      // not a URL — fall through to regex
    }
    const m = input.match(/[?&]code=([^&\s]+)/);
    if (m) return decodeURIComponent(m[1]);
  }
  return input;
}

async function main() {
  loadEnv();
  const clientId = process.env.VIESSMANN_CLIENT_ID;
  if (!clientId) {
    console.error('[FAIL] VIESSMANN_CLIENT_ID is not set in .env');
    process.exit(1);
  }

  const state = Math.random().toString(36).slice(2);
  const authUrl = `${AUTHORIZATION_URL}?${querystring.stringify({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(' '),
    state,
    code_challenge_method: 'S256',
    code_challenge: CODE_CHALLENGE,
  })}`;

  console.log('\n=== Step 1: open this URL in a browser and log in ===\n');
  console.log(authUrl);
  console.log('\nAfter you log in and approve, the browser will redirect to:');
  console.log(`  ${REDIRECT_URI}?code=<long string>&state=${state}`);
  console.log('(The Athom page may look blank or show a generic message — that is fine.)');
  console.log('\n=== Step 2: copy the `code` value from the URL bar ===');
  console.log('You can paste either just the code, or the entire redirected URL.\n');

  const raw = await prompt('Paste here: ');
  const code = extractCode(raw);
  if (!code) {
    console.error('[FAIL] No code provided.');
    process.exit(1);
  }

  console.log('\n[*] Exchanging code for tokens...');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: querystring.stringify({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: CODE_VERIFIER,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[FAIL] Token exchange failed (${res.status}):`);
    console.error(JSON.stringify(body, null, 2));
    process.exit(1);
  }
  if (!body.refresh_token) {
    console.error('[FAIL] No refresh_token in response:');
    console.error(JSON.stringify(body, null, 2));
    process.exit(1);
  }

  writeRefreshTokenToEnv(body.refresh_token);
  console.log('[OK] refresh_token written to .env');
  console.log(`     access_token expires in ${body.expires_in}s (you don\'t need to save this)`);
  console.log('\nYou can now run:  node scripts/testConnection.js');
}

main().catch((err) => {
  console.error('\n[FAIL]', err.message);
  process.exit(1);
});
