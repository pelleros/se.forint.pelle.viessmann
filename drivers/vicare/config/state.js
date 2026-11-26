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

// What the device is doing right now, combined from the running states of the compressor, the
// burner and the fuel cell: heating now (yes/no, the tile's on/off look), the operating state (heating, hot
// water, defrost, cooling, standby) and a short status text. Everything is built from values the
// device reports; when they are missing, the value is left empty.

const { PATHS: STATUS_PATHS } = require('./status');
const { RUNNING_STATE_TEXTS } = require('./templates');
const { PATHS: TEMPERATURE_PATHS } = require('./temperatures');

/** @type {import('./types').ConfigModule['PATHS']} */
const PATHS = {
  HOT_WATER_CHARGING: 'heating.dhw.charging',
};

const { COMPRESSOR, BURNER, FUEL_CELL_PHASE } = STATUS_PATHS;

const { titleTrue, titleFalse } = RUNNING_STATE_TEXTS.compressor;
const YES_NO = { titleTrue, titleFalse };

// Compressor phases in which a running compressor does not heat
const DEFROST_PHASES = ['defrost', 'preparing-defrost', 'passive-defrost'];
const NOT_HEATING_PHASES = ['cooling', 'pause', 'off', ...DEFROST_PHASES];

const STATES = {
  heating: {
    en: 'Heating', de: 'Heizen', nl: 'Verwarmen', fr: 'Chauffage', sv: 'Värmer',
  },
  hotWater: {
    en: 'Hot water', de: 'Warmwasser', nl: 'Warm water', fr: 'Eau chaude', sv: 'Varmvatten',
  },
  defrost: {
    en: 'Defrost', de: 'Abtauen', nl: 'Ontdooien', fr: 'Dégivrage', sv: 'Avfrostning',
  },
  cooling: {
    en: 'Cooling', de: 'Kühlen', nl: 'Koelen', fr: 'Refroidissement', sv: 'Kyler',
  },
  standby: {
    en: 'Standby', de: 'Standby', nl: 'Stand-by', fr: 'Veille', sv: 'Standby',
  },
};

// Words of the status text
const STATUS_WORDS = {
  compressor: {
    en: 'compressor', de: 'Verdichter', nl: 'compressor', fr: 'compresseur', sv: 'kompressor',
  },
  burner: {
    en: 'burner', de: 'Brenner', nl: 'brander', fr: 'brûleur', sv: 'brännare',
  },
  fuelCell: {
    en: 'fuel cell', de: 'Brennstoffzelle', nl: 'brandstofcel', fr: 'pile à combustible', sv: 'bränslecell',
  },
  hotWater: {
    en: 'hot water', de: 'Warmwasser', nl: 'warm water', fr: 'eau chaude', sv: 'varmvatten',
  },
  holiday: {
    en: 'holiday', de: 'Urlaub', nl: 'vakantie', fr: 'vacances', sv: 'semester',
  },
};

/**
 * @param {Record<string, string>} texts
 * @param {string | undefined} language
 */
const translate = (texts, language) => texts[language || 'en'] || texts.en;

/**
 * A number with at most one decimal, with a decimal comma in the languages that use one.
 * @param {number} value
 * @param {string | undefined} language
 */
const formatNumber = (value, language) => {
  const text = String(Math.round(value * 10) / 10);
  return (language || 'en') === 'en' ? text : text.replace('.', ',');
};

/**
 * The running states this response reports: undefined for what it does not report.
 * @param {import('./types').FeatureReader} read
 */
function runningStates(read) {
  const compressorActive = read(COMPRESSOR, 'active.value');
  const phase = read(COMPRESSOR, 'phase.value');
  const burnerActive = read(BURNER, 'active.value');
  const compressor = typeof compressorActive === 'boolean' ? compressorActive : undefined;
  const burner = typeof burnerActive === 'boolean' ? burnerActive : undefined;
  const compressorHeating = compressor === undefined ? undefined
    : compressor && !NOT_HEATING_PHASES.includes(String(phase));
  const fuelCellPhase = read(FUEL_CELL_PHASE, 'value.value');
  const fuelCell = typeof fuelCellPhase === 'string' ? fuelCellPhase === 'generation' : undefined;
  return {
    compressor, burner, phase, compressorHeating, fuelCell,
  };
}

/**
 * True while the compressor (in a heating phase), the burner or the fuel cell (generating)
 * runs, also for hot water.
 * @param {import('./types').FeatureReader} read
 * @returns {boolean | undefined}
 */
function heatingNow(read) {
  const { burner, compressorHeating, fuelCell } = runningStates(read);
  if (compressorHeating === undefined && burner === undefined && fuelCell === undefined) return undefined;
  return compressorHeating === true || burner === true || fuelCell === true;
}

/**
 * Hot water while heating and the cylinder is being charged (where the device reports it;
 * otherwise heating), defrost and cooling from the compressor's phase, else standby.
 * @param {import('./types').FeatureReader} read
 * @returns {string | undefined}
 */
