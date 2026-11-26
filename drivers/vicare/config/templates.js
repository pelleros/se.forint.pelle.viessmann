/*
 *
 *  Copyright (C) 2024 Per Rosengren
 *  This file is part of se.forint.pelle.viessmann project.
 *
 *  se.forint.pelle.viessmann project is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  se.forint.pelle.viessmann project is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with se.forint.pelle.viessmann project.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

// @ts-check

'use strict';

// Shared capability option templates and the factories the theme modules build their FEATURES
// entries with.

/** @typedef {import('./types').CapabilityConfig} CapabilityConfig */
/** @typedef {import('./types').Translated} Translated */

const CAPABILITY_TEMPLATES = Object.freeze({
  temperature: {
    units: '°C',
    decimals: 1,
    preventInsights: false,
    preventTag: false,
  },
  // Logged in Insights since 1.0.15. No Flow tag: once offered, a tag cannot be taken back
  // without breaking the Flows that use it
  counter: {
    preventInsights: false,
    preventTag: true,
  },
  thermostat: {
    units: '°C',
    preventInsights: true,
  },
  activeState: {
    preventInsights: false,
    preventTag: false,
  },
  modulation: {
    preventInsights: false,
    preventTag: true,
  },
});

// Texts of the boolean "running" capabilities in every app language. insightsTitleTrue/False
// label the state changes on the device's timeline and in Insights; titleTrue/False show the
// state on the device. The capability definitions in .homeycompose/capabilities/ carry the
// same texts (config.test.js checks that they match); the options here also reach devices that
// already have the capability, because device.js reapplies them on every start.
const YES_NO = {
  titleTrue: {
    en: 'Yes', de: 'Ja', nl: 'Ja', fr: 'Oui', sv: 'Ja',
  },
  titleFalse: {
    en: 'No', de: 'Nein', nl: 'Nee', fr: 'Non', sv: 'Nej',
  },
};

const RUNNING_STATE_TEXTS = {
  compressor: {
    ...YES_NO,
    insightsTitleTrue: {
      en: 'Compressor started', de: 'Verdichter gestartet', nl: 'Compressor gestart', fr: 'Compresseur démarré', sv: 'Kompressorn startade',
    },
    insightsTitleFalse: {
      en: 'Compressor stopped', de: 'Verdichter gestoppt', nl: 'Compressor gestopt', fr: 'Compresseur arrêté', sv: 'Kompressorn stannade',
    },
  },
  burner: {
    ...YES_NO,
    insightsTitleTrue: {
      en: 'Burner started', de: 'Brenner gestartet', nl: 'Brander gestart', fr: 'Brûleur démarré', sv: 'Brännaren startade',
    },
    insightsTitleFalse: {
      en: 'Burner stopped', de: 'Brenner gestoppt', nl: 'Brander gestopt', fr: 'Brûleur arrêté', sv: 'Brännaren stannade',
    },
  },
};

// Units of the statistics counters. Hours use the symbol, which is the same in every language;
// starts are a count
const HOURS_COUNTER = {
  units: 'h',
};
const STARTS_COUNTER = {
  units: {
    en: 'starts', de: 'Starts', nl: 'starts', fr: 'démarrages', sv: 'starter',
  },
  decimals: 0,
};

/**
 * A temperature sensor: `measure_temperature.<name>`.
 * @param {string} name
 * @param {string} title
 * @param {Record<string, any>} [options] capability options; `propertyPath` overrides `value.value`
 * @returns {CapabilityConfig}
 */
const createTemperatureCapability = (name, title, options = {}) => ({
  capabilityName: `measure_temperature.${name}`,
  propertyPath: options.propertyPath || 'value.value',
  capabilityOptions: {
    title: { en: title },
    ...CAPABILITY_TEMPLATES.temperature,
    ...options,
  },
});

/**
 * A modulation or load in percent: `measure_<name>_number.<name>Modulation`.
 * @param {string} name
 * @param {string} title
 * @param {Record<string, any>} [options]
 * @returns {CapabilityConfig}
 */
const createModulationCapability = (name, title, options = {}) => ({
  capabilityName: `measure_${name}_number.${name}Modulation`,
  propertyPath: 'value.value',
  capabilityOptions: {
    title: { en: title },
    units: '%',
    ...CAPABILITY_TEMPLATES.modulation,
    ...options,
  },
});

