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

// What the heat generator is doing right now: compressor and burner running, compressor load,
// burner modulation and the fuel cell's phase; and whether something is wrong: faults the heating
// system reports, its logbook, and the device's problem alarm and maintenance action.

const {
  RUNNING_STATE_TEXTS, createActiveCapability, createModulationCapability,
} = require('./templates');

/** @type {import('./types').ConfigModule['PATHS']} */
const PATHS = {
  COMPRESSOR: 'heating.compressors.0',
  COMPRESSOR_POWER: 'heating.compressors.0.sensors.power',
  BURNER: 'heating.burners.0',
  BURNER_MODULATION: 'heating.burners.0.modulation',
  FUEL_CELL_PHASE: 'fuelCell.operating.phase',
  // Read by faultLog.js: faults (alarm_problem, warning, trigger) and logbook entries (trigger)
  DEVICE_ERRORS: 'device.messages.errors.raw',
  FUEL_CELL_ERRORS: 'fuelCell.errors.raw',
  LOGBOOK: 'device.messages.logbook',
};

// The problem alarm: faults the heating system reports, values that stopped updating, and writes
// the heating system did not take. Shown with the warning that says what is wrong.
const PROBLEM_TITLE = {
  en: 'Problem', de: 'Problem', nl: 'Probleem', fr: 'Problème', sv: 'Problem',
};

/** @type {import('./types').ConfigModule['FEATURES']} */
const FEATURES = {
  [PATHS.COMPRESSOR]: {
    requireRole: 'type:heatpump',
    capabilities: [createActiveCapability('compressor', 'Compressor running', RUNNING_STATE_TEXTS.compressor)],
  },
  [PATHS.BURNER]: {
    capabilities: [createActiveCapability('burner', 'Burner running', RUNNING_STATE_TEXTS.burner)],
  },
  [PATHS.COMPRESSOR_POWER]: {
    requireRole: 'type:heatpump',
    capabilities: [createModulationCapability('compressor', 'Compressor load')],
  },
  [PATHS.BURNER_MODULATION]: {
    capabilities: [createModulationCapability('burner', 'Burner modulation')],
  },
  [PATHS.FUEL_CELL_PHASE]: {
    capabilities: [{
      capabilityName: 'measure_fuelcell_phase',
      propertyPath: 'value.value',
      capabilityOptions: {
        title: {
          en: 'Fuel cell phase',
        },
      },
    }],
  },
  // Read by faultLog.js only (faults of a fuel cell, logbook entries for a Flow trigger)
  [PATHS.FUEL_CELL_ERRORS]: {
    capabilities: [],
  },
  [PATHS.LOGBOOK]: {
    capabilities: [],
  },
  // Every device gets these: values can stop updating on any device, and the maintenance action
  // ("Refresh Viessmann features" in the device's settings) is for everyone
  [PATHS.DEVICE_ERRORS]: {
    alwaysAdd: true,
    capabilities: [{
      capabilityName: 'alarm_problem',
      propertyPath: 'entries.value',
      computed: 'problem',
      capabilityOptions: {
        title: PROBLEM_TITLE,
        preventInsights: false,
        preventTag: false,
      },
    }, {
      capabilityName: 'button.refreshFeatures',
      propertyPath: 'entries.value',
      computed: 'action',
      capabilityOptions: {
        maintenanceAction: true,
        title: {
          en: 'Refresh Viessmann features',
          de: 'Viessmann-Funktionen neu einlesen',
          nl: 'Viessmann-functies opnieuw inlezen',
          fr: 'Relire les fonctions Viessmann',
          sv: 'Läs in Viessmann-funktioner igen',
        },
        desc: {
          en: 'Reads the datapoints of your heating system from Viessmann again and adds values it reports now. Nothing is removed. Uses a few API calls.',
          de: 'Liest die Datenpunkte deiner Heizung erneut von Viessmann und ergänzt Werte, die sie jetzt meldet. Es wird nichts entfernt. Verbraucht einige API-Aufrufe.',
          nl: 'Leest de datapunten van je verwarming opnieuw bij Viessmann in en voegt waarden toe die ze nu meldt. Er wordt niets verwijderd. Gebruikt enkele API-aanroepen.',
          fr: 'Relit les points de données de votre chauffage chez Viessmann et ajoute les valeurs qu\'il signale maintenant. Rien n\'est supprimé. Utilise quelques appels API.',
          sv: 'Läser in värmesystemets datapunkter från Viessmann igen och lägger till värden som det rapporterar nu. Inget tas bort. Använder några API-anrop.',
        },
      },
    }],
  },
};

module.exports = { PATHS, FEATURES };
