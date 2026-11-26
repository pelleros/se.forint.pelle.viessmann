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

// Set points and modes the user can change: hot water and heating targets, the heating
// circuit's operating mode, the one-time hot water charge and the fuel cell's mode. Also
// Homey's standard thermostat (`target_temperature`, `measure_temperature`, `thermostat_mode`
// without a suffix), which Homey's own Flow cards, the Climate view, voice assistants and the
// Matter bridge use: the heating set point, the room temperature and heating on/off.

const { createThermostatCapability } = require('./templates');
const { PATHS: CIRCUIT_PATHS } = require('./circuits');

/** @type {import('./types').ConfigModule['PATHS']} */
const PATHS = {
  HOT_WATER_TARGET: 'heating.dhw.temperature.main',
  HOT_WATER_TARGET_2: 'heating.dhw.temperature.temp2',
  HEATING_CIRCUIT_0_TARGET: 'heating.circuits.0.operating.programs.normal',
  HOT_WATER_CHARGE: 'heating.dhw.oneTimeCharge',
  HEATING_CIRCUIT_0_MODE: 'heating.circuits.0.operating.modes.active',
  FUEL_CELL_MODE: 'fuelCell.operating.modes.active',
  // Newer (E3) devices name the normal program this way
  HEATING_CIRCUIT_0_TARGET_E3: 'heating.circuits.0.operating.programs.normalHeating',
};

// The heating set point: the temperature of the normal program, as `target_temperature.heating`
// and as the standard thermostat's `target_temperature`
const HEATING_TARGET = createThermostatCapability('heating', 'Heating thermostat', {
  propertyPath: 'temperature.value',
  command: {
    name: 'setTemperature',
    parameterMapping: {
      value: 'targetTemperature',
    },
  },
  min: 10,
  max: 30,
});
const HEATING_TARGETS = [
  HEATING_TARGET,
  {
    ...HEATING_TARGET,
    capabilityName: 'target_temperature',
    capabilityOptions: {
      ...HEATING_TARGET.capabilityOptions,
      title: {
        en: 'Room target temperature',
        de: 'Raum-Solltemperatur',
        nl: 'Gewenste kamertemperatuur',
        fr: 'Température ambiante souhaitée',
        sv: 'Önskad rumstemperatur',
      },
    },
  },
];

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

/** @param {{ id: string, title: Record<string, string> }} mode */
const asValue = ({ id, title }) => ({ id, title });

/** @type {import('./types').ConfigModule['FEATURES']} */
const FEATURES = {
  [PATHS.HOT_WATER_TARGET]: {
    capabilities: [createThermostatCapability('hotWater', 'Hot water Normal')],
  },
  [PATHS.HOT_WATER_TARGET_2]: {
    capabilities: [createThermostatCapability('hotWater2', 'Hot water Temp 2')],
  },
  [PATHS.HEATING_CIRCUIT_0_TARGET]: {
    capabilities: HEATING_TARGETS,
  },
  [PATHS.HEATING_CIRCUIT_0_TARGET_E3]: {
    fallbackFor: PATHS.HEATING_CIRCUIT_0_TARGET,
    capabilities: HEATING_TARGETS,
  },
  [PATHS.HEATING_CIRCUIT_0_MODE]: {
    capabilities: [{
      capabilityName: 'thermostat_mode.heating',
      propertyPath: 'value.value',
      command: {
        name: 'setMode',
        parameterMapping: {
          value: 'mode',
        },
      },
      capabilityOptions: {
        title: { en: 'Operating mode' },
        // initializeOperatingModes (device.js) narrows these to the device's own modes and adds
        // the device's other modes, with the titles of MODE_TITLES where known
        values: ['dhw', 'dhwAndHeating', 'heating', 'standby'].map((id) => ({ id, title: MODE_TITLES[id] })),
        preventInsights: true,
      },
    }],
  },
  [PATHS.HOT_WATER_CHARGE]: {
    capabilities: [{
      capabilityName: 'thermostat_mode.hotWaterOneTimeCharge',
      propertyPath: 'active.value',
      command: {
        useValueAsCommand: true,
      },
      valueMapping: {
        true: 'activate',
        false: 'deactivate',
      },
      capabilityOptions: {
        title: { en: 'Hot water one time charge' },
        values: [{
          id: 'activate',
          title: { en: 'Active' },
        }, {
          id: 'deactivate',
          title: { en: 'Inactive' },
        }],
        preventInsights: true,
      },
    }],
  },
  [PATHS.FUEL_CELL_MODE]: {
    capabilities: [{
      capabilityName: 'thermostat_mode.fuelCell',
      propertyPath: 'value.value',
      command: {
        name: 'setMode',
        parameterMapping: {
          value: 'mode',
        },
      },
      capabilityOptions: {
        title: {
          en: 'Fuel cell mode',
        },
        values: [
          {
            id: 'standby',
            title: {
              en: 'Standby',
            },
          },
          {
            id: 'maintenance',
            title: {
              en: 'Maintenance',
            },
          },
          {
            id: 'heatControlled',
            title: {
              en: 'Heat controlled',
            },
          },
          {
            id: 'economical',
            title: {
              en: 'Economical',
            },
          },
          {
            id: 'ecological',
            title: {
              en: 'Ecological',
            },
          },
        ],
        preventInsights: true,
      },
    }],
  },
};

