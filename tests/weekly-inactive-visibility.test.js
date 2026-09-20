'use strict';

const assert = require('assert');
const { normalizeInactiveRows } = require('../netlify/functions/weekly-sage-rankings.js');

const rows = normalizeInactiveRows({
  inactive: [{
    name: 'Josh Jacobs', team: 'GB', status: 'COMMISSIONER_EXEMPT_NO_PLAY',
    reason: 'Not permitted to participate until removed from the list.',
    source: 'NFL Commissioner Exempt List'
  }]
}, 'RB');

assert.strictEqual(rows.length, 1);
assert.strictEqual(rows[0].position, 'RB');
assert.strictEqual(rows[0].eligibleForWeeklyRanking, false);
assert.strictEqual(rows[0].recommendation, 'INELIGIBLE');
assert.strictEqual(rows[0].sageTake, 'Not permitted to participate until removed from the list.');
assert.deepStrictEqual(normalizeInactiveRows({}, 'WR'), []);

console.log('Weekly inactive visibility tests passed.');
