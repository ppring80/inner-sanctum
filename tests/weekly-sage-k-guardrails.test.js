'use strict';

const assert = require('assert');

// refresh-k-snapshot imports Netlify Blobs at module load. The repository's
// test bootstrap supplies the same lightweight mock used by other suites.
require('./test-runtime-bootstrap.js');

const {
  _test: {
    MAX_K_CANDIDATES,
    enforceKCandidateCeiling
  }
} = require('../netlify/functions/weekly-sage-k-snapshot.js');

const {
  validateCompleteSnapshot
} = require('../netlify/functions/refresh-k-snapshot.js');

const identity = {
  season: '2026',
  targetWeek: 2,
  seasonType: 'reg'
};

function completeSnapshot(overrides = {}) {
  return {
    evidenceType: 'weekly-sage-k-snapshot',
    season: '2026',
    targetWeek: 2,
    seasonType: 'reg',
    population: [{ playerID: 'k1', position: 'K' }],
    populationSummary: {
      weeksScanned: 1,
      weeksWithEvidence: 1
    },
    ...overrides
  };
}

assert.strictEqual(MAX_K_CANDIDATES, 48);
assert.doesNotThrow(() => enforceKCandidateCeiling(48));
assert.throws(
  () => enforceKCandidateCeiling(49),
  /K safety stop: 49 candidates exceeds the per-run limit of 48/
);

assert.deepStrictEqual(
  validateCompleteSnapshot(completeSnapshot(), identity),
  []
);

assert.ok(
  validateCompleteSnapshot(
    completeSnapshot({ population: [] }),
    identity
  ).includes('population is empty.')
);

assert.ok(
  validateCompleteSnapshot(
    completeSnapshot({
      populationSummary: {
        weeksScanned: 1,
        weeksWithEvidence: 0
      }
    }),
    identity
  ).includes('Not every scanned week has cached kicker evidence.')
);

console.log('6 Weekly SAGE K guardrail tests passed, 0 failed.');
