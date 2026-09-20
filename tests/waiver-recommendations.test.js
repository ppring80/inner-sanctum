'use strict';

const assert = require('assert');
const {
  _test: {
    derive2026RegularSeasonWeek,
    resolveWaiverWeek,
    withResolvedWeek,
    customerVerdict,
    buildFaabGuidance,
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
    trend: { direction: 'RISER' },
    opportunity: {
      lastGameOpportunities: 9,
      lastGameCarries: 2,
      lastGameTargets: 7
    }
  };
}

function qualifiedAddEvidence() {
  return {
    ...decision().evidence,
    opportunity: {
      lastGameOpportunities: 9,
      lastGameCarries: 2,
      lastGameTargets: 7
    }
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

test('2026 waiver window advances to Week 2 on Tuesday after Week 1', () => {
  assert.strictEqual(
    derive2026RegularSeasonWeek(new Date('2026-09-15T06:00:00Z')),
    2
  );
});

test('Week 1 does not advance before the Monday slate is safely complete', () => {
  assert.strictEqual(
    derive2026RegularSeasonWeek(new Date('2026-09-15T05:59:59Z')),
    1
  );
});

test('provider Week 1 remains authoritative after the calendar enters the Week 2 waiver window', () => {
  assert.strictEqual(
    resolveWaiverWeek(
      { connection: { provider: 'espn', currentWeek: 1, season: 2026 } },
      new Date('2026-09-15T06:00:00Z')
    ),
    1
  );
});

test('ESPN available-player scoring period recovers provider week for an existing connection', () => {
  assert.strictEqual(
    resolveWaiverWeek(
      {
        connection: {
          provider: 'espn',
          league: { season: 2026 },
          availablePlayers: [{ name: 'Jared Goff', scoringPeriodId: 1 }]
        }
      },
      new Date('2026-09-15T07:00:00Z')
    ),
    1
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

test('rank-only ADD without bid-quality evidence stays REVIEW', () => {
  assert.strictEqual(customerVerdict(decision()), 'REVIEW');
});

test('evidence-qualified ADD becomes ADD_NOW and includes FAAB', () => {
  const qualified = decision({ evidence: qualifiedAddEvidence() });
  const [result] = buildCustomerRecommendations([qualified], {
    teams: 12,
    scoring: 'half'
  });
  assert.strictEqual(result.verdict, 'ADD_NOW');
  assert.ok(result.faab, 'ADD_NOW must always carry defensible FAAB guidance');
});

test('rank edge and rising label alone do not manufacture a STASH verdict', () => {
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
    'WATCH'
  );
});

test('meaningful bench upgrade becomes STASH even before a trend signal exists', () => {
  assert.strictEqual(
    customerVerdict(decision({
      decision: { action: 'WATCH', actionable: false },
      evidence: {
        ...stashEvidence(),
        trend: null
      }
    })),
    'STASH'
  );
});

test('verified workload plus a meaningful bench upgrade becomes STASH', () => {
  const result = buildCustomerRecommendations([decision({
    decision: { action: 'WATCH', actionable: false },
    evidence: {
      ...stashEvidence(),
      trend: null
    }
  })], { teams: 12 })[0];

  assert.strictEqual(result.verdict, 'STASH');
  assert.strictEqual(result.recommended, true);
  assert.ok(result.faab);
});

test('projection-only skill player stays WATCH but retains speculative market pricing', () => {
  const result = buildCustomerRecommendations([decision({
    decision: { action: 'WATCH', actionable: false },
    evidence: {
      ...stashEvidence(),
      sage: { position: 'WR', positionRank: 30, baselineEvidenceType: 'provider-projection-fallback' },
      opportunity: null,
      trend: null,
      providerProjectedPoints: 11,
      rosterImpact: {
        classification: 'SIMILAR',
        comparisonType: 'starting-lineup',
        candidateStarts: false,
        depthComparison: {
          classification: 'UPGRADE',
          weakestComparable: { projectedPoints: 8, sage: { positionRank: 42 } }
        }
      }
    }
  })])[0];

  assert.strictEqual(result.verdict, 'WATCH');
  assert.strictEqual(result.recommended, false);
  assert.strictEqual(result.faab.recommendedPct, 1);
  assert.strictEqual(result.faab.archetype, 'SPECULATIVE');
});

test('equivalent ESPN and CBS evidence produces the same customer decision', () => {
  const providerDecision = (provider) => decision({
    provider,
    decision: { action: 'WATCH', actionable: false },
    evidence: { ...stashEvidence(), provider }
  });
  const [espn, cbs] = buildCustomerRecommendations([
    providerDecision('espn'),
    providerDecision('cbs')
  ], { teams: 12 });

  assert.strictEqual(espn.verdict, cbs.verdict);
  assert.strictEqual(espn.recommended, cbs.recommended);
  assert.strictEqual(espn.faab.recommendedPct, cbs.faab.recommendedPct);
});

test('Recommended preserves credible QB TE K and DEF coverage during SAGE fallback', () => {
  const positions = [
    ['QB', 12, 10],
    ['TE', 12, 4],
    ['K', 10, 5],
    ['DEF', 10, 5]
  ];
  const recs = buildCustomerRecommendations(positions.map(([position, rank, projected]) => decision({
    name: `${position} Coverage`,
    position,
    decision: { action: 'REVIEW', actionable: false },
    evidence: {
      ...decision().evidence,
      sage: {
        position,
        positionRank: rank,
        baselineEvidenceType: 'provider-projection-fallback'
      },
      providerProjectedPoints: projected,
      rosterImpact: { classification: 'SIMILAR' },
      opportunity: null,
      trend: null
    }
  })));

  positions.forEach(([position]) => {
    const result = recs.find((item) => item.position === position);
    assert.strictEqual(result.verdict, 'REVIEW');
    assert.strictEqual(result.recommended, true, `${position} should retain credible coverage`);
    assert.strictEqual(result.faab.recommendedPct, 1, `${position} review coverage receives speculative market FAAB`);
    assert.strictEqual(result.faab.archetype, 'SPECULATIVE');
  });
});

test('positional coverage rejects unusable projections and deep ranks', () => {
  const recs = buildCustomerRecommendations([
    decision({
      name: 'Deep Quarterback',
      position: 'QB',
      decision: { action: 'REVIEW', actionable: false },
      evidence: {
        ...decision().evidence,
        sage: { position: 'QB', positionRank: 20, baselineEvidenceType: 'provider-projection-fallback' },
        providerProjectedPoints: 18,
        rosterImpact: { classification: 'SIMILAR' }
      }
    }),
    decision({
      name: 'Low Projection Defense',
      position: 'DEF',
      decision: { action: 'REVIEW', actionable: false },
      evidence: {
        ...decision().evidence,
        sage: { position: 'DEF', positionRank: 5, baselineEvidenceType: 'provider-projection-fallback' },
        providerProjectedPoints: 3,
        rosterImpact: { classification: 'SIMILAR' }
      }
    }),
    decision({
      name: 'Ranked Review Running Back',
      position: 'RB',
      decision: { action: 'REVIEW', actionable: false },
      evidence: {
        ...decision().evidence,
        sage: { position: 'RB', positionRank: 12, baselineEvidenceType: 'provider-projection-fallback' },
        providerProjectedPoints: 10,
        rosterImpact: { classification: 'SIMILAR' }
      }
    })
  ]);

  recs.forEach((result) => assert.strictEqual(result.recommended, false));
});

test('Week 1 same-position fallback upgrade becomes STASH with FAAB', () => {
  const result = buildCustomerRecommendations([decision({
    position: 'WR',
    decision: { action: 'WATCH', actionable: false, reasonCode: 'WEEK1_DEPTH_UPGRADE' },
    evidence: {
      ...decision().evidence,
      providerProjectedPoints: 13,
      sage: { position: 'WR', positionRank: 24, baselineEvidenceType: 'week1-adp-baseline' },
      trend: null,
      rosterImpact: {
        classification: 'UPGRADE', comparisonType: 'same-position-fallback',
        weakestComparable: {
          name: 'Bench Receiver', position: 'WR', projectedPoints: 8,
          sage: { positionRank: 40 }
        }
      }
    }
  })], { teams: 12, scoring: 'half-ppr' })[0];

  assert.strictEqual(result.verdict, 'STASH');
  assert.ok(result.faab);
  assert.strictEqual(result.faab.recommendedPct, 3);
});

test('all fantasy positions preserve matchup, Weekly SAGE, roster impact, decision, and FAAB', () => {
  const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  const recs = buildCustomerRecommendations(positions.map((position, index) => decision({
    name: `${position} Candidate`,
    position,
    opponent: 'BUF',
    matchup: { opponent: 'BUF', homeAway: 'HOME' },
    evidence: {
      ...decision().evidence,
      sage: { position, positionRank: index + 1, recommendation: 'START' },
      rosterImpact: {
        classification: 'UPGRADE',
        comparisonType: 'starting-lineup',
        candidateStarts: true,
        projectionDelta: 4,
        weakestComparable: { name: `${position} Roster Player`, position }
      }
    }
  })), { teams: 12, scoring: 'half-ppr' });

  positions.forEach((position) => {
    const item = recs.find((candidate) => candidate.position === position);
    assert.strictEqual(item.opponent, 'BUF');
    assert.strictEqual(item.quickRead.weeklyRank, `${position}${positions.indexOf(position) + 1}`);
    assert.strictEqual(item.evidence.rosterImpact.classification, 'UPGRADE');
    assert.strictEqual(item.verdict, 'ADD_NOW');
    assert.ok(item.faab);
  });
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
  const input = decision({ evidence: qualifiedAddEvidence() });
  const result = buildCustomerRecommendations([input])[0];
  assert.strictEqual(result.verdict, 'ADD_NOW');
  assert.ok(result.faab);
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
    decision({ name: 'Add', evidence: qualifiedAddEvidence() })
  ]);

  assert.deepStrictEqual(
    items.map((item) => item.verdict),
    ['ADD_NOW', 'STASH', 'WATCH', 'REVIEW', 'PASS']
  );
});

test('summary counts customer-facing verdicts', () => {
  const items = buildCustomerRecommendations([
    decision({ name: 'Add', evidence: qualifiedAddEvidence() }),
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

test('credible Weekly SAGE rank supplies speculative market FAAB independent of roster action', () => {
  const item = decision({
    name: 'Breakout Runner',
    position: 'RB',
    decision: { action: 'WATCH', actionable: false },
    evidence: {
      sage: { position: 'RB', positionRank: 34 },
      trend: { direction: 'RISER' },
      rosterImpact: {
        classification: 'SIMILAR',
        comparisonType: 'starting-lineup',
        candidateStarts: false,
        depthComparison: {
          classification: 'UPGRADE',
          weakestComparable: {
            name: 'Bench Runner',
            position: 'RB',
            sage: { position: 'RB', positionRank: 50 }
          }
        }
      },
      percentOwned: 31
    }
  });
  const guidance = buildFaabGuidance(item, 'STASH', {
    teams: 12,
    scoring: 'half-ppr'
  });

  assert.strictEqual(guidance.recommendedPct, 1);
  assert.strictEqual(guidance.archetype, 'SPECULATIVE');
});

test('review and pass players without pricing evidence do not receive invented FAAB', () => {
  const unpriced = decision({
    position: 'WR',
    evidence: {
      sage: { position: 'WR', positionRank: 95 },
      rosterImpact: { classification: 'UNKNOWN' },
      opportunity: null,
      trend: null,
      providerProjectedPoints: null
    }
  });
  assert.strictEqual(buildFaabGuidance(unpriced, 'REVIEW', { teams: 12 }), null);
  assert.strictEqual(buildFaabGuidance(unpriced, 'PASS', { teams: 12 }), null);
});

test('FAAB market guidance is independent of the roster-action verdict', () => {
  const item = decision({
    name: 'Marketable Receiver',
    position: 'WR',
    evidence: {
      providerProjectedPoints: 11,
      opportunity: { lastGameOpportunities: 7, lastGameTargets: 7 },
      rosterImpact: {
        classification: 'SIMILAR',
        comparisonType: 'starting-lineup',
        candidateStarts: false,
        depthComparison: {
          classification: 'UPGRADE',
          weakestComparable: { projectedPoints: 8 }
        }
      }
    }
  });

  for (const verdict of ['WATCH', 'REVIEW', 'PASS']) {
    const guidance = buildFaabGuidance(item, verdict, { teams: 12, scoring: 'half-ppr' });
    assert.ok(guidance, `${verdict} should retain evidence-backed market pricing`);
    assert.strictEqual(guidance.recommendedPct, 3);
  }
});

test('top weekly kicker and defense options receive market FAAB despite marginal roster gain', () => {
  for (const position of ['K', 'DEF']) {
    const item = decision({
      position,
      evidence: {
        sage: { position, positionRank: position === 'K' ? 5 : 6 },
        providerProjectedPoints: position === 'K' ? 9.1 : 6,
        rosterImpact: {
          classification: 'UPGRADE',
          comparisonType: 'starting-lineup',
          candidateStarts: true,
          projectionDelta: 0.9
        }
      }
    });
    const guidance = buildFaabGuidance(item, 'REVIEW', { teams: 10 });
    assert.strictEqual(guidance.recommendedPct, 1);
    assert.strictEqual(guidance.archetype, 'SPECULATIVE');
  }
});

test('customer recommendation preserves team-resolved matchup without SAGE', () => {
  const recs = buildCustomerRecommendations([
    decision({
      opponent: 'BUF',
      decision: { action: 'REVIEW', actionable: false },
      evidence: {
        ...decision().evidence,
        sage: null,
        rosterImpact: { classification: 'UNKNOWN' }
      }
    })
  ]);

  assert.strictEqual(recs[0].opponent, 'BUF');
  assert.strictEqual(recs[0].quickRead.opponent, 'BUF');
});

console.log(`\n${passed} waiver-recommendations tests passed.`);