/** @type {import('./types').DerivedCapabilityConfig[]} */
const DERIVED = [
  {
    // The room temperature only: never a supply or outside temperature, since Homey uses it as
    // the temperature of the zone. Its history is in measure_temperature.circuit0_room
    capabilityName: 'measure_temperature',
    sources: [CIRCUIT_PATHS.HEATING_CIRCUIT_0_ROOM_TEMPERATURE],
    derive: (read) => read(CIRCUIT_PATHS.HEATING_CIRCUIT_0_ROOM_TEMPERATURE, 'value.value'),
    capabilityOptions: {
      title: {
        en: 'Room temperature', de: 'Raumtemperatur', nl: 'Kamertemperatuur', fr: 'Température ambiante', sv: 'Rumstemperatur',
      },
      units: '°C',
      decimals: 1,
      preventInsights: true,
      preventTag: true,
    },
  },
  {
    capabilityName: 'thermostat_mode',
    sources: [PATHS.HEATING_CIRCUIT_0_MODE],
    derive: (read) => {
      const mode = read(PATHS.HEATING_CIRCUIT_0_MODE, 'value.value');
      return typeof mode === 'string' ? standardModeOf(mode) : undefined;
    },
    capabilityOptions: {
      title: {
        en: 'Thermostat mode', de: 'Thermostatmodus', nl: 'Thermostaatmodus', fr: 'Mode du thermostat', sv: 'Termostatläge',
      },
      values: standardModesFor(undefined).map(asValue),
      // Not shown on the device: "Operating mode" already offers every mode of the device
      uiComponent: null,
      preventInsights: true,
    },
    options: (context) => ({ values: standardModesFor(context.operatingModes).map(asValue) }),
    write: (value, context) => {
      const standard = STANDARD_MODES.find((mode) => mode.id === value);
      if (!standard) throw new Error(`Unknown thermostat mode: ${value}`);
      const current = context.currentValue?.('thermostat_mode.heating');
      // A mode that already stands for the requested value stays (e.g. forced normal for heat)
      if (typeof current === 'string' && standard.read.includes(current)) return { commands: [], values: { thermostat_mode: value } };
      const ids = (context.operatingModes || []).map((mode) => mode.id);
      const mode = ids.length === 0 ? standard.write[0] : standard.write.find((id) => ids.includes(id));
      if (!mode) throw Object.assign(new Error(`This device has no operating mode for "${value}"`), { code: 'mode_not_available' });
      return {
        commands: [{ path: PATHS.HEATING_CIRCUIT_0_MODE, command: 'setMode', parameters: { mode } }],
        values: { thermostat_mode: value, 'thermostat_mode.heating': mode },
      };
    },
  },
];

module.exports = {
  PATHS, FEATURES, DERIVED, MODE_TITLES, STANDARD_MODES, standardModeOf, standardModesFor,
};
