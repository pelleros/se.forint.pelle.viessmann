/* eslint-disable no-console */

'use strict';

const { restore } = require('./moveDocumentation');

console.log('Restoring documentation from backup...');
restore();
console.log('Done!');
