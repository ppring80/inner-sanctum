'use strict';

const assert = require('assert');
require('./test-runtime-bootstrap.js');

const {
  _test: {
    MAX_REGULAR_SEASON_GAMES_PER_WEEK,
    enforceWeeklyGameCeiling,
    isCompletedGame
  }
} = require('../netlify/functions/weekly-sage-defense-week.js');

const {
  validateCompleteDefense
} = require('../netlify/functions/refresh-weekly-sage-defense.js');

assert.strictEqual(MAX_REGULAR_SEASON_GAMES_PER_WEEK, 16);
assert.doesNotThrow(() => enforceWeeklyGameCeiling({
  seasonType: 'reg',
  completedGames: new Array(16).fill({})
}));
assert.throws(
  () => enforceWeeklyGameCeiling({
    seasonType: 'reg',
    completedGames: new Array(17).fill({})
  }),
  /Defense safety stop: 17 completed regular-season games exceeds the weekly limit of 16/
);

assert.strictEqual(isCompletedGame({ gameStatus: 'Final' }), true);
assert.strictEqual(isCompletedGame({ gameStatus: 'Final/OT' }), true);
assert.strictEqual(isCompletedGame({ gameStatus: 'Completed' }), true);
assert.strictEqual(isCompletedGame({ gameStatus: 'Completed/OT' }), true);
assert.strictEqual(isCompletedGame({ gameStatus: 'In Progress' }), false);

const identity = {
  season: '2026',
  week: 1,
  seasonType: 'reg'
};

function defense(team) {
  return { team, games: 1,
    runDefense: { attemptsAllowed: 20, yardsAllowed: 80, touchdownsAllowed: 0 },
    passDefense: { attemptsAllowed: 30, completionsAllowed: 20, yardsAllowed: 220, touchdownsAllowed: 2, interceptions: 0, sacks: 1 },
    totalDefense: { yardsAllowed: 300, playsFaced: 51 }, pointsAllowed: { total: 14, gamesRepresented: 1 } };
}
function evidence(overrides = {}) {
  return {
    evidenceType: 'weekly-sage-defense-week',
    season: '2026',
    week: 1,
    seasonType: 'reg',
    schedule: {
      gamesReturned: 1,
      completedGames: 1,
      processedGames: 1
    },
    defenses: {
      NE: defense('NE'),
      NYJ: defense('NYJ')
    },
    gameResults: [{ status: 'processed' }],
    kickerEvidence: [],
    ...overrides
  };
}

assert.deepStrictEqual(
  validateCompleteDefense(evidence(), identity),
  []
);

assert.ok(
  validateCompleteDefense(
    evidence({
      schedule: {
        gamesReturned: 16,
        completedGames: 15,
        processedGames: 15
      },
      defenses: Object.fromEntries(
        Array.from({ length: 30 }, (_, index) => [
          `T${index}`,
          { team: `T${index}` }
        ])
      ),
      gameResults: new Array(15).fill({ status: 'processed' })
    }),
    identity
  ).includes('Not all returned games are complete: 15 of 16.')
);

assert.ok(
  validateCompleteDefense(
    evidence({
      schedule: {
        gamesReturned: 0,
        completedGames: 0,
        processedGames: 0
      },
      defenses: {},
      gameResults: []
    }),
    identity
  ).includes('No completed games were returned.')
);

assert.ok(
  validateCompleteDefense(
    evidence({ defenses: { NE: { team: 'NE' } } }),
    identity
  ).includes('Defense count mismatch: expected 2, got 1.')
);

assert.ok(
  validateCompleteDefense(
    evidence({ kickerEvidence: null }),
    identity
  ).includes('kickerEvidence is not an array.')
);

assert.ok(validateCompleteDefense(evidence({ defenses: { NE: { ...defense('NE'), runDefense: { ...defense('NE').runDefense, touchdownsAllowed: null } }, NYJ: defense('NYJ') } }), identity).includes('A defensive profile has missing or invalid required statistics.'));
console.log('14 Weekly SAGE defense guardrail tests passed, 0 failed.');
