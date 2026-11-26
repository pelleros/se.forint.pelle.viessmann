/* eslint-env jest */

'use strict';

const {
  maskId, maskDeviceKey, maskText, maskForLog,
} = require('../logPrivacy');

test('maskId keeps the last three characters of long values', () => {
  expect(maskId('7633107000000001')).toBe('…001');
  expect(maskId(2345678)).toBe('…678');
  expect(maskId('0')).toBe('0');
  expect(maskId('gateway')).toBe('…way');
  expect(maskId(undefined)).toBe('undefined');
  expect(maskId('')).toBe('');
});

test('maskDeviceKey masks the installation id and gateway serial, not the device id', () => {
  expect(maskDeviceKey('2345678-7633107000000001-0')).toBe('…678-…001-0');
  expect(maskDeviceKey('2345678-7633107000000001-RoomControl-1')).toBe('…678-…001-RoomControl-1');
  expect(maskDeviceKey('unknown')).toBe('…own');
});

test('maskText masks ids in API URLs, client_id parameters and given values', () => {
  const url = 'GET https://api.example/iot/v2/features/installations/2345678/gateways/7633107000000001/devices/0/features?filter=a';
  expect(maskText(url)).toBe('GET https://api.example/iot/v2/features/installations/…678/gateways/…001/devices/0/features?filter=a');
  expect(maskText('client_id=abcdef123456&grant_type=refresh_token')).toBe('client_id=…456&grant_type=refresh_token');
  expect(maskText('Client ID abcdef123456 saved', ['abcdef123456'])).toBe('Client ID …456 saved');
});

test('maskForLog masks strings, error messages, arrays and plain objects', () => {
  const values = ['abcdef123456'];
  expect(maskForLog(new Error('abcdef123456 failed'), values)).toBe('…456 failed');
  expect(maskForLog(['/installations/2345678/x', 3], values)).toEqual(['/installations/…678/x', 3]);
  expect(maskForLog({ nested: { clientId: 'abcdef123456' } }, values)).toEqual({ nested: { clientId: '…456' } });
  const date = new Date(0);
  expect(maskForLog(date, values)).toBe(date);
});
