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

// Heating programs and hot water settings: the program picker (normal, reduced, comfort, eco),
// the set points of the reduced and comfort programs, the holiday program, the hot water mode
// and the hot water hysteresis. The normal program's set point is in thermostat.js.

const { createThermostatCapability } = require('./templates');
const { PATHS: THERMOSTAT_PATHS } = require('./thermostat');

/** @type {import('./types').ConfigModule['PATHS']} */
const PATHS = {
  HEATING_CIRCUIT_0_PROGRAM: 'heating.circuits.0.operating.programs.active',
  HEATING_CIRCUIT_0_REDUCED: 'heating.circuits.0.operating.programs.reduced',
  HEATING_CIRCUIT_0_COMFORT: 'heating.circuits.0.operating.programs.comfort',
  // Newer (E3) devices name the reduced and comfort programs this way
  HEATING_CIRCUIT_0_REDUCED_E3: 'heating.circuits.0.operating.programs.reducedHeating',
  HEATING_CIRCUIT_0_COMFORT_E3: 'heating.circuits.0.operating.programs.comfortHeating',
  HOLIDAY: 'heating.operating.programs.holiday',
  HOT_WATER_MODE: 'heating.dhw.operating.modes.active',
  HOT_WATER_HYSTERESIS: 'heating.dhw.temperature.hysteresis',
};

// Only switched on and off (activate/deactivate), so not polled: the active program shows it
const ECO_PROGRAM = 'heating.circuits.0.operating.programs.eco';

/**
 * A program's set point: `target_temperature.<name>` from the program's temperature.
 * @param {string} name
 * @param {Record<string, string>} title
 */
const programTarget = (name, title) => createThermostatCapability(name, title.en, {
  propertyPath: 'temperature.value',
  command: {
    name: 'setTemperature',
    parameterMapping: {
      value: 'targetTemperature',
    },
  },
  min: 10,
  max: 30,
  capabilityOptions: { title },
});

const REDUCED_TARGET = programTarget('heatingReduced', {
  en: 'Reduced temperature', de: 'Reduzierte Temperatur', nl: 'Verlaagde temperatuur', fr: 'Température réduite', sv: 'Sänkt temperatur',
});
const COMFORT_TARGET = programTarget('heatingComfort', {
  en: 'Comfort temperature', de: 'Komforttemperatur', nl: 'Comforttemperatuur', fr: 'Température confort', sv: 'Komforttemperatur',
});

// The programs the picker offers, each with the feature paths that stand for it on a device
// (older and newer naming) and the program ids the device reports as active for it
const PROGRAMS = [
  {
    id: 'normal',
    title: {
      en: 'Normal', de: 'Normal', nl: 'Normaal', fr: 'Normal', sv: 'Normal',
    },
    paths: [THERMOSTAT_PATHS.HEATING_CIRCUIT_0_TARGET, THERMOSTAT_PATHS.HEATING_CIRCUIT_0_TARGET_E3],
    active: ['normal', 'normalHeating'],
  },
  {
    id: 'reduced',
    title: {
      en: 'Reduced', de: 'Reduziert', nl: 'Verlaagd', fr: 'Réduit', sv: 'Sänkt',
    },
    paths: [PATHS.HEATING_CIRCUIT_0_REDUCED, PATHS.HEATING_CIRCUIT_0_REDUCED_E3],
    active: ['reduced', 'reducedHeating'],
  },
  {
    id: 'comfort',
    title: {
      en: 'Comfort', de: 'Komfort', nl: 'Comfort', fr: 'Confort', sv: 'Komfort',
    },
    paths: [PATHS.HEATING_CIRCUIT_0_COMFORT, PATHS.HEATING_CIRCUIT_0_COMFORT_E3],
    active: ['comfort', 'comfortHeating'],
  },
  {
    id: 'eco',
    title: {
      en: 'Eco', de: 'Eco', nl: 'Eco', fr: 'Éco', sv: 'Eko',
    },
    paths: [ECO_PROGRAM],
    active: ['eco'],
  },
];

