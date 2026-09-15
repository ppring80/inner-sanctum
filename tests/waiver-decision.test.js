'use strict';

const assert = require('assert');
const {
  _test: {
    normalizeAvailabilityStatus,
    classifyCandidate,
    buildWaiverDecisions,
    summarizeDecisions
  }
} = require('../netlify/functions/waiver-decision.js');

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

function candidate(overrides) {
  return {
    providerPlayerId: 'espn-101',
    name: 'Available Receiver',
    position: 'WR',
    team: 'GB',
    availabilityStatus: 'FREE_AGENT',
    percentOwned: 38.4,
    identity: {
      sageMatched: true,
      trendMatched: true
    },
    sage: {
      position: 'WR',
      positionRank: 24,
      sageScore: 82,
      recommendation: 'START'
    },
    trend: {
      direction: 'RISER',
      targetShareDelta: 0.12
    },
    rosterImpact: {
      classification: 'UPGRADE',
      weakestComparable: {
        name: 'Roster Receiver',
        position: 'WR',
        team: 'NYJ',
        sage: {
          position: 'WR',
          positionRank: 41,
          sageScore: 67
        }
      }
    },
    ...overrides
  };
}

test('normalizes ESPN FREEAGENT status to shared FREE_AGENT', () => {
  assert.strictEqual(normalizeAvailabilityStatus('FREEAGENT'), 'FREE_AGENT');
  assert.strictEqual(normalizeAvailabilityStatus('WAIVERS'), 'WAIVERS');
});

test('provider availability is a hard gate', () => {
  const result = classifyCandidate(candidate({ availabilityStatus: 'ROSTERED' }));
  assert.strictEqual(result.action, 'INELIGIBLE');
  assert.strictEqual(result.actionable, false);
  assert.strictEqual(result.reasonCode, 'NOT_PROVIDER_AVAILABLE');
});

test('safe SAGE match plus roster upgrade produces ADD', () => {
  const result = classifyCandidate(candidate());
  assert.strictEqual(result.action, 'ADD');
  assert.strictEqual(result.actionable, true);
  assert.strictEqual(result.reasonCode, 'ROSTER_UPGRADE');
  assert.ok(result.reasons.some((reason) => reason.includes('WR24')));
  assert.ok(result.reasons.some((reason) => reason.includes('Roster Receiver')));
});

test('Week 1 baseline rank edge cannot produce ADD NOW or a drop instruction', () => {
  const result = classifyCandidate(candidate({
    name: 'Brock Purdy',
    position: 'QB',
    sage: {
      position: 'QB',
      positionRank: 11,
      sageScore: null,
      recommendation: 'START',
      baselineEvidenceType: 'week1-adp-baseline'
    },
    rosterImpact: {
      classification: 'UPGRADE',
      weakestComparable: {
        name: 'Patrick Mahomes',
        position: 'QB',
        sage: {
          position: 'QB',
          positionRank: 14,
          sageScore: null,
          baselineEvidenceType: 'week1-adp-baseline'
        }
      }
    }
  }));

  assert.strictEqual(result.action, 'REVIEW');
  assert.strictEqual(result.actionable, false);
  assert.strictEqual(result.reasonCode, 'UPGRADE_EVIDENCE_INSUFFICIENT');
});

test('small weekly rank and score edges remain REVIEW', () => {
  const result = classifyCandidate(candidate({
    sage: { position: 'WR', positionRank: 20, sageScore: 75 },
    rosterImpact: {
      classification: 'UPGRADE',
      weakestComparable: {
        name: 'Roster Receiver',
        sage: { position: 'WR', positionRank: 23, sageScore: 72 }
      }
    }
  }));

  assert.strictEqual(result.action, 'REVIEW');
  assert.strictEqual(result.actionable, false);
});

test('rising trend cannot turn a downgrade into ADD', () => {
  const result = classifyCandidate(
    candidate({
      trend: { direction: 'RISER', targetShareDelta: 0.2 },
      rosterImpact: {
        classification: 'DOWNGRADE',
        weakestComparable: {
          name: 'Better Roster Receiver',
          sage: { position: 'WR', positionRank: 12 }
        }
      }
    })
  );

  assert.strictEqual(result.action, 'PASS');
  assert.strictEqual(result.actionable, false);
});

test('similar roster value produces WATCH rather than ADD', () => {
  const result = classifyCandidate(
    candidate({
      rosterImpact: {
        classification: 'SIMILAR',
        weakestComparable: {
          name: 'Similar Receiver',
          sage: { position: 'WR', positionRank: 24 }
        }
      }
    })
  );

  assert.strictEqual(result.action, 'WATCH');
  assert.strictEqual(result.actionable, false);
});

