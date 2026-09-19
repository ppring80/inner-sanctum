'use strict';

const assert = require('assert');
require('./test-runtime-bootstrap.js');

const { applyEarlySeasonBaseline } = require('../netlify/functions/weekly-sage-k-leaderboard.js');

const names = [
  'Brandon Aubrey', 'Ka\'imi Fairbairn', 'Cameron Dicker', 'Cam Little',
  'Jason Myers', 'Tyler Loop', 'Evan McPherson', 'Jake Bates',
  'Chase McLaughlin', 'Cairo Santos', 'Harrison Butker', 'Will Reichard'
];
const population = names.map((name, index) => ({
  playerID: String(index + 1), name, position: 'K', sageScore: 100 - index
}));

// Reproduce a quiet opener pushing two established starters to the bottom.
population.find(row => row.name === 'Brandon Aubrey').sageScore = 2;
population.find(row => row.name === 'Cameron Dicker').sageScore = 3;

const adpSnapshot = {
  evidenceType: 'tank01-adp-snapshot',
  players: names.map((name, index) => ({
    playerID: String(index + 1), name, position: 'K', adp: 180 + index
  }))
};

const result = applyEarlySeasonBaseline({ population, adpSnapshot, week: 2 });
assert.strictEqual(result.applied, true);
assert.strictEqual(result.baselineWeight, 0.90);
assert.strictEqual(result.matched, names.length);
const aubrey = population.find(row => row.name === 'Brandon Aubrey');
const loop = population.find(row => row.name === 'Tyler Loop');
assert.strictEqual(aubrey.baseline.positionRank, 1);
assert.ok(aubrey.rankingScore > loop.rankingScore,
  'one quiet game must not push the established K1 below a mid-tier baseline kicker');

const unmatched = { playerID: 'new', name: 'New Kicker', position: 'K', sageScore: 99 };
const withUnmatched = [unmatched, ...population.map(row => ({ ...row }))];
applyEarlySeasonBaseline({ population: withUnmatched, adpSnapshot, week: 2 });
assert.ok(unmatched.baseline.expectedRank > 10,
  'an unmatched kicker must not bypass the guardrail on one-game evidence');

const weekFive = population.map(row => ({ ...row, baseline: undefined, rankingScore: undefined }));
assert.strictEqual(applyEarlySeasonBaseline({
  population: weekFive, adpSnapshot, week: 5
}).applied, false);

console.log('weekly-sage-k-early-baseline.test.js passed');
