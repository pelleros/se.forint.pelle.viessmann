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
const path = require('path');
const { PATHS, getAllCapabilities } = require('../drivers/vicare/config');

// Define absolute paths relative to this file
const driverPath = __dirname;
const driverComposeFile = path.join(driverPath, '../drivers/vicare/driver.compose.json');

// Get all unique capabilities from FEATURES using PATHS
const capabilities = new Set();
Object.values(PATHS).forEach((path) => {
  try {
    const caps = getAllCapabilities(path);
    caps.forEach((cap) => capabilities.add(cap.capabilityName));
  } catch (err) {
    // Skip if feature doesn't have capabilities
  }
});

// Read and update driver.compose.json
const driverComposeContent = JSON.parse(fs.readFileSync(driverComposeFile, 'utf8'));
driverComposeContent.capabilities = Array.from(capabilities);

// Write updated content back to file
fs.writeFileSync(driverComposeFile, JSON.stringify(driverComposeContent, null, 2));
