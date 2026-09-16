'use strict';

const assert = require('assert');
const {
  _test: { getCurrentNFLWeek }
} = require('../netlify/functions/refresh-weekly-sage-schedule.js');

assert.strictEqual(
  getCurrentNFLWeek(new Date('2026-09-14T23:59:59Z')),
  1,
  'the schedule writer must remain on Week 1 before Tuesday'
);
assert.strictEqual(
  getCurrentNFLWeek(new Date('2026-09-15T00:00:00Z')),
  2,
  'the schedule writer must advance with positional snapshots on Tuesday'
);
assert.strictEqual(
  getCurrentNFLWeek(new Date('2026-09-22T00:00:00Z')),
  3,
  'each later Tuesday must advance exactly one week'
);

console.log('Weekly SAGE schedule week alignment regression test passed.');