/**
 * A running state: `measure_<name>_active`.
 * @param {string} name
 * @param {string} title
 * @param {Record<string, any>} [options]
 * @returns {CapabilityConfig}
 */
const createActiveCapability = (name, title, options = {}) => ({
  capabilityName: `measure_${name}_active`,
  propertyPath: 'active.value',
  capabilityOptions: {
    title: { en: title },
    ...CAPABILITY_TEMPLATES.activeState,
    ...options,
  },
});

/**
 * A coefficient of performance (no unit): `measure_cop_number.<name>`.
 * @param {string} name
 * @param {string} title
 * @returns {CapabilityConfig}
 */
const createCopCapability = (name, title) => ({
  capabilityName: `measure_cop_number.${name}`,
  propertyPath: 'value.value',
  capabilityOptions: {
    title: { en: title },
    decimals: 1,
    preventInsights: false,
    preventTag: false,
  },
});

/**
 * The hours and starts counters of a compressor or burner.
 * @param {string} prefix
 * @param {string} unitName
 * @returns {CapabilityConfig[]}
 */
const createStatisticsCapabilities = (prefix, unitName) => ([
  {
    capabilityName: `measure_${prefix}_number.${prefix}Hours`,
    propertyPath: 'hours.value',
    capabilityOptions: {
      title: { en: `${unitName} runtime` },
      ...HOURS_COUNTER,
      ...CAPABILITY_TEMPLATES.counter,
    },
  },
  {
    capabilityName: `measure_${prefix}_number.${prefix}Starts`,
    propertyPath: 'starts.value',
    capabilityOptions: {
      title: { en: `${unitName} starts` },
      ...STARTS_COUNTER,
      ...CAPABILITY_TEMPLATES.counter,
    },
  },
]);

/**
 * A writable set point: `target_temperature.<name>`. Without `command`, it is written with
 * `setTargetTemperature(temperature)`.
 * @param {string} name
 * @param {string} title
 * @param {{ propertyPath?: string, command?: import('./types').CommandConfig, min?: number,
 *   max?: number, step?: number, capabilityOptions?: Record<string, any> }} [options]
 * @returns {CapabilityConfig}
 */
const createThermostatCapability = (name, title, options = {}) => ({
  capabilityName: `target_temperature.${name}`,
  propertyPath: options.propertyPath || 'value.value',
  command: options.command || {
    name: 'setTargetTemperature',
    parameterMapping: {
      value: 'temperature',
    },
  },
  capabilityOptions: {
    title: { en: title },
    ...CAPABILITY_TEMPLATES.thermostat,
    min: options.min || 10,
    max: options.max || 60,
    step: options.step || 1,
    ...options.capabilityOptions,
  },
});

/**
 * The operation hours, production hours and starts of a fuel cell.
 * @returns {CapabilityConfig[]}
 */
const createFuelCellStatisticsCapabilities = () => ([
  {
    capabilityName: 'measure_fuelcell_number.operationHours',
    propertyPath: 'operationHours.value',
    capabilityOptions: {
      title: { en: 'Fuel cell operation hours' },
      ...HOURS_COUNTER,
      ...CAPABILITY_TEMPLATES.counter,
    },
  },
  {
    capabilityName: 'measure_fuelcell_number.productionHours',
    propertyPath: 'productionHours.value',
    capabilityOptions: {
      title: { en: 'Fuel cell production hours' },
      ...HOURS_COUNTER,
      ...CAPABILITY_TEMPLATES.counter,
    },
  },
  {
    capabilityName: 'measure_fuelcell_number.productionStarts',
    propertyPath: 'productionStarts.value',
    capabilityOptions: {
      title: { en: 'Fuel cell starts' },
      ...STARTS_COUNTER,
      ...CAPABILITY_TEMPLATES.counter,
    },
  },
]);

module.exports = {
  CAPABILITY_TEMPLATES,
  RUNNING_STATE_TEXTS,
  HOURS_COUNTER,
  STARTS_COUNTER,
  createTemperatureCapability,
  createModulationCapability,
  createActiveCapability,
  createCopCapability,
  createStatisticsCapabilities,
  createThermostatCapability,
  createFuelCellStatisticsCapabilities,
};
