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

// Efficiency and statistics: coefficients of performance and the starts and hours counters of
// the compressor, the burner and the fuel cell.

const {
  createCopCapability, createStatisticsCapabilities, createFuelCellStatisticsCapabilities,
} = require('./templates');

/** @type {import('./types').ConfigModule['PATHS']} */
const PATHS = {
  COMPRESSOR_STATS: 'heating.compressors.0.statistics',
  COP_TOTAL: 'heating.cop.total',
  COP_HEATING: 'heating.cop.heating',
  COP_DHW: 'heating.cop.dhw',
  BURNER_STATS: 'heating.burners.0.statistics',
  FUEL_CELL_STATS: 'fuelCell.statistics',
};

/** @type {import('./types').ConfigModule['FEATURES']} */
const FEATURES = {
  [PATHS.COMPRESSOR_STATS]: {
    requireRole: 'type:heatpump',
    capabilities: createStatisticsCapabilities('compressor', 'Compressor'),
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
  [PATHS.BURNER_STATS]: {
    capabilities: createStatisticsCapabilities('burner', 'Burner'),
  },
  [PATHS.FUEL_CELL_STATS]: {
    capabilities: createFuelCellStatisticsCapabilities(),
  },
};

module.exports = { PATHS, FEATURES };
