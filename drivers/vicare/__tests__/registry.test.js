/* eslint-env jest */

'use strict';

// Guards against breaking changes for existing users. See the comment in registry.json.
// Capabilities come from config.js. Flow cards come from driver.flow.compose.json, which is
// what Homey ships; flowCards.js holds their runtime mapping.

const fs = require('fs');
const path = require('path');
const registry = require('./registry.json');
const flowCompose = require('../driver.flow.compose.json');
const driverCompose = require('../driver.compose.json');
const { FEATURES } = require('../config');
const { FLOW_CONDITIONS, FLOW_ACTIONS, FLOW_TRIGGERS } = require('../flowCards');

const REGISTRY_FILE = 'drivers/vicare/__tests__/registry.json';
const FLOW_COMPOSE_FILE = 'drivers/vicare/driver.flow.compose.json';
const DRIVER_COMPOSE_FILE = 'drivers/vicare/driver.compose.json';
const CUSTOM_CAPABILITIES_DIR = path.join(__dirname, '../../../.homeycompose/capabilities');

// Homey system capabilities this app builds sub-capabilities on
// (https://apps-sdk-v3.developer.homey.app/tutorial-device-capabilities.html).
const HOMEY_SYSTEM_CAPABILITIES = ['measure_temperature', 'target_temperature', 'thermostat_mode'];

// Runtime mapping in flowCards.js per card group of the compose file
const RUNTIME_FLOW_CARDS = {
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

// Device settings as { id: type }, including settings inside groups
const collectSettings = (settings = []) => settings.flatMap((setting) => (setting.type === 'group'
  ? collectSettings(setting.children)
  : [[setting.id, setting.type]]));
const shippedSettings = Object.fromEntries(collectSettings(driverCompose.settings));

const shippedFlowCards = Object.fromEntries(Object.keys(RUNTIME_FLOW_CARDS)
  .map((group) => [group, Object.fromEntries((flowCompose[group] || [])
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
      findMissingFlowCardParts(registry.flowCards, shippedFlowCards, { compareTypes: true }),
      `Breaking change: ${FLOW_COMPOSE_FILE} no longer provides these registered flow card parts. Saved `
      + 'Flows of existing users would break. Restore them (to replace a card, add a new one and mark the '
      + 'old one deprecated instead of removing it):',
    );
  });

  test('every flow card, argument, dropdown value and token in the compose file is registered', () => {
    expectNone(
      findMissingFlowCardParts(shippedFlowCards, registry.flowCards),
      `New flow card parts in ${FLOW_COMPOSE_FILE}: add them to "flowCards" in ${REGISTRY_FILE}:`,
    );
  });

  test('every flow card in the compose file has a runtime mapping in flowCards.js and vice versa', () => {
    const unmapped = [];
    const undefinedInCompose = [];
    for (const [group, runtimeCards] of Object.entries(RUNTIME_FLOW_CARDS)) {
      const composeIds = Object.keys(shippedFlowCards[group]);
      const runtimeIds = Object.values(runtimeCards).map((card) => card.id);
      unmapped.push(...composeIds.filter((id) => !runtimeIds.includes(id)).map((id) => `${group} card '${id}'`));
      undefinedInCompose.push(...runtimeIds.filter((id) => !composeIds.includes(id)).map((id) => `${group} card '${id}'`));
    }
    const problems = [];
    if (unmapped.length > 0) {
      problems.push(`These flow cards in ${FLOW_COMPOSE_FILE} have no runtime mapping in flowCards.js `
        + `(FLOW_CONDITIONS/FLOW_ACTIONS/FLOW_TRIGGERS), so they would do nothing: ${unmapped.join(', ')}`);
    }
    if (undefinedInCompose.length > 0) {
      problems.push(`flowCards.js maps these flow cards, but ${FLOW_COMPOSE_FILE} does not define them, so `
        + `registering them in driver.js fails: ${undefinedInCompose.join(', ')}`);
    }
    expectNone(problems, 'Flow cards in the compose file and flowCards.js do not match:');
  });
});

describe('device settings registry', () => {
  test('every registered device setting still exists with the same type', () => {
    expectNone(
      Object.entries(registry.deviceSettings)
        .filter(([id, type]) => shippedSettings[id] !== type)
        .map(([id, type]) => (shippedSettings[id] ? `'${id}' changed type from '${type}' to '${shippedSettings[id]}'` : `'${id}'`)),
      `Breaking change: ${DRIVER_COMPOSE_FILE} no longer provides these registered device settings. Existing `
      + 'users would lose the value they set. Restore them:',
    );
  });

  test('every device setting in the driver compose file is registered', () => {
    expectNone(
      Object.keys(shippedSettings).filter((id) => !(id in registry.deviceSettings)),
      `New device settings in ${DRIVER_COMPOSE_FILE}: add them to "deviceSettings" in ${REGISTRY_FILE}:`,
    );
  });
});
