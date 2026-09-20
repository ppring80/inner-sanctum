'use strict';

const assert = require('assert');
const {
  normalizeInactiveRows,
  applyCentralAvailability
} = require('../netlify/functions/weekly-sage-rankings.js');

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

const positions = {
  QB: [], RB: [], TE: [], K: [], DEF: [],
  WR: [
    { playerID: '1', name: 'Out Receiver', position: 'WR', recommendation: 'FLEX' },
    { playerID: '2', name: 'Risk Receiver', position: 'WR', recommendation: 'START' },
    { playerID: '3', name: 'Healthy Receiver', position: 'WR', recommendation: 'START' }
  ]
};
const inactive = { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] };
const applied = applyCentralAvailability(positions, inactive, {
  available: true,
  players: {
    '1': { injury: { designation: 'Out', description: 'Hamstring' } },
    '2': { injury: { designation: 'Questionable', description: 'Ankle' } },
    '3': {}
  },
  byName: new Map()
});
assert.strictEqual(applied.length, 1);
assert.deepStrictEqual(positions.WR.map(row => row.name), ['Risk Receiver', 'Healthy Receiver']);
assert.strictEqual(positions.WR[0].injuryStatus, 'QUESTIONABLE');
assert.strictEqual(inactive.WR[0].name, 'Out Receiver');
assert.strictEqual(inactive.WR[0].recommendation, 'INELIGIBLE');
assert.strictEqual(positions.DEF.length, 0, 'Team DEF remains outside player injury enforcement.');

console.log('Weekly inactive visibility tests passed.');
