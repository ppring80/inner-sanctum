'use strict';

const assert = require('assert');
const {
  _test: {
    normalizeLimit,
    opportunityPriority,
    sagePositionRank,
    toOpportunity,
    buildFixMyTeamSummary
  }
} = require('../netlify/functions/fix-my-team.js');

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

function decisionItem({
  action,
  name,
  positionRank,
  actionable,
  weakestName,
  trendDirection
}) {
  return {
    providerPlayerId: `id-${name}`,
    name,
    position: 'WR',
    team: 'GB',
    availabilityStatus: 'FREE_AGENT',
    decision: {
      action,
      actionable: Boolean(actionable),
      reasons: [`Reason for ${name}`]
    },
    evidence: {
      sage: positionRank
        ? {
            position: 'WR',
            positionRank,
            sageScore: 80 - positionRank
          }
        : null,
      trend: trendDirection
        ? { direction: trendDirection }
        : null,
      rosterImpact: weakestName
        ? {
            classification: action === 'ADD' ? 'UPGRADE' : 'SIMILAR',
            weakestComparable: {
              name: weakestName,
              position: 'WR',
              team: 'NYJ',
              sage: { position: 'WR', positionRank: positionRank + 10 }
            }
          }
        : { classification: 'UNKNOWN', weakestComparable: null },
      percentOwned: 22.5
    }
  };
}

test('normalizes opportunity limit conservatively', () => {
  assert.strictEqual(normalizeLimit(undefined), 5);
  assert.strictEqual(normalizeLimit(0), 5);
  assert.strictEqual(normalizeLimit(3), 3);
  assert.strictEqual(normalizeLimit(99), 10);
});

test('ADD has highest opportunity priority', () => {
  assert.ok(opportunityPriority('ADD') < opportunityPriority('WATCH'));
  assert.ok(opportunityPriority('WATCH') < opportunityPriority('REVIEW'));
});

test('reads SAGE position rank from decision evidence', () => {
  assert.strictEqual(
    sagePositionRank(decisionItem({ action: 'ADD', name: 'Alpha', positionRank: 7 })),
    7
  );
});

test('converts an ADD decision into a compact opportunity with replace candidate', () => {
  const opportunity = toOpportunity(
    decisionItem({
      action: 'ADD',
      name: 'Available Receiver',
      positionRank: 18,
      actionable: true,
      weakestName: 'Roster Receiver',
      trendDirection: 'RISER'
    })
  );

  assert.strictEqual(opportunity.action, 'ADD');
  assert.strictEqual(opportunity.actionable, true);
  assert.strictEqual(opportunity.name, 'Available Receiver');
  assert.strictEqual(opportunity.replaceCandidate.name, 'Roster Receiver');
  assert.strictEqual(opportunity.trend.direction, 'RISER');
});

test('summary places ADD before WATCH and REVIEW', () => {
  const summary = buildFixMyTeamSummary([
    decisionItem({ action: 'REVIEW', name: 'Review Player', positionRank: 10 }),
    decisionItem({ action: 'WATCH', name: 'Watch Player', positionRank: 5 }),
    decisionItem({ action: 'ADD', name: 'Add Player', positionRank: 20, actionable: true })
  ], 5);

  assert.deepStrictEqual(
    summary.opportunities.map((item) => item.action),
    ['ADD', 'WATCH', 'REVIEW']
  );
  assert.strictEqual(summary.status, 'ACTION_AVAILABLE');
  assert.strictEqual(summary.topOpportunity.name, 'Add Player');
});

test('within the same action, better SAGE position rank comes first', () => {
  const summary = buildFixMyTeamSummary([
    decisionItem({ action: 'WATCH', name: 'WR Thirty', positionRank: 30 }),
    decisionItem({ action: 'WATCH', name: 'WR Twelve', positionRank: 12 })
  ], 5);

  assert.strictEqual(summary.opportunities[0].name, 'WR Twelve');
  assert.strictEqual(summary.opportunities[1].name, 'WR Thirty');
});

test('PASS and INELIGIBLE decisions are counted but not surfaced as opportunities', () => {
  const summary = buildFixMyTeamSummary([
    decisionItem({ action: 'PASS', name: 'Pass Player', positionRank: 40 }),
    decisionItem({ action: 'INELIGIBLE', name: 'Rostered Player', positionRank: 1 }),
    decisionItem({ action: 'WATCH', name: 'Watch Player', positionRank: 22 })
  ], 5);

  assert.strictEqual(summary.counts.pass, 1);
  assert.strictEqual(summary.counts.ineligible, 1);
  assert.strictEqual(summary.opportunities.length, 1);
  assert.strictEqual(summary.opportunities[0].action, 'WATCH');
});

test('limit caps the number of surfaced opportunities', () => {
  const summary = buildFixMyTeamSummary([
    decisionItem({ action: 'ADD', name: 'A', positionRank: 1, actionable: true }),
    decisionItem({ action: 'ADD', name: 'B', positionRank: 2, actionable: true }),
    decisionItem({ action: 'WATCH', name: 'C', positionRank: 3 })
  ], 2);

  assert.strictEqual(summary.opportunities.length, 2);
});

test('WATCHLIST status is used when there is no ADD but at least one WATCH', () => {
  const summary = buildFixMyTeamSummary([
    decisionItem({ action: 'WATCH', name: 'Watch Player', positionRank: 9 })
  ], 5);

  assert.strictEqual(summary.status, 'WATCHLIST');
});

test('NO_CLEAR_UPGRADE status is used when no ADD or WATCH exists', () => {
  const summary = buildFixMyTeamSummary([
    decisionItem({ action: 'REVIEW', name: 'Review Player', positionRank: 9 })
  ], 5);

  assert.strictEqual(summary.status, 'NO_CLEAR_UPGRADE');
});

console.log(`\n${passed} Fix My Team tests passed.`);
