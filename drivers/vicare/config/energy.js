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

// Energy, efficiency and statistics: the device's own power reading, the heat it produces now,
// Viessmann's consumption figures for yesterday, coefficients of performance and the seasonal
// efficiency figures, and the starts and hours counters of the compressor, the burner, the
// heating rod and the fuel cell, with the daily figures derived from the first two.
//
// Capabilities marked `computed` get their value from computedValues.js instead of straight from
// `propertyPath` (the property they are computed from): a unit conversion, a day the figure
// belongs to, or a difference of a counter since midnight. Without a sound basis the value is
// empty (null), never estimated.

/** @typedef {import('./types').CapabilityConfig} CapabilityConfig */
/** @typedef {import('./types').Translated} Translated */

const {
  createCopCapability, createStatisticsCapabilities, createFuelCellStatisticsCapabilities, STARTS_COUNTER, HOURS_COUNTER,
  CAPABILITY_TEMPLATES,
} = require('./templates');

/** @type {import('./types').ConfigModule['PATHS']} */
const PATHS = {
  COMPRESSOR_STATS: 'heating.compressors.0.statistics',
  COP_TOTAL: 'heating.cop.total',
  COP_HEATING: 'heating.cop.heating',
  COP_DHW: 'heating.cop.dhw',
  BURNER_STATS: 'heating.burners.0.statistics',
  FUEL_CELL_STATS: 'fuelCell.statistics',
  POWER_CONSUMPTION: 'heating.power.consumption.current',
  INVERTER_POWER: 'heating.inverters.0.sensors.power.output',
  ELECTRICITY_TOTAL: 'heating.power.consumption.total',
  ELECTRICITY_HEATING: 'heating.power.consumption.heating',
  ELECTRICITY_DHW: 'heating.power.consumption.dhw',
  GAS_TOTAL: 'heating.gas.consumption.total',
  GAS_HEATING: 'heating.gas.consumption.heating',
  GAS_DHW: 'heating.gas.consumption.dhw',
  HEAT_OUTPUT: 'heating.heat.production.current',
  SCOP_TOTAL: 'heating.scop.total',
  SCOP_HEATING: 'heating.scop.heating',
  SCOP_DHW: 'heating.scop.dhw',
  SPF_TOTAL: 'heating.spf.total',
  SPF_HEATING: 'heating.spf.heating',
  SPF_DHW: 'heating.spf.dhw',
  HEATING_ROD_STATS: 'heating.heatingRod.statistics',
};

// Values that new capabilities log in Insights and offer as Flow tags
const LOGGED = { preventInsights: false, preventTag: false };
const COUNTER = CAPABILITY_TEMPLATES.counter;

/**
 * The device's electrical power in W, from its own reading (kW or W in the response).
 * @param {string} title
 * @returns {CapabilityConfig}
 */
const powerCapability = (title) => ({
  capabilityName: 'measure_power',
  propertyPath: 'value.value',
  computed: 'power',
  capabilityOptions: {
    title: {
      en: title, de: 'Leistungsaufnahme', nl: 'Opgenomen vermogen', fr: 'Puissance consommée', sv: 'Effektförbrukning',
    },
    units: 'W',
    decimals: 0,
    ...LOGGED,
  },
});

/**
 * The heat the device produces now, in W (the response gives kW). Its own capability, not
 * measure_power: Homey Energy would count measure_power as electricity the device uses.
 * @type {CapabilityConfig}
 */
const HEAT_OUTPUT = {
  capabilityName: 'measure_heat_output',
  propertyPath: 'value.value',
  computed: 'power',
  capabilityOptions: {
    title: {
      en: 'Heat output', de: 'Wärmeleistung', nl: 'Warmteafgifte', fr: 'Puissance thermique', sv: 'Värmeeffekt',
    },
    units: 'W',
    decimals: 0,
    ...LOGGED,
  },
};

// Seasonal efficiency figures, averages over a season or year that change slowly. They are not a
// coefficient of performance now, so they have their own capabilities. A part that has not run
// yet (heating on a unit that has only made hot water) reports 0, which is shown as no value.
const NOT_RUN_YET = { 0: null };

/**
 * A seasonal efficiency figure: `measure_<kind>_number.<part>`.
 * @param {'scop' | 'spf'} kind
 * @param {'total' | 'heating' | 'dhw'} part
 * @param {Translated} title
 * @returns {CapabilityConfig}
 */
