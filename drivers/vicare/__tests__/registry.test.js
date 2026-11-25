/* eslint-env jest */

'use strict';

// Guards against breaking changes for existing users. See the comment in registry.json.

const fs = require('fs');
const path = require('path');
const registry = require('./registry.json');
const { FEATURES } = require('../config');
const { FLOW_CONDITIONS, FLOW_ACTIONS, FLOW_TRIGGERS } = require('../flowCards');

const REGISTRY_FILE = 'drivers/vicare/__tests__/registry.json';
const CUSTOM_CAPABILITIES_DIR = path.join(__dirname, '../../../.homeycompose/capabilities');

// Homey system capabilities this app builds sub-capabilities on
// (https://apps-sdk-v3.developer.homey.app/tutorial-device-capabilities.html).
const HOMEY_SYSTEM_CAPABILITIES = ['measure_temperature', 'target_temperature', 'thermostat_mode'];

const FLOW_CARD_GROUPS = {
  conditions: FLOW_CONDITIONS,
  actions: FLOW_ACTIONS,
  triggers: FLOW_TRIGGERS,
};

const producedCapabilities = new Set(Object.values(FEATURES)
  .flatMap((feature) => feature.capabilities.map((capability) => capability.capabilityName)));

// Same shape as registry.flowCards
const describeFlowCard = (card) => ({
  args: Object.fromEntries((card.args || []).map((arg) => [arg.name, {
    type: arg.type,
    ...(arg.values ? { values: arg.values.map((value) => value.id) } : {}),
  }])),
  tokens: Object.fromEntries((card.tokens || []).map((token) => [token.name, token.type])),
});

const producedFlowCards = Object.fromEntries(Object.entries(FLOW_CARD_GROUPS)
  .map(([group, cards]) => [group, Object.fromEntries(Object.values(cards)
    .map((card) => [card.id, describeFlowCard(card)]))]));

/**
 * Lists every flow card, argument, dropdown value and token in `source` that `target` lacks.
 * With `compareTypes`, argument and token types that differ are listed too.
 */
function findMissingFlowCardParts(source, target, { compareTypes = false } = {}) {
  const missing = [];
  for (const [group, cards] of Object.entries(source)) {
    for (const [id, card] of Object.entries(cards)) {
      const targetCard = target[group]?.[id];
      if (!targetCard) {
        missing.push(`${group} card '${id}'`);
        continue;
      }
      for (const [name, arg] of Object.entries(card.args || {})) {
        const targetArg = targetCard.args?.[name];
        if (!targetArg) {
          missing.push(`argument '${name}' of ${group} card '${id}'`);
          continue;
        }
        if (compareTypes && targetArg.type !== arg.type) {
          missing.push(`argument '${name}' of ${group} card '${id}' changed type from '${arg.type}' to '${targetArg.type}'`);
        }
        for (const value of arg.values || []) {
          if (!(targetArg.values || []).includes(value)) {
            missing.push(`dropdown value '${value}' of argument '${name}' of ${group} card '${id}'`);
          }
        }
      }
      for (const [name, type] of Object.entries(card.tokens || {})) {
        const targetType = targetCard.tokens?.[name];
        if (targetType === undefined) {
          missing.push(`token '${name}' of ${group} card '${id}'`);
        } else if (compareTypes && targetType !== type) {
          missing.push(`token '${name}' of ${group} card '${id}' changed type from '${type}' to '${targetType}'`);
        }
      }
    }
  }
  return missing;
}

function expectNone(problems, message) {
  if (problems.length > 0) {
    throw new Error(`${message}\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
  }
}

describe('capability registry', () => {
  test('every registered capability ID can still be produced by config.js', () => {
    expectNone(
      registry.capabilities.filter((id) => !producedCapabilities.has(id)),
      'Breaking change: config.js no longer produces these registered capability IDs. Existing users would '
      + 'lose their Insights history and Flows using them. Restore them, or, only if this is intended, move '
      + `them to "retiredCapabilities" in ${REGISTRY_FILE} with a note:`,
    );
  });

  test('every capability ID produced by config.js is registered', () => {
    expectNone(
      [...producedCapabilities].filter((id) => !registry.capabilities.includes(id)),
      `New capability IDs: add them to "capabilities" in ${REGISTRY_FILE} (and remove them from `
      + '"retiredCapabilities" if they are listed there):',
    );
  });

  test('retired capability IDs have a note and are not also registered as active', () => {
    const retired = Object.entries(registry.retiredCapabilities);
    expect(retired.length).toBeGreaterThan(0);
    expectNone(
      retired.filter(([, note]) => typeof note !== 'string' || note.trim() === '').map(([id]) => id),
      `Retired capabilities need a note in ${REGISTRY_FILE}:`,
    );
    expectNone(
      retired.filter(([id]) => registry.capabilities.includes(id)).map(([id]) => id),
      `Capabilities listed both as active and retired in ${REGISTRY_FILE}:`,
    );
  });

  test('every capability is based on a Homey system capability or a custom capability', () => {
    const allCapabilities = new Set([...producedCapabilities, ...registry.capabilities]);
    expectNone(
      [...allCapabilities].filter((id) => {
        const base = id.split('.')[0];
        return !HOMEY_SYSTEM_CAPABILITIES.includes(base)
          && !fs.existsSync(path.join(CUSTOM_CAPABILITIES_DIR, `${base}.json`));
      }),
      'These capabilities have no definition. Add .homeycompose/capabilities/<base>.json, or, if the base '
      + 'is a Homey system capability, add it to HOMEY_SYSTEM_CAPABILITIES in registry.test.js:',
    );
  });
});

describe('flow card registry', () => {
  test('every registered flow card, argument, dropdown value and token still exists unchanged', () => {
    expectNone(
      findMissingFlowCardParts(registry.flowCards, producedFlowCards, { compareTypes: true }),
      'Breaking change: flowCards.js no longer provides these registered flow card parts. Saved Flows of '
      + 'existing users would break. Restore them (to replace a card, add a new one and mark the old one '
      + 'deprecated instead of removing it):',
    );
  });

  test('every flow card, argument, dropdown value and token in flowCards.js is registered', () => {
    expectNone(
      findMissingFlowCardParts(producedFlowCards, registry.flowCards),
      `New flow card parts: add them to "flowCards" in ${REGISTRY_FILE}:`,
    );
  });
});
