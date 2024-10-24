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

/* eslint-disable */
module.exports = {
  CAPABILITIES: {
    COMPRESSOR_ACTIVE_MEASURE: { featureName: 'heating.compressors.0', capabilityName: 'measure_something_active.compressor', capabilityOptions: { title: { en: 'Compressor running' }, insights: true } },
    COMPRESSOR_HOURS_MEASURE: { featureName: 'heating.compressors.0.statistics', capabilityName: 'measure_something_number.compressorHours', capabilityOptions: { title: { en: 'Compressor runtime' }, units: 'hours' } },
    COMPRESSOR_STARTS_MEASURE: { featureName: 'heating.compressors.0.statistics', capabilityName: 'measure_something_number.compressorStarts', capabilityOptions: { title: { en: 'Compressor starts' }, units: 'times' } },
    HOT_WATER_ONE_TIME_CHARGE: { featureName: 'heating.dhw.oneTimeCharge', capabilityName: 'thermostat_mode.hotWaterOneTimeCharge', capabilityOptions: { title: { en: 'One time hot water charge' }, values: [{ id: 'activate', title: { en: 'Active' } }, { id: 'deactivate', title: { en: 'Inactive' } }] } },
    HOT_WATER_TARGET_TEMP: { featureName: 'heating.dhw.temperature.main', capabilityName: 'target_temperature.hotWater', capabilityOptions: { title: { en: 'Hot water thermostat' }, min: 10, max: 60, step: 1, insights: false, preventInsights: true } },
    HEATING_MODE: { featureName: 'heating.circuits.0.operating.modes.active', capabilityName: 'thermostat_mode.heating', capabilityOptions: { title: { en: 'Heating mode' }, values: [{ id: 'dhw', title: { en: 'Hot water' } }, { id: 'dhwAndHeating', title: { en: 'Hot water and Heating' } }, { id: 'standby', title: { en: 'Standby' } }] } },
    HEATING_TARGET_TEMP: { featureName: 'heating.circuits.0.operating.programs.normal', capabilityName: 'target_temperature.heating', capabilityOptions: { title: { en: 'Heating thermostat' }, min: 10, max: 30, step: 1, insights: false, preventInsights: true } },
    HOT_WATER_TEMP_MEASURE: { featureName: 'heating.dhw.sensors.temperature.hotWaterStorage', capabilityName: 'measure_temperature.hotWater', capabilityOptions: { title: { en: 'Hot water temperature' } } },
    OUTSIDE_TEMP_MEASURE: { featureName: 'heating.sensors.temperature.outside', capabilityName: 'measure_temperature.outside', capabilityOptions: { title: { en: 'Outside temperature' } } },
    /*
    BURNER_ACTIVE_MEASURE: { featureName: 'heating.burners.0', capabilityName: 'measure_something_active.burner', capabilityOptions: { title: { en: 'Burner active' }, insights: true } },
    BURNER_HOURS_MEASURE: { featureName: 'heating.burners.0.statistics', capabilityName: 'measure_something_number.burnerHours', capabilityOptions: { title: { en: 'Burner runtime' }, units: 'hours' } },
    BURNER_STARTS_MEASURE: { featureName: 'heating.burners.0.statistics', capabilityName: 'measure_something_number.burnerStarts', capabilityOptions: { title: { en: 'Burner starts' }, units: 'times' } },
    BURNER_MODULATION_MEASURE: { featureName: 'heating.burners.0.modulation', capabilityName: 'measure_something_number.burnerModulation', capabilityOptions: { title: { en: 'Burner modulation' }, units: '%', "insights": true, "preventInsights": false } },
    */
  },
};
