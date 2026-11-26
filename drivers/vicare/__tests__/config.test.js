/* eslint-env jest */

'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const registry = require('./registry.json');

describe('Config funktioner', () => {
  // Testa varje feature och dess capabilities
  describe('Features och Capabilities', () => {
    const expectedFeatures = {
      'heating.dhw.sensors.temperature.dhwCylinder': {
        capabilities: [{
          capabilityName: 'measure_temperature.hotWater',
          propertyPath: 'value.value',
          capabilityOptions: {
            title: { en: 'Hot water temperature' },
            units: '°C',
            decimals: 1,
            preventInsights: false,
            preventTag: false,
          },
        }],
      },
      'heating.dhw.temperature.main': {
        capabilities: [{
          capabilityName: 'target_temperature.hotWater',
          propertyPath: 'value.value',
          command: {
            name: 'setTargetTemperature',
            parameterMapping: {
              value: 'temperature',
            },
          },
          capabilityOptions: {
            title: { en: 'Hot water Normal' },
            units: '°C',
            min: 10,
            max: 60,
            step: 1,
            preventInsights: true,
          },
        }],
      },
      'heating.dhw.temperature.temp2': {
        capabilities: [{
          capabilityName: 'target_temperature.hotWater2',
          propertyPath: 'value.value',
          command: {
            name: 'setTargetTemperature',
            parameterMapping: {
              value: 'temperature',
            },
          },
          capabilityOptions: {
            title: { en: 'Hot water Temp 2' },
            units: '°C',
            min: 10,
            max: 60,
            step: 1,
            preventInsights: true,
          },
        }],
      },
      'heating.circuits.0.operating.programs.normal': {
        capabilities: [{
          capabilityName: 'target_temperature.heating',
          propertyPath: 'temperature.value',
          command: {
            name: 'setTemperature',
            parameterMapping: {
              value: 'targetTemperature',
            },
          },
          capabilityOptions: {
            title: { en: 'Heating thermostat' },
            units: '°C',
            min: 10,
            max: 30,
            step: 1,
            preventInsights: true,
            uiComponent: null,
          },
        }, {
          capabilityName: 'target_temperature',
          propertyPath: 'temperature.value',
          command: {
            name: 'setTemperature',
            parameterMapping: {
              value: 'targetTemperature',
            },
          },
          capabilityOptions: {
            title: {
              en: 'Room target temperature',
              de: 'Raum-Solltemperatur',
              nl: 'Gewenste kamertemperatuur',
              fr: 'Température ambiante souhaitée',
              sv: 'Önskad rumstemperatur',
            },
            units: '°C',
            min: 10,
            max: 30,
            step: 1,
            preventInsights: true,
          },
        }],
      },
      'heating.dhw.oneTimeCharge': {
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
      'heating.circuits.0.operating.modes.active': {
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
            values: [
              {
                id: 'dhw',
                title: {
                  en: 'Hot water', de: 'Warmwasser', nl: 'Warm water', fr: 'Eau chaude', sv: 'Varmvatten',
                },
              },
              {
                id: 'dhwAndHeating',
                title: {
                  en: 'Hot water and heating', de: 'Warmwasser und Heizung', nl: 'Warm water en verwarming', fr: 'Eau chaude et chauffage', sv: 'Varmvatten och värme',
                },
              },
              {
                id: 'heating',
                title: {
                  en: 'Heating', de: 'Heizung', nl: 'Verwarming', fr: 'Chauffage', sv: 'Värme',
                },
              },
              {
                id: 'standby',
                title: {
                  en: 'Standby', de: 'Standby', nl: 'Stand-by', fr: 'Veille', sv: 'Standby',
                },
              },
            ],
            preventInsights: true,
          },
        }],
      },
      'heating.sensors.temperature.return': {
        capabilities: [{
          capabilityName: 'measure_temperature.return',
          propertyPath: 'value.value',
          capabilityOptions: {
            title: { en: 'Heating return temperature' },
            units: '°C',
            decimals: 1,
            preventInsights: false,
            preventTag: false,
          },
        }],
      },
      'heating.sensors.temperature.outside': {
        capabilities: [{
          capabilityName: 'measure_temperature.outside',
          propertyPath: 'value.value',
          capabilityOptions: {
            title: { en: 'Outside temperature' },
            units: '°C',
            decimals: 1,
            preventInsights: false,
            preventTag: false,
          },
        }],
      },
      'heating.compressors.0': {
        requireRole: 'type:heatpump',
        capabilities: [{
          capabilityName: 'measure_compressor_active',
          propertyPath: 'active.value',
          capabilityOptions: {
            title: { en: 'Compressor running' },
            titleTrue: {
              en: 'Yes', de: 'Ja', nl: 'Ja', fr: 'Oui', sv: 'Ja',
            },
            titleFalse: {
              en: 'No', de: 'Nein', nl: 'Nee', fr: 'Non', sv: 'Nej',
            },
            insightsTitleTrue: {
              en: 'Compressor started', de: 'Verdichter gestartet', nl: 'Compressor gestart', fr: 'Compresseur démarré', sv: 'Kompressorn startade',
            },
            insightsTitleFalse: {
              en: 'Compressor stopped', de: 'Verdichter gestoppt', nl: 'Compressor gestopt', fr: 'Compresseur arrêté', sv: 'Kompressorn stannade',
            },
            preventInsights: false,
            preventTag: false,
          },
        }],
      },
      'heating.compressors.0.statistics': {
        requireRole: 'type:heatpump',
        capabilities: [
          {
            capabilityName: 'measure_compressor_number.compressorHours',
            propertyPath: 'hours.value',
            capabilityOptions: {
              title: { en: 'Compressor runtime' },
              units: 'h',
              preventInsights: false,
              preventTag: true,
            },
          },
          {
            capabilityName: 'measure_compressor_number.compressorStarts',
            propertyPath: 'starts.value',
            capabilityOptions: {
              title: { en: 'Compressor starts' },
              units: {
                en: 'starts', de: 'Starts', nl: 'starts', fr: 'démarrages', sv: 'starter',
              },
              decimals: 0,
              preventInsights: false,
              preventTag: true,
            },
          },
          {
            capabilityName: 'measure_compressor_number.compressorStartsToday',
            propertyPath: 'starts.value',
            computed: 'startsToday',
            capabilityOptions: {
              title: {
                en: 'Compressor starts today',
                de: 'Verdichterstarts heute',
                nl: 'Compressorstarts vandaag',
                fr: 'Démarrages du compresseur aujourd\'hui',
                sv: 'Kompressorstarter i dag',
              },
              units: {
                en: 'starts',
                de: 'Starts',
                nl: 'starts',
                fr: 'démarrages',
                sv: 'starter',
              },
              decimals: 0,
              preventInsights: false,
              preventTag: false,
            },
          },
          {
            capabilityName: 'measure_compressor_number.compressorStartsYesterday',
            propertyPath: 'starts.value',
            computed: 'startsYesterday',
            capabilityOptions: {
              title: {
                en: 'Compressor starts yesterday',
                de: 'Verdichterstarts gestern',
                nl: 'Compressorstarts gisteren',
                fr: 'Démarrages du compresseur hier',
                sv: 'Kompressorstarter i går',
              },
              units: {
                en: 'starts',
                de: 'Starts',
                nl: 'starts',
                fr: 'démarrages',
                sv: 'starter',
              },
              decimals: 0,
              preventInsights: false,
              preventTag: false,
            },
          },
          {
            capabilityName: 'measure_compressor_number.compressorStartsLastHour',
            propertyPath: 'starts.value',
            computed: 'startsLastHour',
            capabilityOptions: {
              title: {
                en: 'Compressor starts in the last hour',
                de: 'Verdichterstarts in der letzten Stunde',
                nl: 'Compressorstarts in het afgelopen uur',
                fr: 'Démarrages du compresseur dans la dernière heure',
                sv: 'Kompressorstarter senaste timmen',
              },
              units: {
                en: 'starts',
                de: 'Starts',
                nl: 'starts',
                fr: 'démarrages',
                sv: 'starter',
              },
              decimals: 0,
              preventInsights: false,
              preventTag: false,
            },
          },
          {
            capabilityName: 'measure_compressor_number.compressorRuntimePerStartYesterday',
            propertyPath: 'hours.value',
            computed: 'runtimePerStartYesterday',
            capabilityOptions: {
              title: {
                en: 'Compressor run time per start yesterday',
                de: 'Verdichterlaufzeit pro Start gestern',
                nl: 'Compressorlooptijd per start gisteren',
                fr: 'Durée de marche du compresseur par démarrage hier',
                sv: 'Kompressorns gångtid per start i går',
              },
              units: 'min',
              decimals: 0,
              preventInsights: false,
              preventTag: false,
            },
          },
        ],
      },
      'heating.burners.0': {
        capabilities: [{
          capabilityName: 'measure_burner_active',
          propertyPath: 'active.value',
          capabilityOptions: {
            title: { en: 'Burner running' },
            titleTrue: {
              en: 'Yes', de: 'Ja', nl: 'Ja', fr: 'Oui', sv: 'Ja',
            },
            titleFalse: {
              en: 'No', de: 'Nein', nl: 'Nee', fr: 'Non', sv: 'Nej',
            },
            insightsTitleTrue: {
              en: 'Burner started', de: 'Brenner gestartet', nl: 'Brander gestart', fr: 'Brûleur démarré', sv: 'Brännaren startade',
            },
            insightsTitleFalse: {
              en: 'Burner stopped', de: 'Brenner gestoppt', nl: 'Brander gestopt', fr: 'Brûleur arrêté', sv: 'Brännaren stannade',
            },
            preventInsights: false,
            preventTag: false,
          },
        }],
      },
      'heating.burners.0.statistics': {
        capabilities: [
          {
            capabilityName: 'measure_burner_number.burnerHours',
            propertyPath: 'hours.value',
            capabilityOptions: {
              title: { en: 'Burner runtime' },
              units: 'h',
              preventInsights: false,
              preventTag: true,
            },
          },
          {
            capabilityName: 'measure_burner_number.burnerStarts',
            propertyPath: 'starts.value',
            capabilityOptions: {
              title: { en: 'Burner starts' },
              units: {
                en: 'starts', de: 'Starts', nl: 'starts', fr: 'démarrages', sv: 'starter',
              },
              decimals: 0,
              preventInsights: false,
              preventTag: true,
            },
          },
          {
            capabilityName: 'measure_burner_number.burnerStartsToday',
            propertyPath: 'starts.value',
            computed: 'startsToday',
            capabilityOptions: {
              title: {
                en: 'Burner starts today',
                de: 'Brennerstarts heute',
                nl: 'Branderstarts vandaag',
                fr: 'Démarrages du brûleur aujourd\'hui',
                sv: 'Brännarstarter i dag',
              },
              units: {
                en: 'starts',
                de: 'Starts',
                nl: 'starts',
                fr: 'démarrages',
                sv: 'starter',
              },
              decimals: 0,
              preventInsights: false,
              preventTag: false,
            },
          },
          {
            capabilityName: 'measure_burner_number.burnerStartsYesterday',
            propertyPath: 'starts.value',
            computed: 'startsYesterday',
            capabilityOptions: {
              title: {
                en: 'Burner starts yesterday',
                de: 'Brennerstarts gestern',
                nl: 'Branderstarts gisteren',
                fr: 'Démarrages du brûleur hier',
                sv: 'Brännarstarter i går',
              },
              units: {
                en: 'starts',
                de: 'Starts',
                nl: 'starts',
                fr: 'démarrages',
                sv: 'starter',
              },
              decimals: 0,
              preventInsights: false,
              preventTag: false,
            },
          },
          {
            capabilityName: 'measure_burner_number.burnerStartsLastHour',
            propertyPath: 'starts.value',
            computed: 'startsLastHour',
            capabilityOptions: {
              title: {
                en: 'Burner starts in the last hour',
                de: 'Brennerstarts in der letzten Stunde',
                nl: 'Branderstarts in het afgelopen uur',
                fr: 'Démarrages du brûleur dans la dernière heure',
                sv: 'Brännarstarter senaste timmen',
              },
              units: {
                en: 'starts',
                de: 'Starts',
                nl: 'starts',
                fr: 'démarrages',
                sv: 'starter',
              },
              decimals: 0,
              preventInsights: false,
              preventTag: false,
            },
          },
          {
            capabilityName: 'measure_burner_number.burnerRuntimePerStartYesterday',
            propertyPath: 'hours.value',
            computed: 'runtimePerStartYesterday',
            capabilityOptions: {
              title: {
                en: 'Burner run time per start yesterday',
                de: 'Brennerlaufzeit pro Start gestern',
                nl: 'Branderlooptijd per start gisteren',
                fr: 'Durée de marche du brûleur par démarrage hier',
                sv: 'Brännarens gångtid per start i går',
              },
              units: 'min',
              decimals: 0,
              preventInsights: false,
              preventTag: false,
            },
          },
        ],
      },
      'fuelCell.statistics': {
        capabilities: [
          {
            capabilityName: 'measure_fuelcell_number.operationHours',
            propertyPath: 'operationHours.value',
            capabilityOptions: {
              title: { en: 'Fuel cell operation hours' },
              units: 'h',
              preventInsights: false,
              preventTag: true,
            },
          },
          {
            capabilityName: 'measure_fuelcell_number.productionHours',
            propertyPath: 'productionHours.value',
            capabilityOptions: {
              title: { en: 'Fuel cell production hours' },
              units: 'h',
              preventInsights: false,
              preventTag: true,
            },
          },
          {
            capabilityName: 'measure_fuelcell_number.productionStarts',
            propertyPath: 'productionStarts.value',
            capabilityOptions: {
              title: { en: 'Fuel cell starts' },
              units: {
                en: 'starts', de: 'Starts', nl: 'starts', fr: 'démarrages', sv: 'starter',
              },
              decimals: 0,
              preventInsights: false,
              preventTag: true,
            },
          },
        ],
      },
      'heating.burners.0.modulation': {
        capabilities: [{
          capabilityName: 'measure_burner_number.burnerModulation',
          propertyPath: 'value.value',
          capabilityOptions: {
            title: { en: 'Burner modulation' },
            units: '%',
            preventInsights: false,
            preventTag: true,
          },
        }],
      },
      'heating.compressors.0.sensors.power': {
        requireRole: 'type:heatpump',
        capabilities: [{
          capabilityName: 'measure_compressor_number.compressorModulation',
          propertyPath: 'value.value',
          capabilityOptions: {
            title: { en: 'Compressor load' },
            units: '%',
            preventInsights: false,
            preventTag: true,
          },
        }],
      },
      'heating.cop.total': {
        capabilities: [{
          capabilityName: 'measure_cop_number.total',
          propertyPath: 'value.value',
          capabilityOptions: {
            title: { en: 'COP total' },
            decimals: 1,
            preventInsights: false,
            preventTag: false,
          },
        }],
      },
      'heating.cop.heating': {
        capabilities: [{
          capabilityName: 'measure_cop_number.heating',
          propertyPath: 'value.value',
          capabilityOptions: {
            title: { en: 'COP heating' },
            decimals: 1,
            preventInsights: false,
            preventTag: false,
          },
        }],
      },
      'heating.cop.dhw': {
        capabilities: [{
          capabilityName: 'measure_cop_number.dhw',
          propertyPath: 'value.value',
          capabilityOptions: {
            title: { en: 'COP hot water' },
            decimals: 1,
            preventInsights: false,
            preventTag: false,
          },
        }],
      },
      'heating.bufferCylinder.sensors.temperature.main': {
        capabilities: [{
          capabilityName: 'measure_temperature.buffer',
          propertyPath: 'value.value',
          capabilityOptions: {
            title: { en: 'Buffer cylinder temperature' },
            units: '°C',
            decimals: 1,
            preventInsights: false,
            preventTag: false,
          },
        }],
      },
      'heating.bufferCylinder.sensors.temperature.top': {
        fallbackFor: 'heating.bufferCylinder.sensors.temperature.main',
        capabilities: [{
          capabilityName: 'measure_temperature.buffer',
          propertyPath: 'value.value',
          capabilityOptions: {
            title: { en: 'Buffer cylinder temperature' },
            units: '°C',
            decimals: 1,
            preventInsights: false,
            preventTag: false,
          },
        }],
      },
      'heating.primaryCircuit.sensors.temperature.supply': {
        capabilities: [{
          capabilityName: 'measure_temperature.supply',
          propertyPath: 'value.value',
          capabilityOptions: {
            title: { en: 'Primary supply temperature' },
            units: '°C',
            decimals: 1,
            preventInsights: false,
            preventTag: true,
          },
        }],
      },
      'heating.primaryCircuit.sensors.temperature.return': {
        capabilities: [{
          capabilityName: 'measure_temperature.primaryReturn',
          propertyPath: 'value.value',
          capabilityOptions: {
            title: { en: 'Primary return temperature' },
            units: '°C',
            decimals: 1,
            preventInsights: false,
            preventTag: true,
          },
        }],
      },
      'heating.secondaryCircuit.sensors.temperature.supply': {
        capabilities: [{
          capabilityName: 'measure_temperature.secondarySupply',
          propertyPath: 'value.value',
          capabilityOptions: {
            title: { en: 'Secondary supply temperature' },
            units: '°C',
            decimals: 1,
            preventInsights: false,
            preventTag: true,
          },
        }],
      },
      'heating.circuits.0.temperature': {
        capabilities: [{
          capabilityName: 'measure_temperature.circuit0',
          propertyPath: 'value.value',
          capabilityOptions: {
            title: { en: 'Heating circuit target temperature' },
            units: '°C',
            decimals: 1,
            preventInsights: false,
            preventTag: true,
          },
        }],
      },
      'heating.boiler.sensors.temperature.commonSupply': {
        requireRole: 'type:boiler',
        capabilities: [{
          capabilityName: 'measure_temperature.boilerCommonSupply',
          propertyPath: 'value.value',
          capabilityOptions: {
            title: { en: 'Boiler Exit Temperature' },
            units: '°C',
            decimals: 1,
            preventInsights: false,
            preventTag: true,
          },
        }],
      },
      'heating.boiler.sensors.temperature.main': {
        requireRole: 'type:boiler',
        capabilities: [{
          capabilityName: 'measure_temperature.boiler_main',
          propertyPath: 'value.value',
          capabilityOptions: {
            title: { en: 'Boiler Main Temperature' },
            units: '°C',
            decimals: 1,
            preventTag: false,
            preventInsights: false,
          },
        }],
      },
      'heating.circuits.0.sensors.temperature.supply': {
        capabilities: [{
          capabilityName: 'measure_temperature.circuit0_supply',
          propertyPath: 'value.value',
          capabilityOptions: {
            title: { en: 'Heating Circuit Supply Temperature' },
            units: '°C',
            decimals: 1,
            preventInsights: false,
            preventTag: true,
          },
        }],
      },
      'heating.circuits.0.sensors.temperature.room': {
        capabilities: [{
          capabilityName: 'measure_temperature.circuit0_room',
          propertyPath: 'value.value',
          capabilityOptions: {
            title: { en: 'Room Temperature' },
            units: '°C',
            decimals: 1,
            preventInsights: false,
            preventTag: false,
          },
        }],
      },
      // The heating set point on newer devices: the same capabilities as the normal program
      'heating.circuits.0.operating.programs.normalHeating': {
        fallbackFor: 'heating.circuits.0.operating.programs.normal',
        capabilities: 'same as heating.circuits.0.operating.programs.normal',
      },
      'heating.circuits.0.operating.programs.active': {
        capabilities: [],
      },
      'heating.circuits.0.operating.programs.reduced': {
        capabilities: [{
          capabilityName: 'target_temperature.heatingReduced',
          propertyPath: 'temperature.value',
          command: { name: 'setTemperature', parameterMapping: { value: 'targetTemperature' } },
          capabilityOptions: {
            title: {
              en: 'Reduced temperature', de: 'Reduzierte Temperatur', nl: 'Verlaagde temperatuur', fr: 'Température réduite', sv: 'Sänkt temperatur',
            },
            units: '°C',
            min: 10,
            max: 30,
            step: 1,
            preventInsights: true,
          },
        }],
      },
      'heating.circuits.0.operating.programs.comfort': {
        capabilities: [{
          capabilityName: 'target_temperature.heatingComfort',
          propertyPath: 'temperature.value',
          command: { name: 'setTemperature', parameterMapping: { value: 'targetTemperature' } },
          capabilityOptions: {
            title: {
              en: 'Comfort temperature', de: 'Komforttemperatur', nl: 'Comforttemperatuur', fr: 'Température confort', sv: 'Komforttemperatur',
            },
            units: '°C',
            min: 10,
            max: 30,
            step: 1,
            preventInsights: true,
          },
        }],
      },
      'heating.circuits.0.operating.programs.reducedHeating': {
        fallbackFor: 'heating.circuits.0.operating.programs.reduced',
        capabilities: 'same as heating.circuits.0.operating.programs.reduced',
      },
      'heating.circuits.0.operating.programs.comfortHeating': {
        fallbackFor: 'heating.circuits.0.operating.programs.comfort',
        capabilities: 'same as heating.circuits.0.operating.programs.comfort',
      },
      'heating.operating.programs.holiday': {
        capabilities: [{
          capabilityName: 'measure_holiday_active',
          propertyPath: 'active.value',
          capabilityOptions: {
            title: {
              en: 'Holiday program', de: 'Urlaubsprogramm', nl: 'Vakantieprogramma', fr: 'Programme vacances', sv: 'Semesterprogram',
            },
            titleTrue: {
              en: 'Active', de: 'Aktiv', nl: 'Actief', fr: 'Actif', sv: 'Aktivt',
            },
            titleFalse: {
              en: 'Off', de: 'Aus', nl: 'Uit', fr: 'Arrêt', sv: 'Av',
            },
            insightsTitleTrue: {
              en: 'Holiday program started',
              de: 'Urlaubsprogramm gestartet',
              nl: 'Vakantieprogramma gestart',
              fr: 'Programme vacances démarré',
              sv: 'Semesterprogrammet startade',
            },
            insightsTitleFalse: {
              en: 'Holiday program ended',
              de: 'Urlaubsprogramm beendet',
              nl: 'Vakantieprogramma beëindigd',
              fr: 'Programme vacances terminé',
              sv: 'Semesterprogrammet slutade',
            },
            preventInsights: false,
            preventTag: false,
          },
        }],
      },
      'heating.dhw.operating.modes.active': {
        capabilities: [{
          capabilityName: 'thermostat_mode.hotWater',
          propertyPath: 'value.value',
          command: { name: 'setMode', parameterMapping: { value: 'mode' } },
          capabilityOptions: {
            title: {
              en: 'Hot water mode', de: 'Warmwassermodus', nl: 'Warmwatermodus', fr: 'Mode eau chaude', sv: 'Varmvattenläge',
            },
            values: [
              {
                id: 'eco',
                title: {
                  en: 'Eco', de: 'Eco', nl: 'Eco', fr: 'Éco', sv: 'Eko',
                },
              },
              {
                id: 'efficient',
                title: {
                  en: 'Efficient', de: 'Effizient', nl: 'Efficiënt', fr: 'Efficace', sv: 'Effektiv',
                },
              },
              {
                id: 'efficientWithMinComfort',
                title: {
                  en: 'Efficient, min. comfort',
                  de: 'Effizient, min. Komfort',
                  nl: 'Efficiënt, min. comfort',
                  fr: 'Efficace, confort min.',
                  sv: 'Effektiv, min. komfort',
                },
              },
              {
                id: 'balanced',
                title: {
                  en: 'Balanced', de: 'Ausgewogen', nl: 'Gebalanceerd', fr: 'Équilibré', sv: 'Balanserad',
                },
              },
              {
                id: 'comfort',
                title: {
                  en: 'Comfort', de: 'Komfort', nl: 'Comfort', fr: 'Confort', sv: 'Komfort',
                },
              },
              {
                id: 'off',
                title: {
                  en: 'Off', de: 'Aus', nl: 'Uit', fr: 'Arrêt', sv: 'Av',
                },
              },
            ],
            preventInsights: true,
          },
        }],
      },
      'heating.dhw.temperature.hysteresis': {
        capabilities: [{
          capabilityName: 'target_hysteresis.hotWater',
          propertyPath: 'value.value',
          command: { name: 'setHysteresis', parameterMapping: { value: 'hysteresis' } },
          capabilityOptions: {
            title: {
              en: 'Hot water hysteresis', de: 'Warmwasser-Hysterese', nl: 'Warmwaterhysterese', fr: 'Hystérésis eau chaude', sv: 'Varmvattenhysteres',
            },
            units: 'K',
            decimals: 1,
            min: 1,
            max: 10,
            step: 0.5,
            preventInsights: true,
          },
        }],
      },
      'device.messages.errors.raw': {
        alwaysAdd: true,
        capabilities: [
          {
            capabilityName: 'alarm_problem',
            propertyPath: 'entries.value',
            computed: 'problem',
            capabilityOptions: {
              title: {
                en: 'Problem',
                de: 'Problem',
                nl: 'Probleem',
                fr: 'Problème',
                sv: 'Problem',
              },
              preventInsights: false,
              preventTag: false,
            },
          },
          {
            capabilityName: 'button.refreshFeatures',
            propertyPath: 'entries.value',
            computed: 'action',
            capabilityOptions: {
              maintenanceAction: true,
              title: {
                en: 'Refresh Viessmann features',
                de: 'Viessmann-Funktionen neu einlesen',
                nl: 'Viessmann-functies opnieuw inlezen',
                fr: 'Relire les fonctions Viessmann',
                sv: 'Läs in Viessmann-funktioner igen',
              },
              desc: {
                en: 'Reads the datapoints of your heating system from Viessmann again and adds values it reports now. Nothing is removed. Uses a few API calls.',
                de: 'Liest die Datenpunkte deiner Heizung erneut von Viessmann und ergänzt Werte, die sie jetzt meldet. Es wird nichts entfernt. Verbraucht einige API-Aufrufe.',
                nl: 'Leest de datapunten van je verwarming opnieuw bij Viessmann in en voegt waarden toe die ze nu meldt. Er wordt niets verwijderd. Gebruikt enkele API-aanroepen.',
                fr: 'Relit les points de données de votre chauffage chez Viessmann et ajoute les valeurs qu\'il signale maintenant. Rien n\'est supprimé. Utilise quelques appels API.',
                sv: 'Läser in värmesystemets datapunkter från Viessmann igen och lägger till värden som det rapporterar nu. Inget tas bort. Använder några API-anrop.',
              },
            },
          },
        ],
      },
      'fuelCell.errors.raw': {
        capabilities: [],
      },
      'device.messages.logbook': {
        capabilities: [],
      },
      'heating.power.consumption.current': {
        capabilities: [
          {
            capabilityName: 'measure_power',
            propertyPath: 'value.value',
            computed: 'power',
            capabilityOptions: {
              title: {
                en: 'Power consumption',
                de: 'Leistungsaufnahme',
                nl: 'Opgenomen vermogen',
                fr: 'Puissance consommée',
                sv: 'Effektförbrukning',
              },
              units: 'W',
              decimals: 0,
              preventInsights: false,
              preventTag: false,
            },
          },
        ],
      },
      'heating.inverters.0.sensors.power.output': {
        fallbackFor: 'heating.power.consumption.current',
        capabilities: [
          {
            capabilityName: 'measure_power',
            propertyPath: 'value.value',
            computed: 'power',
            capabilityOptions: {
              title: {
                en: 'Power consumption',
                de: 'Leistungsaufnahme',
                nl: 'Opgenomen vermogen',
                fr: 'Puissance consommée',
                sv: 'Effektförbrukning',
              },
              units: 'W',
              decimals: 0,
              preventInsights: false,
              preventTag: false,
            },
          },
        ],
      },
      'heating.power.consumption.total': {
        capabilities: [
          {
            capabilityName: 'measure_electricity_yesterday.total',
            propertyPath: 'day.value',
            computed: 'consumptionYesterday',
            capabilityOptions: {
              title: {
                en: 'Electricity yesterday (Viessmann)',
                de: 'Strom gestern (Viessmann)',
                nl: 'Stroom gisteren (Viessmann)',
                fr: 'Électricité hier (Viessmann)',
                sv: 'El i går (Viessmann)',
              },
              units: 'kWh',
              decimals: 1,
              preventInsights: false,
              preventTag: false,
            },
          },
        ],
      },
      'heating.power.consumption.heating': {
        capabilities: [
          {
            capabilityName: 'measure_electricity_yesterday.heating',
            propertyPath: 'day.value',
            computed: 'consumptionYesterday',
            capabilityOptions: {
              title: {
                en: 'Electricity yesterday, heating (Viessmann)',
                de: 'Strom gestern, Heizen (Viessmann)',
                nl: 'Stroom gisteren, verwarming (Viessmann)',
                fr: 'Électricité hier, chauffage (Viessmann)',
                sv: 'El i går, värme (Viessmann)',
              },
              units: 'kWh',
              decimals: 1,
              preventInsights: false,
              preventTag: false,
            },
          },
        ],
      },
      'heating.power.consumption.dhw': {
        capabilities: [
          {
            capabilityName: 'measure_electricity_yesterday.hotWater',
            propertyPath: 'day.value',
            computed: 'consumptionYesterday',
            capabilityOptions: {
              title: {
                en: 'Electricity yesterday, hot water (Viessmann)',
                de: 'Strom gestern, Warmwasser (Viessmann)',
                nl: 'Stroom gisteren, warm water (Viessmann)',
                fr: 'Électricité hier, eau chaude (Viessmann)',
                sv: 'El i går, varmvatten (Viessmann)',
              },
              units: 'kWh',
              decimals: 1,
              preventInsights: false,
              preventTag: false,
            },
          },
        ],
      },
      'heating.gas.consumption.total': {
        capabilities: [
          {
            capabilityName: 'measure_gas_yesterday.total',
            propertyPath: 'day.value',
            computed: 'consumptionYesterday',
            capabilityOptions: {
              title: {
                en: 'Gas yesterday (Viessmann)',
                de: 'Gas gestern (Viessmann)',
                nl: 'Gas gisteren (Viessmann)',
                fr: 'Gaz hier (Viessmann)',
                sv: 'Gas i går (Viessmann)',
              },
              units: 'm³',
              decimals: 1,
              preventInsights: false,
              preventTag: false,
            },
          },
        ],
      },
      'heating.gas.consumption.heating': {
        capabilities: [
          {
            capabilityName: 'measure_gas_yesterday.heating',
            propertyPath: 'day.value',
            computed: 'consumptionYesterday',
            capabilityOptions: {
              title: {
                en: 'Gas yesterday, heating (Viessmann)',
                de: 'Gas gestern, Heizen (Viessmann)',
                nl: 'Gas gisteren, verwarming (Viessmann)',
                fr: 'Gaz hier, chauffage (Viessmann)',
                sv: 'Gas i går, värme (Viessmann)',
              },
              units: 'm³',
              decimals: 1,
              preventInsights: false,
              preventTag: false,
            },
          },
        ],
      },
      'heating.gas.consumption.dhw': {
        capabilities: [
          {
            capabilityName: 'measure_gas_yesterday.hotWater',
            propertyPath: 'day.value',
            computed: 'consumptionYesterday',
            capabilityOptions: {
              title: {
                en: 'Gas yesterday, hot water (Viessmann)',
                de: 'Gas gestern, Warmwasser (Viessmann)',
                nl: 'Gas gisteren, warm water (Viessmann)',
                fr: 'Gaz hier, eau chaude (Viessmann)',
                sv: 'Gas i går, varmvatten (Viessmann)',
              },
              units: 'm³',
              decimals: 1,
              preventInsights: false,
              preventTag: false,
            },
          },
        ],
      },
    };
    // A fallback path with the capabilities of its main path
    for (const expected of Object.values(expectedFeatures)) {
      if (typeof expected.capabilities === 'string') expected.capabilities = expectedFeatures[expected.capabilities.replace('same as ', '')].capabilities;
    }

    Object.entries(expectedFeatures).forEach(([featurePath, expectedFeature]) => {
      describe(`Feature: ${featurePath}`, () => {
        test('har korrekt struktur och värden', () => {
          const actualFeature = config.FEATURES[featurePath];
          expect(actualFeature).toBeDefined();

          // Testa requireRole om det finns
          if (expectedFeature.requireRole) {
            expect(actualFeature.requireRole).toBe(expectedFeature.requireRole);
          }
          expect(actualFeature.fallbackFor).toBe(expectedFeature.fallbackFor);
          expect(actualFeature.alwaysAdd).toBe(expectedFeature.alwaysAdd);

          // Testa capabilities
          expect(actualFeature.capabilities).toHaveLength(expectedFeature.capabilities.length);

          expectedFeature.capabilities.forEach((expectedCapability, index) => {
            const actualCapability = actualFeature.capabilities[index];

            // Testa capabilityName
            expect(actualCapability.capabilityName).toBe(expectedCapability.capabilityName);

            // Testa propertyPath
            expect(actualCapability.propertyPath).toBe(expectedCapability.propertyPath);
            expect(actualCapability.computed).toBe(expectedCapability.computed);

            // Testa command om det finns
            if (expectedCapability.command) {
              expect(actualCapability.command).toEqual(expectedCapability.command);
            }

            // Testa valueMapping om det finns
            if (expectedCapability.valueMapping) {
              expect(actualCapability.valueMapping).toEqual(expectedCapability.valueMapping);
            }

            // Testa capabilityOptions
            expect(actualCapability.capabilityOptions).toEqual(expectedCapability.capabilityOptions);
          });
        });
      });
    });
  });

  // Behåll de ursprungliga hjälpfunktionstesterna
  describe('getCapability', () => {
    test('kastar ett fel för en ogiltig feature path', () => {
      expect(() => {
        config.getCapability('invalid.path');
      }).toThrow('No capability found for feature: invalid.path');
    });
  });

  describe('getAllCapabilities', () => {
    test('kastar ett fel för en ogiltig feature path', () => {
      expect(() => {
        config.getAllCapabilities('invalid.path');
      }).toThrow('No capabilities found for feature: invalid.path');
    });
  });

  describe('getCapabilityOptions', () => {
    test('kastar ett fel för en ogiltig capability', () => {
      expect(() => {
        config.getCapabilityOptions('invalid.capability');
      }).toThrow('No capability options found for: invalid.capability');
    });
  });
});

