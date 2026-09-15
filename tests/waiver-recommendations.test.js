'use strict';

const assert = require('assert');
const {
  _test: {
    derive2026RegularSeasonWeek,
    resolveWaiverWeek,
    withResolvedWeek,
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

function stashEvidence() {
  return {
    ...decision().evidence,
    sage: { position: 'WR', positionRank: 30 },
    rosterImpact: {
      classification: 'SIMILAR',
      comparisonType: 'starting-lineup',
      candidateStarts: false,
      depthComparison: {
        classification: 'UPGRADE',
        weakestComparable: { sage: { positionRank: 42 } }
      }
    },
    trend: { direction: 'RISER' }
  };
}

test('2026 fallback resolves Week 1 from September 10', () => {
  assert.strictEqual(
    derive2026RegularSeasonWeek(new Date('2026-09-10T20:00:00Z')),
    1
  );
});

test('2026 fallback advances exactly one week at September 17', () => {
  assert.strictEqual(
    derive2026RegularSeasonWeek(new Date('2026-09-17T00:00:00Z')),
    2
  );
});

test('provider week wins over date fallback', () => {
  assert.strictEqual(
    resolveWaiverWeek(
      { connection: { provider: 'cbs', currentWeek: 4, season: 2026 } },
      new Date('2026-09-10T20:00:00Z')
    ),
    4
  );
});

test('CBS connection without week gets safe 2026 current-week fallback', () => {
  assert.strictEqual(
    resolveWaiverWeek(
      { connection: { provider: 'cbs', season: 2026 } },
      new Date('2026-09-10T20:00:00Z')
    ),
    1
  );
});

test('resolved week is injected without changing connection payload', () => {
  const connection = { provider: 'cbs', season: 2026, leagueId: '55' };
  const event = {
    body: JSON.stringify({ connection })
  };
  const resolved = withResolvedWeek(event);
  const body = JSON.parse(resolved.body);

  assert.strictEqual(body.connection.leagueId, '55');
  assert.ok(Number.isInteger(body.week));
  assert.ok(body.week >= 1 && body.week <= 18);
});

test('explicit caller week is never overridden', () => {
  const event = {
    body: JSON.stringify({ week: 99, connection: { provider: 'cbs', season: 2026 } })
  };
  const resolved = withResolvedWeek(event);
  assert.strictEqual(JSON.parse(resolved.body).week, 99);
});

test('ADD becomes customer-facing ADD_NOW', () => {
  assert.strictEqual(customerVerdict(decision()), 'ADD_NOW');
});

test('rising depth player with a meaningful bench upgrade becomes STASH', () => {
  assert.strictEqual(
    customerVerdict(decision({
      decision: { action: 'WATCH', actionable: false },
      evidence: {
        ...decision().evidence,
        sage: { position: 'WR', positionRank: 30 },
        rosterImpact: {
          classification: 'SIMILAR',
          comparisonType: 'starting-lineup',
          candidateStarts: false,
          depthComparison: {
            classification: 'UPGRADE',
            weakestComparable: { sage: { positionRank: 42 } }
          }
        },
        trend: { direction: 'RISER' }
      }
    })),
    'STASH'
  );
});

test('rising depth player without a meaningful bench upgrade stays WATCH', () => {
  assert.strictEqual(
    customerVerdict(decision({
      decision: { action: 'WATCH', actionable: false },
      evidence: {
        ...decision().evidence,
        sage: { position: 'TE', positionRank: 48 },
        rosterImpact: {
          classification: 'SIMILAR',
          comparisonType: 'starting-lineup',
          candidateStarts: false,
          depthComparison: {
            classification: 'DOWNGRADE',
            weakestComparable: { sage: { positionRank: 20 } }
          }
        },
        trend: { direction: 'RISER' }
      }
    })),
    'WATCH'
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

test('lineup displacement is not mislabeled as a drop recommendation', () => {
  const input = decision({
    evidence: {
      ...decision().evidence,
      rosterImpact: {
        classification: 'UPGRADE',
        comparisonType: 'starting-lineup',
        candidateStarts: true,
        targetSlot: 'FLEX',
        weakestComparable: {
          name: 'Roster Runner',
          position: 'RB',
          team: 'CAR'
        }
      }
    }
  });
  const result = buildCustomerRecommendations([input])[0];

  assert.strictEqual(result.swapFor, null);
  assert.strictEqual(result.lineupFor.name, 'Roster Runner');
  assert.strictEqual(result.lineupFor.slot, 'FLEX');
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
      evidence: stashEvidence()
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
      evidence: stashEvidence()
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
