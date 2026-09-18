'use strict';

const assert = require('assert');

require('./test-runtime-bootstrap.js');

const {
  EXPECTED_NFL_TEAM_COUNT,
  validateCompleteSnapshot
} = require('../netlify/functions/refresh-def-snapshot.js');

const identity = {
  season: '2026',
  targetWeek: 2,
  seasonType: 'reg'
};

function teams(count = EXPECTED_NFL_TEAM_COUNT) {
  return Array.from({ length: count }, (_, index) => ({
    team: `T${String(index + 1).padStart(2, '0')}`,
    position: 'DEF'
  }));
}

function completeSnapshot(overrides = {}) {
  const population = overrides.population || teams();

  return {
    evidenceType: 'weekly-sage-def-snapshot',
    season: '2026',
    targetWeek: 2,
    seasonType: 'reg',
    population,
    populationSummary: {
      weeksScanned: 1,
      weeksWithEvidence: 1,
      teamsDiscovered: population.length
    },
    ...overrides
  };
}

assert.strictEqual(EXPECTED_NFL_TEAM_COUNT, 32);

assert.deepStrictEqual(
  validateCompleteSnapshot(completeSnapshot(), identity),
  []
);

assert.ok(
  validateCompleteSnapshot(
    completeSnapshot({
      population: [],
      populationSummary: {
        weeksScanned: 1,
        weeksWithEvidence: 1,
        teamsDiscovered: 0
      }
    }),
    identity
  ).includes('population is empty.')
);

assert.ok(
  validateCompleteSnapshot(completeSnapshot({ population: teams(31) }), identity)
    .includes('Regular-season DEF population must contain exactly 32 teams; got 31.')
);

const duplicatePopulation = teams();
duplicatePopulation[31] = { team: 'T01', position: 'DEF' };
assert.ok(
  validateCompleteSnapshot(
    completeSnapshot({ population: duplicatePopulation }),
    identity
  ).includes('population contains duplicate team identities.')
);

const invalidPopulation = teams();
invalidPopulation[0] = { team: 'T01', position: 'K' };
assert.ok(
  validateCompleteSnapshot(
    completeSnapshot({ population: invalidPopulation }),
    identity
  ).includes('1 population record(s) lack a valid team identity or DEF position.')
);

assert.ok(
  validateCompleteSnapshot(
    completeSnapshot({
      populationSummary: {
        weeksScanned: 1,
        weeksWithEvidence: 0,
        teamsDiscovered: 32
      }
    }),
    identity
  ).includes('Not every scanned week has cached defense evidence.')
);

assert.ok(
  validateCompleteSnapshot(
    completeSnapshot({
      populationSummary: {
        weeksScanned: 1,
        weeksWithEvidence: 1,
        teamsDiscovered: 31
      }
    }),
    identity
  ).includes('teamsDiscovered does not match the population size.')
);

console.log('7 Weekly SAGE DEF snapshot guardrail tests passed, 0 failed.');
