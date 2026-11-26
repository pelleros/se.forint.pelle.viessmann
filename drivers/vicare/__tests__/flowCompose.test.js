/* eslint-env jest */

'use strict';

// The drivers' driver.flow.compose.json files are edited by hand (there is no generator): the
// ViCare driver's, and the heating circuit's. These checks replace the old "generated file is up
// to date" check: every card is complete, its texts are in app languages only, its formatted
// title uses its arguments, and its $filter offers it only on devices of its driver that have
// the capability the card works on (see flowCards.js).

// The extra devices' profiles reach homey-oauth2app through capabilitySetup.js
// eslint-disable-next-line global-require
jest.mock('homey-oauth2app', () => require('../../../test/helpers/fakeHomeyOAuth2App'));

const fs = require('fs');
const path = require('path');
const { FEATURES, DERIVED } = require('../config');
const {
  FLOW_CONDITIONS, FLOW_ACTIONS, FLOW_TRIGGERS, EXTRA_FLOW_CARDS,
} = require('../flowCards');
const { profileOf } = require('../extraProfiles');
const { EXTRA_DRIVERS } = require('../extraPairing');

const DRIVERS_DIR = path.join(__dirname, '../..');
const LANGUAGES = fs.readdirSync(path.join(__dirname, '../../../locales'))
  .filter((file) => file.endsWith('.json'))
  .map((file) => path.basename(file, '.json'));
const GROUPS = ['conditions', 'actions', 'triggers'];

// Per driver with Flow cards: its compose file, the runtime mapping of its cards and the
// capabilities its devices can have
const DRIVERS = {
  vicare: {
    runtime: { conditions: FLOW_CONDITIONS, actions: FLOW_ACTIONS, triggers: FLOW_TRIGGERS },
    capabilities: new Set([...Object.values(FEATURES)
      .flatMap((feature) => feature.capabilities.map((capability) => capability.capabilityName)),
    ...DERIVED.map((capability) => capability.capabilityName)]),
  },
  ...Object.fromEntries(Object.entries(EXTRA_DRIVERS).map(([kind, id]) => [id, {
    runtime: EXTRA_FLOW_CARDS[kind] || {},
    capabilities: new Set(profileOf(/** @type {any} */ (kind), { roomId: '0' }).map((capability) => capability.name)),
  }])),
};
const composeOf = (driver) => {
  const file = path.join(DRIVERS_DIR, driver, 'driver.flow.compose.json');
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return fs.existsSync(file) ? require(file) : undefined;
};
const composes = Object.keys(DRIVERS).map((driver) => [driver, composeOf(driver)]).filter(([, compose]) => compose);

const cards = composes.flatMap(([driver, compose]) => GROUPS.flatMap((group) => (compose[group] || [])
  .map((card) => [`${driver} ${group}/${card.id}`, driver, group, card])));

// Every translated text of a card: titles, hints, argument titles, dropdown values, tokens
function texts(card) {
  const found = [];
  const add = (where, value) => {
    if (value !== undefined) found.push([where, value]);
  };
  add('title', card.title);
  add('titleFormatted', card.titleFormatted);
  add('hint', card.hint);
  for (const arg of card.args || []) {
    add(`argument ${arg.name}`, arg.title);
    add(`argument ${arg.name} placeholder`, arg.placeholder);
    for (const value of arg.values || []) add(`value ${value.id} of ${arg.name}`, value.title);
  }
  for (const token of card.tokens || []) {
    add(`token ${token.name}`, token.title);
    add(`token ${token.name} example`, token.example);
  }
  return found;
}

test.each(composes)('the compose file of %s has only conditions, actions and triggers', (driver, compose) => {
  expect(GROUPS).toEqual(expect.arrayContaining(Object.keys(compose)));
  expect(Object.values(compose).flat().length).toBeGreaterThan(0);
});

test('the ViCare driver and the heating circuit have Flow cards of their own', () => {
  expect(composes.map(([driver]) => driver).sort()).toEqual(['heating-circuit', 'vicare']);
});

describe.each(cards)('%s', (name, driver, group, card) => {
  const { runtime, capabilities: driverCapabilities } = DRIVERS[driver];

  test('every text is in English and only in app languages', () => {
    for (const [where, text] of texts(card)) {
      expect({ where, languages: Object.keys(text) }).toEqual({ where, languages: expect.arrayContaining(['en']) });
      for (const [language, value] of Object.entries(text)) {
        expect({ where, language, known: LANGUAGES.includes(language) }).toEqual({ where, language, known: true });
        expect(typeof value === 'string' && value.trim() !== '').toBe(true);
      }
    }
  });

  test('the formatted title uses exactly the card\'s arguments, in every language', () => {
    const argNames = (card.args || []).map((arg) => arg.name).sort();
    for (const [language, title] of Object.entries(card.titleFormatted || {})) {
      const used = [...title.matchAll(/\[\[(\w+)\]\]/g)].map((match) => match[1]).sort();
      expect({ language, used }).toEqual({ language, used: argNames });
    }
    // A card with arguments needs a formatted title to show them
    if (argNames.length > 0) expect(card.titleFormatted).toBeDefined();
  });

  test('$filter offers the card only on devices with the capability it works on', () => {
    const mapping = Object.values(runtime[group]).find((candidate) => candidate.id === card.id);
    expect(mapping).toBeDefined();
    const capabilities = mapping.anyCapability || (mapping.capability ? [mapping.capability] : []);
    if (capabilities.length === 0) {
      // The generic cards work on every device
      expect(card.$filter).toBeUndefined();
      expect(mapping.kind).toBeDefined();
      return;
    }
    expect(card.$filter).toBe(`capabilities=${capabilities.join('|')}`);
    for (const capability of capabilities) expect({ capability, produced: driverCapabilities.has(capability) }).toEqual({ capability, produced: true });
  });

  test('new cards have their texts in every app language', () => {
    const mapping = Object.values(runtime[group]).find((candidate) => candidate.id === card.id);
    // The cards of 1.0.16 and before are translated later; every card with a kind is new
    if (!mapping?.kind) return;
    for (const [where, text] of texts(card)) {
      if (where.endsWith('example') || where.endsWith('placeholder')) continue;
      expect({ where, languages: Object.keys(text).sort() }).toEqual({ where, languages: [...LANGUAGES].sort() });
    }
  });

  test('dropdown values have unique ids', () => {
    for (const arg of card.args || []) {
      if (!arg.values) continue;
      const ids = arg.values.map((value) => value.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
