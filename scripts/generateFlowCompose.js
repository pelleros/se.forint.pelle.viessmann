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
const { FLOW_CONDITIONS, FLOW_ACTIONS, FLOW_TRIGGERS } = require('../drivers/vicare/flowCards');

// Generate flow compose file from flow cards using new structure
const flowCompose = {
  conditions: Object.values(FLOW_CONDITIONS).map((condition) => {
    const flowCard = {
      id: condition.id,
      title: condition.title,
      titleFormatted: condition.titleFormatted || condition.title,
      args: condition.args || [],
    };

    // Lägg bara till hint om den finns
    if (condition.hint) {
      flowCard.hint = condition.hint;
    }

    return flowCard;
  }),

  actions: Object.values(FLOW_ACTIONS).map((action) => {
    const flowCard = {
      id: action.id,
      title: action.title,
      titleFormatted: action.titleFormatted || action.title,
      args: action.args || [],
    };

    // Lägg bara till hint om den finns
    if (action.hint) {
      flowCard.hint = action.hint;
    }

    return flowCard;
  }),

  triggers: Object.values(FLOW_TRIGGERS).map((trigger) => ({
    id: trigger.id,
    title: trigger.title,
    args: trigger.args || [],
    tokens: trigger.tokens || [],
  })),
};

const outputPath = path.join(__dirname, '../drivers/vicare/driver.flow.compose.json');
fs.writeFileSync(outputPath, JSON.stringify(flowCompose, null, 2));
