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

// Two orders, for newly paired devices. Existing devices keep the order they have: Homey shows
// capabilities in the order they were added, and changing it would mean removing and adding
// them again, which deletes their Insights history and breaks Flows.
//
// PATHS: the order of the feature paths in PATHS, which is also the order of the poll filter and
// the order in which values are read. These are the paths of 1.0.16, in their order then. A path
// that is not listed here comes after them, in the order of MODULES in index.js and then of its
// module's PATHS, so a new theme module or path needs no change here.
//
// CAPABILITIES: the order in which a newly paired device gets its capabilities, and so the order
// of the controls and values on its tile, as groups. An entry is a capability ID, or a prefix
// ending in `*`. A capability takes the place of its exact entry; otherwise of the first prefix
// that matches it. Capabilities that match nothing come last (diagnostics), and capabilities
// with the same place keep the order of PATHS. A new capability usually needs no change here:
// it lands in the group of its prefix.

const PATHS = Object.freeze([
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

const CAPABILITIES = Object.freeze([
  // 1. The heating thermostat: set point and room temperature
  'target_temperature',
  'measure_temperature',
  // 2. Operating mode and program
  'thermostat_mode',
  'thermostat_mode.heating',
  'thermostat_mode.heatingProgram',
  'target_temperature.heating',
  'target_temperature.heatingComfort',
  'target_temperature.heatingReduced',
  'measure_holiday_active',
  'thermostat_mode.fuelCell',
  // 3. Hot water
  'measure_temperature.hotWater',
  'target_temperature.hotWater',
  'target_temperature.hotWater2',
  'thermostat_mode.hotWaterOneTimeCharge',
  'measure_dhw_active*',
  'thermostat_mode.hotWater',
  'target_hysteresis.hotWater',
  'measure_temperature.hotWater*',
  // 4. Status: what the device is doing now
  'measure_status_text',
  'measure_heating_active',
  'measure_operating_state',
  'alarm_*',
  'measure_compressor_active',
  'measure_burner_active',
  'measure_fuelcell_active',
  'measure_compressor_number.compressorModulation',
  'measure_burner_number.burnerModulation',
  'measure_fuelcell_phase',
  'measure_pump_active*',
  // 5. Temperatures
  'measure_temperature.*',
  'measure_pressure*',
  // 6. Energy and efficiency
  'measure_power*',
  'meter_*',
  'measure_cop_number*',
  // 7. Statistics
  'measure_compressor_number*',
  'measure_burner_number*',
  'measure_fuelcell_number*',
  // 8. Everything else (diagnostics) comes after these
]);

module.exports = Object.freeze({ PATHS, CAPABILITIES });
