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

// Pumps: whether the heating circuit's circulation pump and the hot water circulation pump run
// and, in the diagnostic group, the hot water loading pump and the circuit's secondary pump.
// Viessmann reports a pump as `status: on | off`; the capability is a boolean. The factory
// below also serves the other on/off states (frost protection, solar pump).

/** @typedef {import('./types').CapabilityConfig} CapabilityConfig */
/** @typedef {import('./types').Translated} Translated */

const YES_NO = {
  titleTrue: {
    en: 'Yes', de: 'Ja', nl: 'Ja', fr: 'Oui', sv: 'Ja',
  },
  titleFalse: {
    en: 'No', de: 'Nein', nl: 'Nee', fr: 'Non', sv: 'Nej',
  },
};

/**
 * A boolean read from a feature's `status` (`on` → true, `off` → false).
 * @param {string} capabilityName
 * @param {{ title: Translated, insightsTitleTrue: Translated, insightsTitleFalse: Translated,
 *   titleTrue?: Translated, titleFalse?: Translated, preventTag?: boolean }} texts
 * @returns {CapabilityConfig}
 */
const createOnOffCapability = (capabilityName, {
  title, insightsTitleTrue, insightsTitleFalse, titleTrue = YES_NO.titleTrue, titleFalse = YES_NO.titleFalse,
  preventTag = false,
}) => ({
  capabilityName,
  propertyPath: 'status.value',
  valueMapping: { on: true, off: false },
  capabilityOptions: {
    title,
    preventInsights: false,
    preventTag,
    titleTrue,
    titleFalse,
    insightsTitleTrue,
    insightsTitleFalse,
  },
});

/** @type {import('./types').ConfigModule['PATHS']} */
const PATHS = {
  HEATING_CIRCUIT_0_PUMP: 'heating.circuits.0.circulation.pump',
  HOT_WATER_CIRCULATION_PUMP: 'heating.dhw.pumps.circulation',
  HOT_WATER_PRIMARY_PUMP: 'heating.dhw.pumps.primary',
  HEATING_CIRCUIT_0_SECONDARY_PUMP: 'heating.circuits.0.circulation.secondaryPump',
};

/** @type {import('./types').ConfigModule['FEATURES']} */
const FEATURES = {
  [PATHS.HEATING_CIRCUIT_0_PUMP]: {
    capabilities: [createOnOffCapability('measure_pump_active.circuit0', {
      title: {
        en: 'Heating circulation pump',
        de: 'Heizkreispumpe',
        nl: 'Circulatiepomp verwarming',
        fr: 'Circulateur chauffage',
        sv: 'Cirkulationspump värme',
      },
      insightsTitleTrue: {
        en: 'Heating circulation pump started',
        de: 'Heizkreispumpe gestartet',
        nl: 'Circulatiepomp verwarming gestart',
        fr: 'Circulateur chauffage démarré',
        sv: 'Cirkulationspump värme startade',
      },
      insightsTitleFalse: {
        en: 'Heating circulation pump stopped',
        de: 'Heizkreispumpe gestoppt',
        nl: 'Circulatiepomp verwarming gestopt',
        fr: 'Circulateur chauffage arrêté',
        sv: 'Cirkulationspump värme stannade',
      },
    })],
  },
  [PATHS.HOT_WATER_CIRCULATION_PUMP]: {
    capabilities: [createOnOffCapability('measure_pump_active.dhwCirculation', {
      title: {
        en: 'Hot water circulation pump',
        de: 'Zirkulationspumpe Warmwasser',
        nl: 'Circulatiepomp warm water',
        fr: 'Pompe de bouclage eau chaude',
        sv: 'Cirkulationspump varmvatten',
      },
      insightsTitleTrue: {
        en: 'Hot water circulation pump started',
        de: 'Zirkulationspumpe Warmwasser gestartet',
        nl: 'Circulatiepomp warm water gestart',
        fr: 'Pompe de bouclage eau chaude démarrée',
        sv: 'Cirkulationspump varmvatten startade',
      },
      insightsTitleFalse: {
        en: 'Hot water circulation pump stopped',
        de: 'Zirkulationspumpe Warmwasser gestoppt',
        nl: 'Circulatiepomp warm water gestopt',
        fr: 'Pompe de bouclage eau chaude arrêtée',
        sv: 'Cirkulationspump varmvatten stannade',
      },
    })],
  },
  [PATHS.HOT_WATER_PRIMARY_PUMP]: {
    group: 'diagnostic',
    capabilities: [createOnOffCapability('measure_pump_active.dhwPrimary', {
      title: {
        en: 'Hot water loading pump',
        de: 'Speicherladepumpe',
        nl: 'Boilerlaadpomp',
        fr: 'Pompe de charge eau chaude',
        sv: 'Laddpump varmvatten',
      },
      insightsTitleTrue: {
        en: 'Hot water loading pump started',
        de: 'Speicherladepumpe gestartet',
        nl: 'Boilerlaadpomp gestart',
        fr: 'Pompe de charge eau chaude démarrée',
        sv: 'Laddpump varmvatten startade',
      },
      insightsTitleFalse: {
        en: 'Hot water loading pump stopped',
        de: 'Speicherladepumpe gestoppt',
        nl: 'Boilerlaadpomp gestopt',
        fr: 'Pompe de charge eau chaude arrêtée',
        sv: 'Laddpump varmvatten stannade',
      },
      preventTag: true,
    })],
  },
  [PATHS.HEATING_CIRCUIT_0_SECONDARY_PUMP]: {
    group: 'diagnostic',
    capabilities: [createOnOffCapability('measure_pump_active.circuit0Secondary', {
      title: {
        en: 'Secondary heating pump',
        de: 'Sekundärpumpe Heizkreis',
        nl: 'Secundaire pomp verwarming',
        fr: 'Pompe secondaire chauffage',
        sv: 'Sekundärpump värme',
      },
      insightsTitleTrue: {
        en: 'Secondary heating pump started',
        de: 'Sekundärpumpe Heizkreis gestartet',
        nl: 'Secundaire pomp verwarming gestart',
        fr: 'Pompe secondaire chauffage démarrée',
        sv: 'Sekundärpump värme startade',
      },
      insightsTitleFalse: {
        en: 'Secondary heating pump stopped',
        de: 'Sekundärpumpe Heizkreis gestoppt',
        nl: 'Secundaire pomp verwarming gestopt',
        fr: 'Pompe secondaire chauffage arrêtée',
        sv: 'Sekundärpump värme stannade',
      },
      preventTag: true,
    })],
  },
};

module.exports = {
  PATHS, FEATURES, YES_NO, createOnOffCapability,
};
