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

// Read all available language files
const localesPath = path.join(__dirname, '../locales');
const languages = fs.readdirSync(localesPath)
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.replace('.json', ''));

// Function to get translations for a key
function getTranslations(key) {
  const translations = {};
  for (const lang of languages) {
    const localeFilePath = path.join(localesPath, `${lang}.json`);
    const localeFile = JSON.parse(fs.readFileSync(localeFilePath, 'utf8'));
    const value = key.split('.').reduce((obj, k) => obj && obj[k], localeFile);
    if (value) translations[lang] = value;
  }
  return translations;
}

// Generate flow compose file from flow cards using new structure
const flowCompose = {
  conditions: Object.values(FLOW_CONDITIONS).map((condition) => {
    const flowCard = {
      id: condition.id,
      title: getTranslations(condition.title),
      titleFormatted: condition.titleFormatted ? getTranslations(condition.titleFormatted) : getTranslations(condition.title),
      args: condition.args ? condition.args.map((arg) => ({
        ...arg,
        title: arg.title ? getTranslations(arg.title) : undefined,
        values: arg.values ? arg.values.map((value) => ({
          id: value.id,
          title: getTranslations(value.title),
        })) : undefined,
      })) : [],
    };

    if (condition.hint) {
      flowCard.hint = getTranslations(condition.hint);
    }

    return flowCard;
  }),

  actions: Object.values(FLOW_ACTIONS).map((action) => {
    const flowCard = {
      id: action.id,
      title: getTranslations(action.title),
      titleFormatted: action.titleFormatted ? getTranslations(action.titleFormatted) : getTranslations(action.title),
      args: action.args ? action.args.map((arg) => ({
        ...arg,
        title: arg.title ? getTranslations(arg.title) : undefined,
        values: arg.values ? arg.values.map((value) => ({
          id: value.id,
          title: getTranslations(value.title),
        })) : undefined,
      })) : [],
    };

    if (action.hint) {
      flowCard.hint = getTranslations(action.hint);
    }

    return flowCard;
  }),

  triggers: Object.values(FLOW_TRIGGERS).map((trigger) => ({
    id: trigger.id,
    title: getTranslations(trigger.title),
    args: trigger.args ? trigger.args.map((arg) => ({
      ...arg,
      title: arg.title ? getTranslations(arg.title) : undefined,
    })) : [],
    tokens: trigger.tokens ? trigger.tokens.map((token) => ({
      ...token,
      title: getTranslations(token.title),
    })) : [],
  })),
};

// Write to file
const outputPath = path.join(__dirname, '../drivers/vicare/driver.flow.compose.json');
fs.writeFileSync(outputPath, JSON.stringify(flowCompose, null, 2));
// eslint-disable-next-line no-console
console.log(`Flow compose file generated at ${outputPath}`);
