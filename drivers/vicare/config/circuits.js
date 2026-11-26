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

// Readings of the heating circuit. Only circuit 0 is configured: heatingCircuit.js maps the
// device's circuit to `heating.circuits.0.*` (see docs/ARCHITECTURE.md, "Heating circuits").
// The circuit's set point and operating mode are in thermostat.js.

const { createTemperatureCapability } = require('./templates');

/** @type {import('./types').ConfigModule['PATHS']} */
const PATHS = {
  HEATING_CIRCUIT_0_ROOM_TEMPERATURE: 'heating.circuits.0.sensors.temperature.room',
  HEATING_CIRCUIT_0_TEMPERATURE: 'heating.circuits.0.temperature',
  HEATING_CIRCUIT_0_SUPPLY_TEMPERATURE: 'heating.circuits.0.sensors.temperature.supply',
};

/** @type {import('./types').ConfigModule['FEATURES']} */
const FEATURES = {
  [PATHS.HEATING_CIRCUIT_0_TEMPERATURE]: {
    capabilities: [createTemperatureCapability('circuit0', 'Heating circuit target temperature', {
      preventTag: true,
    })],
  },
  [PATHS.HEATING_CIRCUIT_0_SUPPLY_TEMPERATURE]: {
    capabilities: [createTemperatureCapability('circuit0_supply', 'Heating Circuit Supply Temperature', {
      preventTag: true,
    })],
  },
  [PATHS.HEATING_CIRCUIT_0_ROOM_TEMPERATURE]: {
    capabilities: [createTemperatureCapability('circuit0_room', 'Room Temperature')],
  },
};

module.exports = { PATHS, FEATURES };