describe('Running state texts', () => {
  const CAPABILITIES_DIR = path.join(__dirname, '../../../.homeycompose/capabilities');
  const LANGUAGES = fs.readdirSync(path.join(__dirname, '../../../locales'))
    .filter((file) => file.endsWith('.json'))
    .map((file) => path.basename(file, '.json'));
  const RETIRED_BASES = new Set(Object.keys(registry.retiredCapabilities).map((id) => id.split('.')[0]));
  const TEXT_KEYS = ['titleTrue', 'titleFalse', 'insightsTitleTrue', 'insightsTitleFalse'];

  // The base capabilities of the boolean "running" states, without the retired ones
  const runningBases = fs.readdirSync(CAPABILITIES_DIR)
    .filter((file) => /^measure_\w+_active\.json$/.test(file))
    .map((file) => path.basename(file, '.json'))
    .filter((base) => !RETIRED_BASES.has(base));
  const definition = (base) => JSON.parse(fs.readFileSync(path.join(CAPABILITIES_DIR, `${base}.json`), 'utf8'));

  test('the app languages and the running capabilities are found', () => {
    expect(LANGUAGES.sort()).toEqual(['de', 'en', 'fr', 'nl', 'sv']);
    expect(runningBases.sort()).toEqual([
      'measure_burner_active', 'measure_compressor_active', 'measure_dhw_active', 'measure_frost_active',
      'measure_fuelcell_active', 'measure_heating_active', 'measure_holiday_active', 'measure_pump_active',
    ]);
  });

  test.each(runningBases)('%s is translated into every app language and names the change on the timeline', (base) => {
    const capability = definition(base);
    for (const key of TEXT_KEYS) {
      expect(Object.keys(capability[key]).sort()).toEqual([...LANGUAGES].sort());
      for (const text of Object.values(capability[key])) expect(text).toEqual(expect.any(String));
    }
    for (const key of ['insightsTitleTrue', 'insightsTitleFalse']) {
      expect(capability[key].en).not.toMatch(/^(Yes|No)$/);
    }
    // A program ends rather than stops; frost protection is switched on and off rather than started
    const [started, stopped] = {
      measure_holiday_active: [/ started$/, / ended$/],
      measure_frost_active: [/ on$/, / off$/],
    }[base] || [/ started$/, / stopped$/];
    expect(capability.insightsTitleTrue.en).toMatch(started);
    expect(capability.insightsTitleFalse.en).toMatch(stopped);
  });

  // The sub-capabilities of the new on/off states (pumps, frost protection, hot water charging)
  // name themselves on the timeline, in every app language
  const subStates = Object.values(config.FEATURES)
    .flatMap((feature) => feature.capabilities)
    .filter((capability) => /^measure_(pump|frost|dhw)_active\./.test(capability.capabilityName));

  test.each(subStates.map((capability) => [capability.capabilityName, capability.capabilityOptions]))(
    '%s has its title and timeline texts in every app language',
    (name, options) => {
      for (const key of ['title', ...TEXT_KEYS]) {
        expect([name, key, Object.keys(options[key]).sort()]).toEqual([name, key, [...LANGUAGES].sort()]);
      }
    },
  );

  const mappedRunningCapabilities = [...Object.values(config.FEATURES).flatMap((feature) => feature.capabilities), ...config.DERIVED]
    .filter((capability) => runningBases.includes(capability.capabilityName));

  test('the compressor, the burner, heating now and the holiday program are mapped', () => {
    expect(mappedRunningCapabilities.map((capability) => capability.capabilityName).sort())
      .toEqual(['measure_burner_active', 'measure_compressor_active', 'measure_heating_active',
        'measure_holiday_active']);
  });

  // Devices that already have the capability get the texts from config.js, new devices also
  // from the definition: both must show the same
  test.each(mappedRunningCapabilities.map((capability) => [capability.capabilityName, capability]))(
    '%s has the same texts in config.js as in its capability definition',
    (name, capability) => {
      const capabilityDefinition = definition(name.split('.')[0]);
      for (const key of TEXT_KEYS) expect(capability.capabilityOptions[key]).toEqual(capabilityDefinition[key]);
    },
  );
});