const seasonalCapability = (kind, part, title) => ({
  capabilityName: `measure_${kind}_number.${part}`,
  propertyPath: 'value.value',
  valueMapping: NOT_RUN_YET,
  capabilityOptions: {
    title,
    decimals: 1,
    ...LOGGED,
  },
});

const SEASONAL_TITLES = {
  scop: {
    total: {
      en: 'Seasonal efficiency (SCOP)',
      de: 'Saisonale Leistungszahl (SCOP)',
      nl: 'Seizoensrendement (SCOP)',
      fr: 'Rendement saisonnier (SCOP)',
      sv: 'Säsongsverkningsgrad (SCOP)',
    },
    heating: {
      en: 'Seasonal efficiency heating (SCOP)',
      de: 'Saisonale Leistungszahl Heizen (SCOP)',
      nl: 'Seizoensrendement verwarming (SCOP)',
      fr: 'Rendement saisonnier chauffage (SCOP)',
      sv: 'Säsongsverkningsgrad värme (SCOP)',
    },
    dhw: {
      en: 'Seasonal efficiency hot water (SCOP)',
      de: 'Saisonale Leistungszahl Warmwasser (SCOP)',
      nl: 'Seizoensrendement warm water (SCOP)',
      fr: 'Rendement saisonnier eau chaude (SCOP)',
      sv: 'Säsongsverkningsgrad varmvatten (SCOP)',
    },
  },
  spf: {
    total: {
      en: 'Seasonal performance factor (SPF)',
      de: 'Jahresarbeitszahl (JAZ)',
      nl: 'Seizoensprestatiefactor (SPF)',
      fr: 'Facteur de performance saisonnier (SPF)',
      sv: 'Årsvärmefaktor (SPF)',
    },
    heating: {
      en: 'Seasonal performance factor heating (SPF)',
      de: 'Jahresarbeitszahl Heizen (JAZ)',
      nl: 'Seizoensprestatiefactor verwarming (SPF)',
      fr: 'Facteur de performance saisonnier chauffage (SPF)',
      sv: 'Årsvärmefaktor värme (SPF)',
    },
    dhw: {
      en: 'Seasonal performance factor hot water (SPF)',
      de: 'Jahresarbeitszahl Warmwasser (JAZ)',
      nl: 'Seizoensprestatiefactor warm water (SPF)',
      fr: 'Facteur de performance saisonnier eau chaude (SPF)',
      sv: 'Årsvärmefaktor varmvatten (SPF)',
    },
  },
};

// The heating rod's counters, like the compressor's
const HEATING_ROD_STATISTICS = [
  {
    capabilityName: 'measure_heatingrod_number.heatingRodHours',
    propertyPath: 'hours.value',
    capabilityOptions: {
      title: {
        en: 'Heating rod runtime',
        de: 'Heizstab Laufzeit',
        nl: 'Looptijd elektrisch element',
        fr: 'Durée de marche résistance électrique',
        sv: 'Elpatron drifttid',
      },
      ...HOURS_COUNTER,
      ...COUNTER,
    },
  },
  {
    capabilityName: 'measure_heatingrod_number.heatingRodStarts',
    propertyPath: 'starts.value',
    capabilityOptions: {
      title: {
        en: 'Heating rod starts',
        de: 'Heizstab Starts',
        nl: 'Starts elektrisch element',
        fr: 'Démarrages résistance électrique',
        sv: 'Elpatron starter',
      },
      ...STARTS_COUNTER,
      ...COUNTER,
    },
  },
];

/**
 * Viessmann's figure for yesterday's consumption, from the day values of a consumption feature.
 * The unit is the one the response gives (electricity in kWh; gas in m³ or kWh).
 * @param {string} capabilityName
 * @param {Translated} title
 * @param {string} units the usual unit; the response's unit replaces it on the device
 * @returns {CapabilityConfig}
 */
const yesterdayCapability = (capabilityName, title, units) => ({
  capabilityName,
  propertyPath: 'day.value',
  computed: 'consumptionYesterday',
  capabilityOptions: {
    title,
    units,
    decimals: 1,
    ...LOGGED,
  },
});

