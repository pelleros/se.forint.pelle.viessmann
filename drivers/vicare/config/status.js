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
// burner modulation and the fuel cell's phase.

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
};

module.exports = { PATHS, FEATURES };
