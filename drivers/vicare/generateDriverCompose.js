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

'use strict';

const fs = require('fs');
const { CAPABILITIES } = require('./config');

// Read the main driver.compose.json
const driverCompose = JSON.parse(fs.readFileSync('driver.compose.json', 'utf8'));

const capabilities = {
  capabilities: Object.values(CAPABILITIES).map((cap) => cap.capabilityName),
  capabilitiesOptions: Object.fromEntries(
    Object.values(CAPABILITIES).map((cap) => [cap.capabilityName, cap.capabilityOptions]),
  ),
};

// Slå samman capabilities-delen med den huvudsakliga driver.compose.json
driverCompose.capabilities = capabilities.capabilities;
driverCompose.capabilitiesOptions = capabilities.capabilitiesOptions;

// Skriv tillbaka den uppdaterade driver.compose.json till filen
fs.writeFileSync('driver.compose.json', JSON.stringify(driverCompose, null, 2));