function operatingState(read) {
  const { compressor, phase } = runningStates(read);
  const heating = heatingNow(read);
  if (heating === undefined) return undefined;
  if (DEFROST_PHASES.includes(String(phase))) return 'defrost';
  if (phase === 'cooling' && compressor) return 'cooling';
  if (heating) return read(PATHS.HOT_WATER_CHARGING, 'active.value') === true ? 'hotWater' : 'heating';
  return 'standby';
}

/**
 * E.g. "Heating · compressor 55 % · hot water 47.5 °C", from this response's readings.
 * @param {import('./types').FeatureReader} read
 * @param {import('./types').DeviceContext} context
 * @returns {string | undefined}
 */
function statusText(read, context) {
  const { language } = context;
  /** @param {string} name */
  const reading = (name) => context.readings?.get(name)?.value;
  const parts = [];
  const state = operatingState(read);
  if (state) parts.push(translate(STATES[state], language));
  const { compressor, burner, fuelCell } = runningStates(read);
  const compressorLoad = reading('measure_compressor_number.compressorModulation');
  const burnerModulation = reading('measure_burner_number.burnerModulation');
  if (compressor && typeof compressorLoad === 'number') {
    parts.push(`${translate(STATUS_WORDS.compressor, language)} ${formatNumber(compressorLoad, language)} %`);
  } else if (burner && typeof burnerModulation === 'number') {
    parts.push(`${translate(STATUS_WORDS.burner, language)} ${formatNumber(burnerModulation, language)} %`);
  }
  if (fuelCell) parts.push(translate(STATUS_WORDS.fuelCell, language));
  const hotWater = read(TEMPERATURE_PATHS.HOT_WATER_TEMP, 'value.value');
  if (typeof hotWater === 'number') {
    // While heating hot water, the state already says so
    const label = state === 'hotWater' ? '' : `${translate(STATUS_WORDS.hotWater, language)} `;
    parts.push(`${label}${formatNumber(hotWater, language)} °C`);
  }
  if (reading('measure_holiday_active') === true) parts.push(translate(STATUS_WORDS.holiday, language));
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** @type {import('./types').ConfigModule['FEATURES']} */
const FEATURES = {
  [PATHS.HOT_WATER_CHARGING]: {
    capabilities: [{
      capabilityName: 'measure_dhw_active.charging',
      propertyPath: 'active.value',
      capabilityOptions: {
        title: {
          en: 'Hot water charging', de: 'Warmwasserbereitung', nl: 'Warm water laden', fr: 'Charge eau chaude', sv: 'Varmvattenladdning',
        },
        ...YES_NO,
        insightsTitleTrue: {
          en: 'Hot water charging started',
          de: 'Warmwasserbereitung gestartet',
          nl: 'Warm water laden gestart',
          fr: 'Charge eau chaude démarrée',
          sv: 'Varmvattenladdningen startade',
        },
        insightsTitleFalse: {
          en: 'Hot water charging stopped',
          de: 'Warmwasserbereitung gestoppt',
          nl: 'Warm water laden gestopt',
          fr: 'Charge eau chaude arrêtée',
          sv: 'Varmvattenladdningen stannade',
        },
        preventInsights: false,
        preventTag: false,
      },
    }],
  },
};

/** @type {import('./types').DerivedCapabilityConfig[]} */
const DERIVED = [
  {
    capabilityName: 'measure_heating_active',
    sources: [COMPRESSOR, BURNER, FUEL_CELL_PHASE],
    derive: heatingNow,
    capabilityOptions: {
      title: {
        en: 'Heating now', de: 'Heizt gerade', nl: 'Verwarmt nu', fr: 'Chauffe en ce moment', sv: 'Värmer nu',
      },
      ...YES_NO,
      insightsTitleTrue: {
        en: 'Heating started', de: 'Heizen gestartet', nl: 'Verwarmen gestart', fr: 'Chauffage démarré', sv: 'Uppvärmningen startade',
      },
      insightsTitleFalse: {
        en: 'Heating stopped', de: 'Heizen gestoppt', nl: 'Verwarmen gestopt', fr: 'Chauffage arrêté', sv: 'Uppvärmningen stannade',
      },
      preventInsights: false,
      preventTag: false,
    },
  },
  {
    capabilityName: 'measure_operating_state',
    sources: [COMPRESSOR, BURNER, FUEL_CELL_PHASE],
    derive: operatingState,
    capabilityOptions: {
      title: {
        en: 'Operating state', de: 'Betriebszustand', nl: 'Bedrijfstoestand', fr: 'État de fonctionnement', sv: 'Driftstatus',
      },
      preventInsights: true,
    },
  },
  {
    capabilityName: 'measure_status_text',
    sources: [COMPRESSOR, BURNER, FUEL_CELL_PHASE],
    derive: statusText,
    capabilityOptions: {
      title: {
        en: 'Status', de: 'Status', nl: 'Status', fr: 'État', sv: 'Status',
      },
      preventInsights: true,
    },
  },
];

module.exports = {
  PATHS, FEATURES, DERIVED, STATES, heatingNow, operatingState, statusText, formatNumber,
};
