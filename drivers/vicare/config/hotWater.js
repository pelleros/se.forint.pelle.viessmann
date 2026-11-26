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

// What the hot water side is doing right now: whether the cylinder is being heated. The hot
// water temperatures are in temperatures.js, its set points and the one-time charge in
// thermostat.js.

const { YES_NO } = require('./pumps');

/** @type {import('./types').ConfigModule['PATHS']} */
const PATHS = {
  HOT_WATER_CHARGING: 'heating.dhw.charging',
};

/** @type {import('./types').ConfigModule['FEATURES']} */
const FEATURES = {
  [PATHS.HOT_WATER_CHARGING]: {
    capabilities: [{
      capabilityName: 'measure_dhw_active.charging',
      propertyPath: 'active.value',
      capabilityOptions: {
        title: {
          en: 'Hot water charging',
          de: 'Warmwasser-Ladung',
          nl: 'Boiler laden',
          fr: 'Charge eau chaude',
          sv: 'Varmvattenladdning',
        },
        preventInsights: false,
        preventTag: false,
        ...YES_NO,
        insightsTitleTrue: {
          en: 'Hot water charging started',
          de: 'Warmwasser-Ladung gestartet',
          nl: 'Boiler laden gestart',
          fr: 'Charge eau chaude démarrée',
          sv: 'Varmvattenladdning startade',
        },
        insightsTitleFalse: {
          en: 'Hot water charging stopped',
          de: 'Warmwasser-Ladung gestoppt',
          nl: 'Boiler laden gestopt',
          fr: 'Charge eau chaude arrêtée',
          sv: 'Varmvattenladdning stannade',
        },
      },
    }],
  },
};

module.exports = { PATHS, FEATURES };
