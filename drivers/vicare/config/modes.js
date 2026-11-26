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

// The operating modes of a heating circuit: their titles, and how they map to Homey's standard
// thermostat mode (heat, cool, auto, off), which Homey's own Flow cards, voice assistants and
// the Matter bridge know.

// Titles of the heating circuit's operating modes. Only titles may change; the ids are what
// saved Flows and the Viessmann API use
const MODE_TITLES = {
  dhw: {
    en: 'Hot water', de: 'Warmwasser', nl: 'Warm water', fr: 'Eau chaude', sv: 'Varmvatten',
  },
  dhwAndHeating: {
    en: 'Hot water and heating', de: 'Warmwasser und Heizung', nl: 'Warm water en verwarming', fr: 'Eau chaude et chauffage', sv: 'Varmvatten och värme',
  },
  heating: {
    en: 'Heating', de: 'Heizung', nl: 'Verwarming', fr: 'Chauffage', sv: 'Värme',
  },
  standby: {
    en: 'Standby', de: 'Standby', nl: 'Stand-by', fr: 'Veille', sv: 'Standby',
  },
  forcedNormal: {
    en: 'Forced normal', de: 'Erzwungen normal', nl: 'Geforceerd normaal', fr: 'Normal forcé', sv: 'Tvingad normal',
  },
  forcedReduced: {
    en: 'Forced reduced', de: 'Erzwungen reduziert', nl: 'Geforceerd verlaagd', fr: 'Réduit forcé', sv: 'Tvingad sänkt',
  },
  normalStandby: {
    en: 'Normal standby', de: 'Normal-Standby', nl: 'Normaal stand-by', fr: 'Veille normale', sv: 'Normal standby',
  },
  cooling: {
    en: 'Cooling', de: 'Kühlen', nl: 'Koelen', fr: 'Refroidissement', sv: 'Kyla',
  },
  heatingCooling: {
    en: 'Heating and cooling', de: 'Heizen und Kühlen', nl: 'Verwarmen en koelen', fr: 'Chauffage et refroidissement', sv: 'Värme och kyla',
  },
  dhwAndHeatingCooling: {
    en: 'Hot water, heating and cooling',
    de: 'Warmwasser, Heizen und Kühlen',
    nl: 'Warm water, verwarmen en koelen',
    fr: 'Eau chaude, chauffage et refroidissement',
    sv: 'Varmvatten, värme och kyla',
  },
};

// The standard thermostat mode: Homey, voice assistants and the Matter bridge know only these
// values. Each stands for some of the Viessmann modes; writing it sets the first mode of
// `write` the device has. `off` keeps hot water on where the device can (hot water only),
// and is standby only where it cannot. `cool` and `auto` (heating or cooling as needed) are
// offered only on devices with such a mode, never on heat-only devices.
const STANDARD_MODES = [
  {
    id: 'heat',
    title: {
      en: 'Heat', de: 'Heizen', nl: 'Verwarmen', fr: 'Chauffage', sv: 'Värme',
    },
    read: ['heating', 'dhwAndHeating', 'forcedNormal', 'forcedReduced'],
    write: ['dhwAndHeating', 'heating'],
  },
  {
    id: 'cool',
    title: {
      en: 'Cool', de: 'Kühlen', nl: 'Koelen', fr: 'Refroidissement', sv: 'Kyla',
    },
    read: ['cooling'],
    write: ['cooling'],
  },
  {
    id: 'auto',
    title: {
      en: 'Auto', de: 'Automatisch', nl: 'Automatisch', fr: 'Automatique', sv: 'Auto',
    },
    read: ['heatingCooling', 'dhwAndHeatingCooling'],
    write: ['dhwAndHeatingCooling', 'heatingCooling'],
  },
  {
    id: 'off',
    title: {
      en: 'Off', de: 'Aus', nl: 'Uit', fr: 'Arrêt', sv: 'Av',
    },
    read: ['dhw', 'standby', 'normalStandby'],
    write: ['dhw', 'standby'],
  },
];

/**
 * The standard mode a Viessmann mode stands for, or null for a mode it does not know.
 * @param {string} mode
 * @returns {string | null}
 */
const standardModeOf = (mode) => STANDARD_MODES.find((standard) => standard.read.includes(mode))?.id ?? null;

/**
 * The standard modes a device with these Viessmann modes can be set to (heat and off when its
 * modes are not known).
 * @param {{ id: string }[] | undefined} operatingModes
 */
const standardModesFor = (operatingModes) => {
  const ids = (operatingModes || []).map((mode) => mode.id);
  if (ids.length === 0) return STANDARD_MODES.filter((mode) => ['heat', 'off'].includes(mode.id));
  return STANDARD_MODES.filter((mode) => mode.write.some((id) => ids.includes(id)));
};

/**
 * The command that sets the standard mode `value` on a device: the first Viessmann mode of
 * `write` the device has. A mode that already stands for the value stays (no command). Throws
 * an error with code `mode_not_available` when the device has no such mode.
 * @param {string} value
 * @param {import('./types').DeviceContext} context
 * @param {string} modePath the feature path of the circuit's operating mode
 * @returns {import('./types').DerivedWrite}
 */
function standardModeWrite(value, context, modePath) {
  const standard = STANDARD_MODES.find((mode) => mode.id === value);
  if (!standard) throw new Error(`Unknown thermostat mode: ${value}`);
  const current = context.currentValue?.('thermostat_mode.heating');
  if (typeof current === 'string' && standard.read.includes(current)) return { commands: [], values: { thermostat_mode: value } };
  const ids = (context.operatingModes || []).map((mode) => mode.id);
  const mode = ids.length === 0 ? standard.write[0] : standard.write.find((id) => ids.includes(id));
  if (!mode) throw Object.assign(new Error(`This device has no operating mode for "${value}"`), { code: 'mode_not_available' });
  return {
    commands: [{ path: modePath, command: 'setMode', parameters: { mode } }],
    values: { thermostat_mode: value, 'thermostat_mode.heating': mode },
  };
}

module.exports = {
  MODE_TITLES, STANDARD_MODES, standardModeOf, standardModesFor, standardModeWrite,
};
