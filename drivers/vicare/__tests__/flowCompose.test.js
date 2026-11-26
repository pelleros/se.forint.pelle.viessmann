/* eslint-env jest */

'use strict';

// driver.flow.compose.json is edited by hand (there is no generator). These checks replace the
// old "generated file is up to date" check: every card is complete, its texts are in app
// languages only, its formatted title uses its arguments, and its $filter offers it only on
// devices that have the capability the card works on (see flowCards.js).

const fs = require('fs');
const path = require('path');
const flowCompose = require('../driver.flow.compose.json');
const { FEATURES, DERIVED } = require('../config');
const { FLOW_CONDITIONS, FLOW_ACTIONS, FLOW_TRIGGERS } = require('../flowCards');

const LANGUAGES = fs.readdirSync(path.join(__dirname, '../../../locales'))
  .filter((file) => file.endsWith('.json'))
  .map((file) => path.basename(file, '.json'));
const RUNTIME = { conditions: FLOW_CONDITIONS, actions: FLOW_ACTIONS, triggers: FLOW_TRIGGERS };
const producedCapabilities = new Set([...Object.values(FEATURES)
  .flatMap((feature) => feature.capabilities.map((capability) => capability.capabilityName)),
...DERIVED.map((capability) => capability.capabilityName)]);

const cards = Object.entries(RUNTIME).flatMap(([group]) => (flowCompose[group] || [])
  .map((card) => [`${group}/${card.id}`, group, card]));

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

test('the compose file has only conditions, actions and triggers', () => {
  expect(Object.keys(flowCompose).sort()).toEqual(['actions', 'conditions', 'triggers']);
  expect(cards.length).toBeGreaterThan(0);
});

describe.each(cards)('%s', (name, group, card) => {
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
    const mapping = Object.values(RUNTIME[group]).find((runtime) => runtime.id === card.id);
    expect(mapping).toBeDefined();
    expect(card.$filter).toBe(`capabilities=${mapping.capability}`);
    expect(producedCapabilities.has(mapping.capability)).toBe(true);
  });

  test('dropdown values have unique ids', () => {
    for (const arg of card.args || []) {
      if (!arg.values) continue;
      const ids = arg.values.map((value) => value.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
