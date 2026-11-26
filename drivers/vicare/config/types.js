// @ts-check

'use strict';

// JSDoc types of the feature configuration (no runtime code).

/**
 * Text per language, e.g. `{ en: 'Hot water', de: 'Warmwasser' }`.
 * @typedef {Record<string, string>} Translated
 */

/**
 * How a capability value is written back with `executeCommand`: a named command whose
 * parameters all get the value (`parameterMapping`: capability value key → API parameter), or
 * the value itself as the command name (`useValueAsCommand`, mapped through `valueMapping`).
 * @typedef {object} CommandConfig
 * @property {string} [name]
 * @property {Record<string, string>} [parameterMapping]
 * @property {boolean} [useValueAsCommand]
 */

/**
 * One Homey capability fed by a feature.
 * @typedef {object} CapabilityConfig
 * @property {string} capabilityName e.g. `measure_temperature.hotWater`
 * @property {string} propertyPath dot path inside the feature's `properties`, e.g. `value.value`
 * @property {CommandConfig} [command]
 * @property {Record<string, any>} [valueMapping] API value → capability value
 * @property {Record<string, any>} capabilityOptions passed to `setCapabilityOptions`
 * @property {string} [computed] the device computes the value itself from the feature (see
 *   computedValues.js and deviceMonitor.js), e.g. a unit conversion or a counter difference;
 *   `readValues` leaves such capabilities out
 */

/**
 * The capabilities of one feature path.
 * @typedef {object} FeatureConfig
 * @property {string} [requireRole] only for devices whose (effective) roles contain it
 * @property {string} [fallbackFor] another feature path this one stands in for when it has no value
 * @property {boolean} [alwaysAdd] every device gets the capabilities, also when it does not report
 *   the feature (the app feeds them from elsewhere too)
 * @property {string} [group] an optional group (see optionalGroups.js): its capabilities are added only
 *   while the device setting of the group is on
 * @property {CapabilityConfig[]} capabilities
 */

/**
 * What every theme module exports.
 * @typedef {object} ConfigModule
 * @property {Record<string, string>} PATHS constant name → feature path
 * @property {Record<string, FeatureConfig>} FEATURES feature path → its capabilities
 */

module.exports = {};