/**
 * The programs a device with these stored features has.
 * @param {string[] | undefined} features
 */
const programsFor = (features) => PROGRAMS.filter((program) => program.paths.some((path) => (features || []).includes(path)));

/**
 * The stored path of a program on the device, or undefined.
 * @param {string} id
 * @param {string[] | undefined} features
 */
const programPath = (id, features) => PROGRAMS.find((program) => program.id === id)?.paths
  .find((path) => (features || []).includes(path));

/** @param {{ id: string, title: Record<string, string> }} program */
const asValue = ({ id, title }) => ({ id, title });

/**
 * The commands that switch the picker to a program. Comfort and eco are switched on and off;
 * switching one on first switches the other off. Normal and reduced follow the device's time
 * program: choosing one ends comfort or eco, which hands control back to the time program.
 * @param {string} value
 * @param {import('./types').DeviceContext} context
 * @returns {import('./types').DerivedWrite}
 */
function switchProgram(value, context) {
  const features = context.features || [];
  const current = context.currentValue?.('thermostat_mode.heatingProgram');
  /** @type {import('./types').DerivedWrite['commands']} */
  const commands = [];
  /** @param {string} id @param {string} command */
  const add = (id, command) => {
    const path = programPath(id, features);
    if (!path) throw Object.assign(new Error(`This device has no ${id} program`), { code: 'program_not_available' });
    commands.push({ path, command, parameters: {} });
  };
  if (value === 'comfort' || value === 'eco') {
    const other = value === 'comfort' ? 'eco' : 'comfort';
    if (current === other) add(other, 'deactivate');
    add(value, 'activate');
    return { commands, values: { 'thermostat_mode.heatingProgram': value } };
  }
  if (value === 'normal' || value === 'reduced') {
    if (current !== 'comfort' && current !== 'eco') {
      throw Object.assign(new Error(`The ${value} program follows the device's time program and cannot be chosen directly`), {
        code: 'program_follows_schedule',
      });
    }
    add(current, 'deactivate');
    // The time program decides what comes next; the next poll shows it
    return { commands, values: {} };
  }
  throw new Error(`Unknown program: ${value}`);
}

