'use strict';

const assert = require('assert');
require('./test-runtime-bootstrap.js');

const {
  _test: {
    MAX_REGULAR_SEASON_GAMES_PER_WEEK,
    enforceWeeklyGameCeiling
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

const identity = {
  season: '2026',
  week: 1,
  seasonType: 'reg'
};

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
      NE: { team: 'NE' },
      NYJ: { team: 'NYJ' }
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

console.log('7 Weekly SAGE defense guardrail tests passed, 0 failed.');