// Titles of the daily figures of a compressor or burner, per language
const DAILY_TITLES = {
  compressor: {
    startsToday: {
      en: 'Compressor starts today', de: 'Verdichterstarts heute', nl: 'Compressorstarts vandaag', fr: 'Démarrages du compresseur aujourd\'hui', sv: 'Kompressorstarter i dag',
    },
    startsYesterday: {
      en: 'Compressor starts yesterday', de: 'Verdichterstarts gestern', nl: 'Compressorstarts gisteren', fr: 'Démarrages du compresseur hier', sv: 'Kompressorstarter i går',
    },
    startsLastHour: {
      en: 'Compressor starts in the last hour',
      de: 'Verdichterstarts in der letzten Stunde',
      nl: 'Compressorstarts in het afgelopen uur',
      fr: 'Démarrages du compresseur dans la dernière heure',
      sv: 'Kompressorstarter senaste timmen',
    },
    runtimePerStartYesterday: {
      en: 'Compressor run time per start yesterday',
      de: 'Verdichterlaufzeit pro Start gestern',
      nl: 'Compressorlooptijd per start gisteren',
      fr: 'Durée de marche du compresseur par démarrage hier',
      sv: 'Kompressorns gångtid per start i går',
    },
  },
  burner: {
    startsToday: {
      en: 'Burner starts today', de: 'Brennerstarts heute', nl: 'Branderstarts vandaag', fr: 'Démarrages du brûleur aujourd\'hui', sv: 'Brännarstarter i dag',
    },
    startsYesterday: {
      en: 'Burner starts yesterday', de: 'Brennerstarts gestern', nl: 'Branderstarts gisteren', fr: 'Démarrages du brûleur hier', sv: 'Brännarstarter i går',
    },
    startsLastHour: {
      en: 'Burner starts in the last hour',
      de: 'Brennerstarts in der letzten Stunde',
      nl: 'Branderstarts in het afgelopen uur',
      fr: 'Démarrages du brûleur dans la dernière heure',
      sv: 'Brännarstarter senaste timmen',
    },
    runtimePerStartYesterday: {
      en: 'Burner run time per start yesterday',
      de: 'Brennerlaufzeit pro Start gestern',
      nl: 'Branderlooptijd per start gisteren',
      fr: 'Durée de marche du brûleur par démarrage hier',
      sv: 'Brännarens gångtid per start i går',
    },
  },
};

/**
 * Starts today, yesterday and in the last hour, and the average run time per start yesterday,
 * of a compressor or burner: differences of its starts and hours counters (`computed` names the
 * figure, `propertyPath` the counter it comes from).
 * @param {'compressor' | 'burner'} prefix
 * @returns {CapabilityConfig[]}
 */
const createDailyStatisticsCapabilities = (prefix) => {
  const titles = DAILY_TITLES[prefix];
  const starts = (name, kind) => ({
    capabilityName: `measure_${prefix}_number.${prefix}${name}`,
    propertyPath: 'starts.value',
    computed: kind,
    capabilityOptions: {
      title: titles[kind], ...STARTS_COUNTER, ...LOGGED,
    },
  });
  return [
    starts('StartsToday', 'startsToday'),
    starts('StartsYesterday', 'startsYesterday'),
    starts('StartsLastHour', 'startsLastHour'),
    {
      capabilityName: `measure_${prefix}_number.${prefix}RuntimePerStartYesterday`,
      propertyPath: 'hours.value',
      computed: 'runtimePerStartYesterday',
      capabilityOptions: {
        title: titles.runtimePerStartYesterday, units: 'min', decimals: 0, ...LOGGED,
      },
    },
  ];
};

