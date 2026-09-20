'use strict';

const assert = require('assert');
const {
  normalizeInactiveRows,
  applyCentralAvailability,
  hasGameStarted,
  removeStartedGames,
  weeklyRecommendation,
  scoringLabel,
  reconcileRankedRecommendations
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


const sundayNoonEastern = new Date('2026-09-20T16:00:00.000Z');
assert.strictEqual(hasGameStarted({ gameDate: '20260917', gameTime: '8:15p' }, sundayNoonEastern), true);
assert.strictEqual(hasGameStarted({ gameDate: '20260920', gameTime: '1:00p' }, sundayNoonEastern), false);
assert.strictEqual(hasGameStarted({ gameDate: '20260920', gameTime: '11:00a' }, sundayNoonEastern), true);
assert.strictEqual(hasGameStarted({ gameDate: '20260921', gameTime: '8:15 PM' }, sundayNoonEastern), false);

const weeklyPositions = {
  QB: [
    { name: 'Thursday QB', team: 'BUF', opponent: 'DET', rank: 1, gameDate: '20260917', gameTime: '8:15p' },
    { name: 'Sunday QB', rank: 2, gameDate: '20260920', gameTime: '1:00p' }
  ],
  RB: [{ name: 'Thursday RB', team: 'DET', rank: 1 }],
  WR: [], TE: [],
  K: [{ name: 'Thursday K', team: 'BUF', rank: 1 }],
  DEF: [
    { name: 'BUF', team: 'BUF', rank: 1 },
    { name: 'Future DEF', team: 'SEA', rank: 3, gameDate: '20260921', gameTime: '8:15p' }
  ]
};
const started = removeStartedGames(weeklyPositions, sundayNoonEastern);
assert.deepStrictEqual(started.map(row => row.name), ['Thursday QB', 'Thursday RB', 'Thursday K', 'BUF']);
assert.deepStrictEqual(weeklyPositions.QB.map(row => row.name), ['Sunday QB']);
assert.strictEqual(weeklyPositions.QB[0].rank, 1, 'remaining position board is renumbered');
assert.strictEqual(weeklyPositions.RB.length, 0);
assert.strictEqual(weeklyPositions.K.length, 0);
assert.strictEqual(weeklyPositions.DEF[0].rank, 1);


assert.strictEqual(weeklyRecommendation('QB', 5), 'START');
assert.strictEqual(weeklyRecommendation('QB', 13), 'SIT');
assert.strictEqual(weeklyRecommendation('WR', 8), 'START');
assert.strictEqual(weeklyRecommendation('WR', 30), 'FLEX');
assert.strictEqual(weeklyRecommendation('WR', 49), 'SIT');
assert.strictEqual(weeklyRecommendation('TE', 12), 'START');
assert.strictEqual(weeklyRecommendation('TE', 13), 'FLEX');
assert.strictEqual(weeklyRecommendation('DEF', 13), 'SIT');
assert.strictEqual(scoringLabel('half'), 'Half-PPR');

const verdictPositions = {
  QB: [{ name: 'QB One', recommendation: 'FLEX', role: { adjustedScore: 70 } }],
  RB: [],
  WR: [{ name: 'Star WR', recommendation: 'SIT', sage: { baseline: { applied: true, weight: 0.9 } }, role: { adjustedScore: 70 } }],
  TE: [], K: [], DEF: []
};
reconcileRankedRecommendations(verdictPositions, 'half');
assert.strictEqual(verdictPositions.QB[0].recommendation, 'START');
assert.strictEqual(verdictPositions.WR[0].recommendation, 'START');
assert.ok(verdictPositions.WR[0].sageTake.includes('Solid start'));
assert.ok(verdictPositions.WR[0].sageTake.includes('Half-PPR baseline'));

console.log('Weekly inactive visibility tests passed.');
