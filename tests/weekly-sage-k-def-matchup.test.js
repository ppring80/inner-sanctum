'use strict';

const assert = require('assert');
require('./test-runtime-bootstrap.js');

const { buildKMatchupEvidence } = require('../netlify/functions/weekly-sage-k-leaderboard.js');
const { buildDefMatchupEvidence } = require('../netlify/functions/weekly-sage-def-leaderboard.js');

const defenseSnapshot = {
  evidenceType: 'weekly-sage-def-snapshot',
  population: [
    { team: 'MIA', components: { scoringPrevention: { percentile: 25 } } },
    { team: 'PIT', components: { scoringPrevention: { percentile: 85 } } }
  ]
};

assert.deepStrictEqual(
  buildKMatchupEvidence('MIA', defenseSnapshot),
  { score: 75, signal: 'positive', label: 'Positive', source: 'opponent-scoring-prevention' }
);
assert.deepStrictEqual(
  buildKMatchupEvidence('PIT', defenseSnapshot),
  { score: 15, signal: 'strong_negative', label: 'Strong Negative', source: 'opponent-scoring-prevention' }
);
assert.strictEqual(buildKMatchupEvidence('BYE', defenseSnapshot), null);

assert.deepStrictEqual(
  buildDefMatchupEvidence({
    opponent: 'PIT',
    components: { opponentEnvironment: { percentile: 67 } }
  }),
  { score: 67, signal: 'positive', label: 'Positive', source: 'opponent-offensive-environment' }
);
assert.strictEqual(buildDefMatchupEvidence({ opponent: 'BYE', components: {} }), null);

console.log('Weekly SAGE K/DEF matchup ratings tests passed.');
