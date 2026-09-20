'use strict';

const assert = require('assert');
const { _test: { buildFaabGuidance } } = require('../netlify/functions/waiver-recommendations.js');

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

function candidate({
  name = 'Candidate', position = 'RB', projection = 8, rosterProjection = 5,
  opportunities = null, carries = null, targets = null, snaps = null,
  trend = null, owned = 10, starts = false
} = {}) {
  return {
    name,
    position,
    evidence: {
      providerProjectedPoints: projection,
      percentOwned: owned,
      trend: trend || snaps !== null || targets !== null ? {
        direction: trend,
        currentTargets: targets,
        currentSnapShare: snaps
      } : null,
      opportunity: opportunities !== null || carries !== null || targets !== null ? {
        lastGameOpportunities: opportunities,
        lastGameCarries: carries,
        lastGameTargets: targets
      } : null,
      rosterImpact: {
        classification: starts ? 'UPGRADE' : 'SIMILAR',
        comparisonType: 'starting-lineup',
        candidateStarts: starts,
        projectionDelta: starts ? projection - rosterProjection : null,
        depthComparison: {
          classification: 'UPGRADE',
          weakestComparable: { projectedPoints: rosterProjection }
        }
      }
    }
  };
}

test('ownership and a rising label cannot manufacture a positive bid', () => {
  const item = candidate({ projection: null, rosterProjection: null, trend: 'RISER', owned: 88 });
  const faab = buildFaabGuidance(item, 'STASH', { teams: 14, scoring: 'half-ppr' });
  assert.deepStrictEqual([faab.recommendedPct, faab.aggressivePct, faab.archetype], [0, 1, 'NO_BID']);
});

test('zero workload and less than two projected points of bench gain produces no bid', () => {
  const item = candidate({ projection: 6.9, rosterProjection: 5, opportunities: 0, owned: 70 });
  assert.strictEqual(buildFaabGuidance(item, 'STASH', { teams: 12 }).recommendedPct, 0);
});

test('verified breakout plus a major lineup gain earns the only premium band', () => {
  const item = candidate({
    position: 'WR', projection: 16, rosterProjection: 9, targets: 10,
    opportunities: 10, snaps: 82, trend: 'RISER', starts: true
  });
  assert.deepStrictEqual(
    (({ valuePct, recommendedPct, aggressivePct, archetype }) =>
      ({ valuePct, recommendedPct, aggressivePct, archetype }))(
      buildFaabGuidance(item, 'ADD_NOW', { teams: 12, scoring: 'ppr' })
    ),
    { valuePct: 10, recommendedPct: 15, aggressivePct: 22, archetype: 'BREAKOUT' }
  );
});

test('Kaelon-shaped evidence prices as a priority stash, not a premium add', () => {
  const item = candidate({
    name: 'Kaelon Black', projection: 8, rosterProjection: 4.3,
    opportunities: 15, carries: 14, targets: 1, snaps: 43, owned: 8
  });
  const faab = buildFaabGuidance(item, 'STASH', { teams: 12, scoring: 'half-ppr' });
  assert.deepStrictEqual(
    [faab.valuePct, faab.recommendedPct, faab.aggressivePct, faab.archetype],
    [4, 6, 9, 'PRIORITY_STASH']
  );
});

test('Holani-shaped backup evidence stays speculative and cannot imply a starting role', () => {
  const item = candidate({
    name: 'George Holani', projection: 7.5, rosterProjection: 5,
    opportunities: 0, carries: 0, targets: 0, snaps: 12, owned: 4
  });
  const faab = buildFaabGuidance(item, 'STASH', { teams: 12, scoring: 'half-ppr' });
  assert.deepStrictEqual(
    [faab.valuePct, faab.recommendedPct, faab.aggressivePct, faab.archetype],
    [1, 1, 2, 'SPECULATIVE']
  );
});

test('Braelon-shaped limited workload is a low depth stash', () => {
  const item = candidate({
    name: 'Braelon Allen', projection: 7, rosterProjection: 4.3,
    opportunities: 10, carries: 10, targets: 0, snaps: 28, owned: 15
  });
  const faab = buildFaabGuidance(item, 'STASH', { teams: 12, scoring: 'half-ppr' });
  assert.deepStrictEqual([faab.valuePct, faab.recommendedPct, faab.aggressivePct], [2, 3, 5]);
});

test('Brian Robinson-shaped thin role does not receive double-digit FAAB', () => {
  const item = candidate({
    name: 'Brian Robinson Jr.', projection: 6.1, rosterProjection: 4.2,
    opportunities: 9, carries: 9, targets: 0, snaps: 31, owned: 25
  });
  const faab = buildFaabGuidance(item, 'STASH', { teams: 12, scoring: 'half-ppr' });
  assert.deepStrictEqual([faab.valuePct, faab.recommendedPct, faab.aggressivePct], [1, 1, 2]);
});

test('Justice Hill-shaped zero workload produces no bid without a real projection edge', () => {
  const item = candidate({
    name: 'Justice Hill', projection: 6.4, rosterProjection: 4.5,
    opportunities: 0, carries: 0, targets: 0, snaps: 8, owned: 3
  });
  assert.strictEqual(buildFaabGuidance(item, 'STASH', { teams: 12 }).recommendedPct, 0);
});

test('Chris Brooks-shaped modest receiving usage stays speculative, not 19 percent', () => {
  const item = candidate({
    name: 'Chris Brooks', projection: 8.7, rosterProjection: 4.3,
    opportunities: 4, carries: 0, targets: 4, snaps: 19, owned: 3
  });
  const faab = buildFaabGuidance(item, 'STASH', { teams: 12, scoring: 'half-ppr' });
  assert.deepStrictEqual([faab.valuePct, faab.recommendedPct, faab.aggressivePct], [1, 1, 2]);
});

test('QB K and DEF ignore synthetic workload and require roster-relative projection gain', () => {
  ['QB', 'K', 'DEF'].forEach((position) => {
    const noGain = candidate({ position, projection: 9, rosterProjection: 8, opportunities: 30 });
    assert.strictEqual(buildFaabGuidance(noGain, 'STASH', { teams: 12 }).recommendedPct, 0);
    const gain = candidate({ position, projection: 11, rosterProjection: 8, opportunities: 30 });
    assert.strictEqual(buildFaabGuidance(gain, 'STASH', { teams: 12 }).recommendedPct, 1);
  });
});

test('league depth changes price while ownership never does', () => {
  const lowOwned = candidate({
    position: 'WR', projection: 15, rosterProjection: 10,
    targets: 7, opportunities: 7, owned: 2, starts: true
  });
  const highOwned = candidate({
    position: 'WR', projection: 15, rosterProjection: 10,
    targets: 7, opportunities: 7, owned: 92, starts: true
  });
  const eight = buildFaabGuidance(lowOwned, 'ADD_NOW', { teams: 8, scoring: 'half-ppr' });
  const twelveLow = buildFaabGuidance(lowOwned, 'ADD_NOW', { teams: 12, scoring: 'half-ppr' });
  const twelveHigh = buildFaabGuidance(highOwned, 'ADD_NOW', { teams: 12, scoring: 'half-ppr' });
  const fourteen = buildFaabGuidance(lowOwned, 'ADD_NOW', { teams: 14, scoring: 'half-ppr' });
  assert.ok(eight.recommendedPct < twelveLow.recommendedPct);
  assert.ok(fourteen.recommendedPct > twelveLow.recommendedPct);
  assert.strictEqual(twelveLow.recommendedPct, twelveHigh.recommendedPct);
});

console.log(`\n${passed} FAAB calibration tests passed.`);