/** @type {import('./types').ConfigModule['FEATURES']} */
const FEATURES = {
  // Read by the program picker below
  [PATHS.HEATING_CIRCUIT_0_PROGRAM]: {
    capabilities: [],
  },
  [PATHS.HEATING_CIRCUIT_0_REDUCED]: {
    capabilities: [REDUCED_TARGET],
  },
  [PATHS.HEATING_CIRCUIT_0_COMFORT]: {
    capabilities: [COMFORT_TARGET],
  },
  [PATHS.HEATING_CIRCUIT_0_REDUCED_E3]: {
    fallbackFor: PATHS.HEATING_CIRCUIT_0_REDUCED,
    capabilities: [REDUCED_TARGET],
  },
  [PATHS.HEATING_CIRCUIT_0_COMFORT_E3]: {
    fallbackFor: PATHS.HEATING_CIRCUIT_0_COMFORT,
    capabilities: [COMFORT_TARGET],
  },
  [PATHS.HOLIDAY]: {
    capabilities: [{
      capabilityName: 'measure_holiday_active',
      propertyPath: 'active.value',
      capabilityOptions: {
        title: {
          en: 'Holiday program', de: 'Urlaubsprogramm', nl: 'Vakantieprogramma', fr: 'Programme vacances', sv: 'Semesterprogram',
        },
        titleTrue: {
          en: 'Active', de: 'Aktiv', nl: 'Actief', fr: 'Actif', sv: 'Aktivt',
        },
        titleFalse: {
          en: 'Off', de: 'Aus', nl: 'Uit', fr: 'Arrêt', sv: 'Av',
        },
        insightsTitleTrue: {
          en: 'Holiday program started',
          de: 'Urlaubsprogramm gestartet',
          nl: 'Vakantieprogramma gestart',
          fr: 'Programme vacances démarré',
          sv: 'Semesterprogrammet startade',
        },
        insightsTitleFalse: {
          en: 'Holiday program ended',
          de: 'Urlaubsprogramm beendet',
          nl: 'Vakantieprogramma beëindigd',
          fr: 'Programme vacances terminé',
          sv: 'Semesterprogrammet slutade',
        },
        preventInsights: false,
        preventTag: false,
      },
    }],
  },
  [PATHS.HOT_WATER_MODE]: {
    capabilities: [{
      capabilityName: 'thermostat_mode.hotWater',
      propertyPath: 'value.value',
      command: {
        name: 'setMode',
        parameterMapping: {
          value: 'mode',
        },
      },
      // Narrowed to the modes the device's command accepts
      enumParameter: 'mode',
      capabilityOptions: {
        title: {
          en: 'Hot water mode', de: 'Warmwassermodus', nl: 'Warmwatermodus', fr: 'Mode eau chaude', sv: 'Varmvattenläge',
        },
        values: [
          {
            id: 'eco',
            title: {
              en: 'Eco', de: 'Eco', nl: 'Eco', fr: 'Éco', sv: 'Eko',
            },
          },
          {
            id: 'efficient',
            title: {
              en: 'Efficient', de: 'Effizient', nl: 'Efficiënt', fr: 'Efficace', sv: 'Effektiv',
            },
          },
          {
            id: 'efficientWithMinComfort',
            title: {
              en: 'Efficient, min. comfort',
              de: 'Effizient, min. Komfort',
              nl: 'Efficiënt, min. comfort',
              fr: 'Efficace, confort min.',
              sv: 'Effektiv, min. komfort',
            },
          },
          {
            id: 'balanced',
            title: {
              en: 'Balanced', de: 'Ausgewogen', nl: 'Gebalanceerd', fr: 'Équilibré', sv: 'Balanserad',
            },
          },
          {
            id: 'comfort',
            title: {
              en: 'Comfort', de: 'Komfort', nl: 'Comfort', fr: 'Confort', sv: 'Komfort',
            },
          },
          {
            id: 'off',
            title: {
              en: 'Off', de: 'Aus', nl: 'Uit', fr: 'Arrêt', sv: 'Av',
            },
          },
        ],
        preventInsights: true,
      },
    }],
  },
  [PATHS.HOT_WATER_HYSTERESIS]: {
    capabilities: [{
      capabilityName: 'target_hysteresis.hotWater',
      propertyPath: 'value.value',
      command: {
        name: 'setHysteresis',
        parameterMapping: {
          value: 'hysteresis',
        },
      },
      capabilityOptions: {
        title: {
          en: 'Hot water hysteresis', de: 'Warmwasser-Hysterese', nl: 'Warmwaterhysterese', fr: 'Hystérésis eau chaude', sv: 'Varmvattenhysteres',
        },
        units: 'K',
        decimals: 1,
        min: 1,
        max: 10,
        step: 0.5,
        preventInsights: true,
      },
    }],
  },
};

/** @type {import('./types').DerivedCapabilityConfig[]} */
const DERIVED = [
  {
    capabilityName: 'thermostat_mode.heatingProgram',
    sources: [PATHS.HEATING_CIRCUIT_0_PROGRAM],
    available: (features) => programsFor(features).length > 0,
    // Another active program (standby, holiday, fixed, ...) shows as no program
    derive: (read) => {
      const active = read(PATHS.HEATING_CIRCUIT_0_PROGRAM, 'value.value');
      if (typeof active !== 'string') return undefined;
      return PROGRAMS.find((program) => program.active.includes(active))?.id ?? null;
    },
    capabilityOptions: {
      title: {
        en: 'Program', de: 'Programm', nl: 'Programma', fr: 'Programme', sv: 'Program',
      },
      values: PROGRAMS.map(asValue),
      preventInsights: true,
    },
    options: (context) => ({ values: programsFor(context.features).map(asValue) }),
    write: switchProgram,
  },
];

module.exports = {
  PATHS, FEATURES, DERIVED, PROGRAMS, ECO_PROGRAM, programsFor, programPath,
};