describe('Statistics counters', () => {
  const counters = Object.entries(config.FEATURES)
    .filter(([featurePath]) => /(^|\.)statistics$/.test(featurePath))
    .flatMap(([, feature]) => feature.capabilities)
    // The daily figures computed from the counters (computed) are tested in computedValues.test.js
    .filter((capability) => !capability.computed);

  test('are the starts and hours of the compressor, the burner and the fuel cell', () => {
    expect(counters.map((capability) => capability.capabilityName).sort()).toEqual([
      'measure_burner_number.burnerHours',
      'measure_burner_number.burnerStarts',
      'measure_compressor_number.compressorHours',
      'measure_compressor_number.compressorStarts',
      'measure_fuelcell_number.operationHours',
      'measure_fuelcell_number.productionHours',
      'measure_fuelcell_number.productionStarts',
    ]);
  });

  test.each(counters.map((capability) => [capability.capabilityName, capability.capabilityOptions]))(
    '%s is logged in Insights, without a Flow tag',
    (name, options) => {
      expect(options.preventInsights).toBe(false);
      expect(options.preventTag).toBe(true);
      if (/Hours$/.test(name)) {
        expect(options.units).toBe('h');
      } else {
        expect(options.decimals).toBe(0);
        expect(options.units.en).toBe('starts');
      }
    },
  );
});
