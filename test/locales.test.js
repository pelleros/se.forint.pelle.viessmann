/* eslint-env jest */

'use strict';

// Every text in locales/ exists in every app language, with the same placeholders, and no
// language has keys that English lacks.

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '../locales');
const REQUIRED_LANGUAGES = ['en', 'de', 'nl', 'fr', 'sv'];

const locales = Object.fromEntries(fs.readdirSync(LOCALES_DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => [path.basename(file, '.json'), JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), 'utf8'))]));

// 'a.b.c' → text, for every text in a locale file
function flatten(object, prefix = '') {
  return Object.entries(object).flatMap(([key, value]) => (value && typeof value === 'object'
    ? flatten(value, `${prefix}${key}.`)
    : [[`${prefix}${key}`, value]]));
}

const placeholders = (text) => [...String(text).matchAll(/__(\w+)__/g)].map((match) => match[1]).sort();
const english = Object.fromEntries(flatten(locales.en));

test('every app language has a locale file', () => {
  expect(Object.keys(locales).sort()).toEqual(expect.arrayContaining(REQUIRED_LANGUAGES));
});

describe.each(Object.keys(locales).filter((language) => language !== 'en'))('%s', (language) => {
  const texts = Object.fromEntries(flatten(locales[language]));

  test('has every key of the English file', () => {
    expect(Object.keys(english).filter((key) => !(key in texts))).toEqual([]);
  });

  test('has no key that the English file lacks', () => {
    expect(Object.keys(texts).filter((key) => !(key in english))).toEqual([]);
  });

  test('uses the same placeholders as English', () => {
    const different = Object.keys(english)
      .filter((key) => key in texts && placeholders(texts[key]).join() !== placeholders(english[key]).join());
    expect(different).toEqual([]);
  });
});

test('every text is a non-empty string', () => {
  for (const [language, locale] of Object.entries(locales)) {
    const empty = flatten(locale).filter(([, text]) => typeof text !== 'string' || text.trim() === '').map(([key]) => key);
    expect({ language, empty }).toEqual({ language, empty: [] });
  }
});