/** @type {import('./types').ConfigModule['FEATURES']} */
const FEATURES = {
  [PATHS.COMPRESSOR_STATS]: {
    requireRole: 'type:heatpump',
    capabilities: [
      ...createStatisticsCapabilities('compressor', 'Compressor'),
      ...createDailyStatisticsCapabilities('compressor'),
    ],
  },
  [PATHS.COP_TOTAL]: {
    capabilities: [createCopCapability('total', 'COP total')],
  },
  [PATHS.COP_HEATING]: {
    capabilities: [createCopCapability('heating', 'COP heating')],
  },
  [PATHS.COP_DHW]: {
    capabilities: [createCopCapability('dhw', 'COP hot water')],
  },
  [PATHS.HEAT_OUTPUT]: {
    capabilities: [HEAT_OUTPUT],
  },
  [PATHS.SCOP_TOTAL]: {
    capabilities: [seasonalCapability('scop', 'total', SEASONAL_TITLES.scop.total)],
  },
  [PATHS.SCOP_HEATING]: {
    capabilities: [seasonalCapability('scop', 'heating', SEASONAL_TITLES.scop.heating)],
  },
  [PATHS.SCOP_DHW]: {
    capabilities: [seasonalCapability('scop', 'dhw', SEASONAL_TITLES.scop.dhw)],
  },
  [PATHS.SPF_TOTAL]: {
    capabilities: [seasonalCapability('spf', 'total', SEASONAL_TITLES.spf.total)],
  },
  [PATHS.SPF_HEATING]: {
    capabilities: [seasonalCapability('spf', 'heating', SEASONAL_TITLES.spf.heating)],
  },
  [PATHS.SPF_DHW]: {
    capabilities: [seasonalCapability('spf', 'dhw', SEASONAL_TITLES.spf.dhw)],
  },
  [PATHS.HEATING_ROD_STATS]: {
    capabilities: HEATING_ROD_STATISTICS,
  },
  [PATHS.BURNER_STATS]: {
    capabilities: [
      ...createStatisticsCapabilities('burner', 'Burner'),
      ...createDailyStatisticsCapabilities('burner'),
    ],
  },
  [PATHS.FUEL_CELL_STATS]: {
    capabilities: createFuelCellStatisticsCapabilities(),
  },
  // Homey Energy shows the device from its measure_power. The inverter's output is the second
  // choice, on devices that report no consumption of their own
  [PATHS.POWER_CONSUMPTION]: {
    capabilities: [powerCapability('Power consumption')],
  },
  [PATHS.INVERTER_POWER]: {
    fallbackFor: PATHS.POWER_CONSUMPTION,
    capabilities: [powerCapability('Power consumption')],
  },
  [PATHS.ELECTRICITY_TOTAL]: {
    capabilities: [yesterdayCapability('measure_electricity_yesterday.total', {
      en: 'Electricity yesterday (Viessmann)', de: 'Strom gestern (Viessmann)', nl: 'Stroom gisteren (Viessmann)', fr: 'Électricité hier (Viessmann)', sv: 'El i går (Viessmann)',
    }, 'kWh')],
  },
  [PATHS.ELECTRICITY_HEATING]: {
    capabilities: [yesterdayCapability('measure_electricity_yesterday.heating', {
      en: 'Electricity yesterday, heating (Viessmann)',
      de: 'Strom gestern, Heizen (Viessmann)',
      nl: 'Stroom gisteren, verwarming (Viessmann)',
      fr: 'Électricité hier, chauffage (Viessmann)',
      sv: 'El i går, värme (Viessmann)',
    }, 'kWh')],
  },
  [PATHS.ELECTRICITY_DHW]: {
    capabilities: [yesterdayCapability('measure_electricity_yesterday.hotWater', {
      en: 'Electricity yesterday, hot water (Viessmann)',
      de: 'Strom gestern, Warmwasser (Viessmann)',
      nl: 'Stroom gisteren, warm water (Viessmann)',
      fr: 'Électricité hier, eau chaude (Viessmann)',
      sv: 'El i går, varmvatten (Viessmann)',
    }, 'kWh')],
  },
  [PATHS.GAS_TOTAL]: {
    capabilities: [yesterdayCapability('measure_gas_yesterday.total', {
      en: 'Gas yesterday (Viessmann)', de: 'Gas gestern (Viessmann)', nl: 'Gas gisteren (Viessmann)', fr: 'Gaz hier (Viessmann)', sv: 'Gas i går (Viessmann)',
    }, 'm³')],
  },
  [PATHS.GAS_HEATING]: {
    capabilities: [yesterdayCapability('measure_gas_yesterday.heating', {
      en: 'Gas yesterday, heating (Viessmann)',
      de: 'Gas gestern, Heizen (Viessmann)',
      nl: 'Gas gisteren, verwarming (Viessmann)',
      fr: 'Gaz hier, chauffage (Viessmann)',
      sv: 'Gas i går, värme (Viessmann)',
    }, 'm³')],
  },
  [PATHS.GAS_DHW]: {
    capabilities: [yesterdayCapability('measure_gas_yesterday.hotWater', {
      en: 'Gas yesterday, hot water (Viessmann)',
      de: 'Gas gestern, Warmwasser (Viessmann)',
      nl: 'Gas gisteren, warm water (Viessmann)',
      fr: 'Gaz hier, eau chaude (Viessmann)',
      sv: 'Gas i går, varmvatten (Viessmann)',
    }, 'm³')],
  },
};

module.exports = { PATHS, FEATURES };
