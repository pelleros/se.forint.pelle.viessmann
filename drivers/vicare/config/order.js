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

// The order of the feature paths in PATHS. It decides the order in which a newly paired device
// gets its capabilities (and so the order of the values on its tile), the order of the poll
// filter and the order in which values are read. Existing devices keep the order they have.
//
// These are the paths of 1.0.16, in their order then. A path that is not listed here comes
// after them, in the order of MODULES in index.js and then of its module's PATHS, so a new
// theme module or path needs no change here. Change this list only to change the order on
// purpose, for newly paired devices.

module.exports = Object.freeze([
  'HOT_WATER_TEMP',
  'HOT_WATER_TARGET',
  'HOT_WATER_TARGET_2',
  'HEATING_CIRCUIT_0_TARGET',
  'HOT_WATER_CHARGE',
  'HEATING_CIRCUIT_0_MODE',
  'OUTSIDE_TEMP',
  'HEATING_CIRCUIT_0_ROOM_TEMPERATURE',
  'HEATING_CIRCUIT_0_TEMPERATURE',
  'HEATING_CIRCUIT_0_SUPPLY_TEMPERATURE',
  'BUFFER_TEMP',
  'BUFFER_TEMP_TOP',
  'RETURN_TEMP',
  'PRIMARY_CIRCUIT_SUPPLY_TEMP',
  'PRIMARY_CIRCUIT_RETURN_TEMP',
  'SECONDARY_CIRCUIT_SUPPLY_TEMP',
  'BOILER_TEMPERATURE_MAIN',
  'BOILER_COMMON_SUPPLY_TEMP',
  'COMPRESSOR',
  'COMPRESSOR_STATS',
  'COMPRESSOR_POWER',
  'COP_TOTAL',
  'COP_HEATING',
  'COP_DHW',
  'BURNER',
  'BURNER_MODULATION',
  'BURNER_STATS',
  'FUEL_CELL_RETURN_TEMP',
  'FUEL_CELL_SUPPLY_TEMP',
  'FUEL_CELL_STATS',
  'FUEL_CELL_PHASE',
  'FUEL_CELL_MODE',
]);
