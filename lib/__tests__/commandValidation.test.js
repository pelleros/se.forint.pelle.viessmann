/* eslint-env jest */

'use strict';

const validate = require('../commandValidation');

const metadata = {
  feature: {
    setTemperature: { isExecutable: true, params: { temperature: { type: 'number', required: true, constraints: { min: 10, max: 60, stepping: 0.5 } } } },
    activate: { isExecutable: false },
    setMode: { isExecutable: true, params: { mode: { type: 'string', required: true, constraints: { enum: ['dhw', 'standby'] } } } },
  },
};

test.each([{}, { temperature: 9 }, { temperature: 61 }, { temperature: 20.2 }, { temperature: '20' }, { temperature: NaN }])('rejects invalid temperature parameters: %p', (body) => {
  expect(() => validate(metadata, 'feature', 'setTemperature', body)).toThrow();
});

test('accepts supported values and rejects unavailable, missing and unsupported commands', () => {
  expect(() => validate(metadata, 'feature', 'setTemperature', { temperature: 20.5 })).not.toThrow();
  expect(() => validate(metadata, 'feature', 'activate', {})).toThrow('currently unavailable');
  expect(() => validate(metadata, 'feature', 'unknown', {})).toThrow('not supported');
  expect(() => validate(metadata, 'feature', 'setMode', { mode: 'heating' })).toThrow('Unsupported');
});
