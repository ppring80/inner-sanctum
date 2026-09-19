'use strict';

const assert = require('assert');
require('./test-runtime-bootstrap.js');

const { applyEarlySeasonBaseline } = require('../netlify/functions/weekly-sage-def-leaderboard.js');

const teams = ['HOU', 'LAR', 'DEN', 'SEA', 'PHI', 'PIT', 'MIN', 'NE', 'JAX', 'LAC', 'BAL', 'KC'];
const population = teams.map((team, index) => ({
  playerID: team, name: team, team, position: 'DEF', sageScore: 100 - index
}));

// Reproduce one poor opener sending a strong baseline unit to the bottom.
population.find(row => row.team === 'LAR').sageScore = 1;
population.find(row => row.team === 'HOU').sageScore = 2;

const adpSnapshot = {
  evidenceType: 'tank01-adp-snapshot',
  players: teams.map((team, index) => ({
    name: `${team} Defense`, position: 'DEF', team, adp: 150 + index
  }))
};

const result = applyEarlySeasonBaseline({ population, adpSnapshot, week: 2 });
assert.strictEqual(result.applied, true);
assert.strictEqual(result.baselineWeight, 0.90);
assert.strictEqual(result.matched, teams.length);
const houston = population.find(row => row.team === 'HOU');
const kansasCity = population.find(row => row.team === 'KC');
assert.strictEqual(houston.baseline.positionRank, 1);
assert.ok(houston.rankingScore > kansasCity.rankingScore,
  'one poor game must not erase the early-season DEF baseline');

const weekFive = population.map(row => ({ ...row, baseline: undefined, rankingScore: undefined }));
assert.strictEqual(applyEarlySeasonBaseline({
  population: weekFive, adpSnapshot, week: 5
}).applied, false);

console.log('weekly-sage-def-early-baseline.test.js passed');
