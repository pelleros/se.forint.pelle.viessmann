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
 * @property {string} [enumParameter] for an enum capability: the command parameter whose
 *   `enum` constraint lists the values this device accepts; `values` is narrowed to them
 */

/**
 * The capabilities of one feature path.
 * @typedef {object} FeatureConfig
 * @property {string} [requireRole] only for devices whose (effective) roles contain it
 * @property {string} [fallbackFor] another feature path this one stands in for when it has no value
 * @property {CapabilityConfig[]} capabilities
 */

/**
 * Reads a property of a feature in the current response: undefined when the feature is not
 * reported as enabled and connected, or when the device's roles do not allow its path.
 * @typedef {(path: string, propertyPath: string) => (string | number | boolean | null | undefined)} FeatureReader
 */

/**
 * What a derived capability can know about the device: its stored features and operating
 * modes, the readings of this response so far (capability name → value) and Homey's language.
 * @typedef {object} DeviceContext
 * @property {string[]} [features]
 * @property {{ id: string }[]} [operatingModes]
 * @property {Map<string, any>} [readings]
 * @property {string} [language]
 * @property {(capabilityName: string) => any} [currentValue] the device's current value
 */

/**
 * The commands a write to a derived capability sends, in order, and the capability values to
 * show once all of them succeeded.
 * @typedef {object} DerivedWrite
 * @property {{ path: string, command: string, parameters: Record<string, any> }[]} commands
 * @property {Record<string, any>} values
 */

/**
 * A capability computed from one or more features, possibly of other theme modules. It is
 * added when one of its `sources` is stored (and allowed by that path's `requireRole`).
 * @typedef {object} DerivedCapabilityConfig
 * @property {string} capabilityName
 * @property {string[]} sources feature paths it reads; they must be in PATHS to be polled
 * @property {(read: FeatureReader, context: DeviceContext) => any} derive the value from a
 *   response: undefined when it cannot tell (the last value stays), null when unknown
 * @property {Record<string, any>} capabilityOptions
 * @property {(context: DeviceContext) => Record<string, any>} [options] options that depend
 *   on the device (e.g. enum `values`), merged over `capabilityOptions`
 * @property {(features: string[]) => boolean} [available] an extra condition on the stored
 *   features for adding the capability
 * @property {(value: any, context: DeviceContext) => DerivedWrite} [write] makes the
 *   capability writable; throws a user-facing error for a value the device cannot take
 */

/**
 * What every theme module exports.
 * @typedef {object} ConfigModule
 * @property {Record<string, string>} PATHS constant name → feature path
 * @property {Record<string, FeatureConfig>} FEATURES feature path → its capabilities
 * @property {DerivedCapabilityConfig[]} [DERIVED] capabilities computed from several features
 */

module.exports = {};