test('depth-only candidate behind the weakest roster comparable becomes PASS', () => {
  const result = classifyCandidate(
    candidate({
      rosterImpact: {
        classification: 'SIMILAR',
        comparisonType: 'starting-lineup',
        candidateStarts: false,
        depthComparison: {
          classification: 'DOWNGRADE',
          weakestComparable: {
            name: 'Better Bench Receiver',
            sage: { position: 'WR', positionRank: 18 }
          }
        }
      }
    })
  );

  assert.strictEqual(result.action, 'PASS');
  assert.strictEqual(result.reasonCode, 'ROSTER_DEPTH_DOWNGRADE');
});

test('missing roster comparison produces REVIEW rather than guessing', () => {
  const result = classifyCandidate(
    candidate({
      rosterImpact: {
        classification: 'UNKNOWN',
        weakestComparable: null,
        reason: 'no_comparable_roster_sage_rank'
      }
    })
  );

  assert.strictEqual(result.action, 'REVIEW');
  assert.strictEqual(result.actionable, false);
  assert.strictEqual(result.reasonCode, 'ROSTER_COMPARISON_UNAVAILABLE');
});

test('unsafe or missing SAGE identity produces REVIEW', () => {
  const result = classifyCandidate(
    candidate({
      identity: { sageMatched: false, trendMatched: true },
      sage: null
    })
  );

  assert.strictEqual(result.action, 'REVIEW');
  assert.strictEqual(result.actionable, false);
  assert.strictEqual(result.reasonCode, 'SAGE_UNMATCHED');
});

test('missing trend evidence does not block a genuine roster upgrade', () => {
  const result = classifyCandidate(candidate({ trend: null }));
  assert.strictEqual(result.action, 'ADD');
  assert.strictEqual(result.actionable, true);
});

test('FLEX upgrade uses cross-position SAGE score instead of positional rank', () => {
  const result = classifyCandidate(candidate({
    sage: { position: 'WR', positionRank: 24, sageScore: 82, recommendation: 'START' },
    rosterImpact: {
      classification: 'UPGRADE',
      comparisonType: 'starting-lineup',
      candidateStarts: true,
      targetSlot: 'FLEX',
      lineupValueDelta: 9,
      projectionDelta: 3.2,
      weakestComparable: {
        name: 'Roster Runner',
        position: 'RB',
        sage: { position: 'RB', positionRank: 18, sageScore: 73 }
      }
    }
  }));

  assert.strictEqual(result.action, 'ADD');
  assert.ok(result.reasons.includes('Projects into FLEX over Roster Runner'));
  assert.ok(result.reasons.includes('Provider projection improves the lineup by 3.2 points'));
  assert.ok(!result.reasons.some((reason) => reason.startsWith('Ranks ahead')));
});

test('small FLEX score edge remains REVIEW even with a positive lineup delta', () => {
  const result = classifyCandidate(candidate({
    sage: { position: 'WR', positionRank: 24, sageScore: 76 },
    rosterImpact: {
      classification: 'UPGRADE',
      comparisonType: 'starting-lineup',
      candidateStarts: true,
      targetSlot: 'FLEX',
      lineupValueDelta: 3,
      weakestComparable: {
        name: 'Roster Runner',
        position: 'RB',
        sage: { position: 'RB', positionRank: 18, sageScore: 73 }
      }
    }
  }));

  assert.strictEqual(result.action, 'REVIEW');
  assert.strictEqual(result.actionable, false);
});

test('decision list orders ADD before WATCH, REVIEW, PASS, and INELIGIBLE', () => {
  const decisions = buildWaiverDecisions([
    candidate({ name: 'Pass Player', rosterImpact: { classification: 'DOWNGRADE' } }),
    candidate({ name: 'Review Player', rosterImpact: { classification: 'UNKNOWN' } }),
    candidate({ name: 'Add Player' }),
    candidate({ name: 'Ineligible Player', availabilityStatus: 'ROSTERED' }),
    candidate({ name: 'Watch Player', rosterImpact: { classification: 'SIMILAR' } })
  ]);

  assert.deepStrictEqual(
    decisions.map((item) => item.decision.action),
    ['ADD', 'WATCH', 'REVIEW', 'PASS', 'INELIGIBLE']
  );
});

test('summary exposes customer-action counts without a new score', () => {
  const decisions = buildWaiverDecisions([
    candidate({ name: 'Add One' }),
    candidate({ name: 'Add Two', providerPlayerId: 'espn-102' }),
    candidate({ name: 'Watch One', rosterImpact: { classification: 'SIMILAR' } }),
    candidate({ name: 'Pass One', rosterImpact: { classification: 'DOWNGRADE' } })
  ]);

  const summary = summarizeDecisions(decisions);
  assert.strictEqual(summary.add, 2);
  assert.strictEqual(summary.watch, 1);
  assert.strictEqual(summary.pass, 1);
  assert.strictEqual(summary.actionable, 2);
});

console.log(`\n${passed} waiver-decision tests passed.`);
