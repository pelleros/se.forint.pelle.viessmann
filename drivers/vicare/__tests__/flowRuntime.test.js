/* eslint-env jest */

'use strict';

// flowRuntime.js: how the Flow cards answer, run and fire.

const {
  argumentValue, conditionAnswer, actionValue, triggerTokens, autocompleteChoices,
} = require('../flowRuntime');

test('an argument is the id of a dropdown or autocomplete choice, else itself', () => {
  expect(argumentValue({ id: 'dhw', name: 'Hot water' })).toBe('dhw');
  expect([argumentValue('comfort'), argumentValue(21), argumentValue(null)]).toEqual(['comfort', 21, null]);
});

test('a condition compares the value with its argument, or is the value itself', () => {
  expect(conditionAnswer({ id: 'x', capability: 'c', argument: 'state' }, 'heating', { state: 'heating' })).toBe(true);
  expect(conditionAnswer({ id: 'x', capability: 'c', argument: 'state' }, 'standby', { state: { id: 'heating' } })).toBe(false);
  expect(conditionAnswer({ id: 'x', capability: 'c' }, true, {})).toBe(true);
});

test('an action writes its first argument', () => {
  expect(actionValue({ temperature: 21 })).toBe(21);
  expect(actionValue({ mode: { id: 'standby', name: 'Standby' } })).toBe('standby');
});

test('a trigger fires for its value only, with the value as its token, and not for an unknown value', () => {
  expect(triggerTokens({ when: true }, true)).toEqual({});
  expect(triggerTokens({ when: true }, false)).toBeNull();
  expect(triggerTokens({ token: 'mode' }, 'dhw')).toEqual({ mode: 'dhw' });
  expect(triggerTokens({ token: 'program' }, null)).toBeNull();
  expect(triggerTokens({}, null)).toEqual({});
});

test('autocomplete offers the values titled in the language (else English), filtered by what was typed', () => {
  const values = [
    { id: 'dhw', title: { en: 'Hot water', sv: 'Varmvatten' } },
    { id: 'heatingCooling', title: { en: 'Heating and cooling' } },
    { id: 'turbo' },
  ];
  expect(autocompleteChoices(values, 'sv')).toEqual([
    { id: 'dhw', name: 'Varmvatten' }, { id: 'heatingCooling', name: 'Heating and cooling' }, { id: 'turbo', name: 'turbo' },
  ]);
  expect(autocompleteChoices(values, 'en', 'COOL')).toEqual([{ id: 'heatingCooling', name: 'Heating and cooling' }]);
  expect(autocompleteChoices(undefined, 'en')).toEqual([]);
});
