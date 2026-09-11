'use strict';

const assert = require('assert');
const {
  _test: {
    customerVerdict,
    buildCustomerRecommendations,
    summarizeCustomerRecommendations
  }
} = require('../netlify/functions/waiver-recommendations.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

function decision(overrides) {
  return {
    name: 'Available Receiver',
    position: 'WR',
    team: 'GB',
    availabilityStatus: 'FREE_AGENT',
    decision: {
      action: 'ADD',
      actionable: true,
      reasonCode: 'ROSTER_UPGRADE',
      reasons: ['Weekly SAGE: WR24', 'Ranks ahead of Roster Receiver (WR41)']
    },
    evidence: {
      sage: {
        position: 'WR',
        positionRank: 24,
        recommendation: 'START',
        opponent: 'CHI'
      },
      trend: { direction: 'RISER' },
      rosterImpact: {
        classification: 'UPGRADE',
        weakestComparable: {
          name: 'Roster Receiver',
          position: 'WR',
          team: 'NYJ'
        }
      },
      percentOwned: 38.4
    },
    ...overrides
  };
}

test('ADD becomes customer-facing ADD_NOW', () => {
  assert.strictEqual(customerVerdict(decision()), 'ADD_NOW');
});

test('similar value plus rising opportunity becomes STASH', () => {
  assert.strictEqual(
    customerVerdict(decision({
      decision: { action: 'WATCH', actionable: false },
      evidence: {
        ...decision().evidence,
        rosterImpact: { classification: 'SIMILAR' },
        trend: { direction: 'RISER' }
      }
    })),
    'STASH'
  );
});

test('similar value without rising opportunity stays WATCH', () => {
  assert.strictEqual(
    customerVerdict(decision({
      decision: { action: 'WATCH', actionable: false },
      evidence: {
        ...decision().evidence,
        rosterImpact: { classification: 'SIMILAR' },
        trend: null
      }
    })),
    'WATCH'
  );
});

test('PASS stays PASS even when trend is rising', () => {
  assert.strictEqual(
    customerVerdict(decision({
      decision: { action: 'PASS', actionable: false },
      evidence: {
        ...decision().evidence,
        rosterImpact: { classification: 'DOWNGRADE' },
        trend: { direction: 'RISER' }
      }
    })),
    'PASS'
  );
});

test('ADD NOW exposes conservative same-position swap candidate', () => {
  const result = buildCustomerRecommendations([decision()])[0];
  assert.strictEqual(result.verdict, 'ADD_NOW');
  assert.strictEqual(result.swapFor.name, 'Roster Receiver');
  assert.strictEqual(result.quickRead.weeklyRank, 'WR24');
});

test('recommendations sort ADD NOW then STASH then WATCH then REVIEW then PASS', () => {
  const items = buildCustomerRecommendations([
    decision({ name: 'Pass', decision: { action: 'PASS' } }),
    decision({ name: 'Review', decision: { action: 'REVIEW' } }),
    decision({
      name: 'Watch',
      decision: { action: 'WATCH' },
      evidence: { ...decision().evidence, trend: null }
    }),
    decision({
      name: 'Stash',
      decision: { action: 'WATCH' },
      evidence: { ...decision().evidence, trend: { direction: 'RISER' } }
    }),
    decision({ name: 'Add' })
  ]);

  assert.deepStrictEqual(
    items.map((item) => item.verdict),
    ['ADD_NOW', 'STASH', 'WATCH', 'REVIEW', 'PASS']
  );
});

test('summary counts customer-facing verdicts', () => {
  const items = buildCustomerRecommendations([
    decision({ name: 'Add' }),
    decision({
      name: 'Stash',
      decision: { action: 'WATCH' },
      evidence: { ...decision().evidence, trend: { direction: 'RISER' } }
    }),
    decision({ name: 'Pass', decision: { action: 'PASS' } })
  ]);
  const summary = summarizeCustomerRecommendations(items);
  assert.deepStrictEqual(
    { addNow: summary.addNow, stash: summary.stash, pass: summary.pass, total: summary.total },
    { addNow: 1, stash: 1, pass: 1, total: 3 }
  );
});

console.log(`\n${passed} waiver-recommendations tests passed.`);
