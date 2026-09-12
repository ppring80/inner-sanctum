'use strict';

// tests/free-agents-ranking.test.js
//
// Regression coverage for the "Best For Me" roster-impact ranking fix in
// netlify/functions/waiver-recommendations.js. Executes the real,
// production buildCustomerRecommendations()/bestForMeCompare() via the
// module's own _test export -- not a reimplementation.
//
// Root cause under test: a provider-reported free-agent pool the vast
// majority of which is not identity-matched to a Weekly SAGE ranking
// row (backups/inactive/practice-squad players) collapsed to the same
// verdict (REVIEW) and the same missing-rank sentinel, leaving the
// final alphabetical tiebreak as the only thing visibly differentiating
// hundreds of players' order.
//
// Run: node tests/free-agents-ranking.test.js

const assert = require('assert');
const {
  _test: {
    buildCustomerRecommendations,
    bestForMeCompare
  }
} = require('../netlify/functions/waiver-recommendations.js');

let passed = 0;
let failed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failed += 1;
    failures.push(`${name} :: ${err && err.message ? err.message : err}`);
  }
}

// Builds a raw "decision" (the shape buildWaiverDecisions() already
// produces) representing a provider-reported free agent with the given
// evidence. Mirrors the real evidence shape without inventing new
// fields the pipeline doesn't already compute.
function decision({
  name,
  position,
  availabilityStatus = 'FREE_AGENT',
  action = 'REVIEW',
  sageMatched = false,
  sage = null,
  rosterImpact = null,
  trend = null,
  percentOwned = null,
  providerProjectedPoints = null,
  active
}) {
  return {
    providerPlayerId: name.replace(/\s+/g, '-').toLowerCase(),
    name,
    position,
    team: 'NE',
    availabilityStatus,
    decision: { action, actionable: action === 'ADD', reasonCode: null, reasons: [] },
    evidence: {
      sage,
      trend,
      rosterImpact,
      percentOwned,
      providerProjectedPoints
    },
    identity: { sageMatched },
    ...(active === undefined ? {} : { active })
  };
}

// A large, realistic-shaped pool: a handful of genuinely SAGE-ranked
// players across verdict tiers, plus ~30 unranked backups/deep-bench
// players (the part of an 875-player pool this fix targets) with
// varying provider projections so a real, non-alphabetical order is
// provable.
function bigUnrankedPool(count, { positions = ['RB', 'WR', 'TE', 'QB', 'K', 'DST'] } = {}) {
  const names = [
    'Aaron Zeta', 'Blake Young', 'Cole Xavier', 'Derek Waters', 'Evan Vance',
    'Felix Underwood', 'Gary Torres', 'Hank Sutton', 'Ivan Reyes', 'Jack Quinn',
    'Kyle Porter', 'Liam Osei', 'Mason Nash', 'Noah Mills', 'Owen Lange',
    'Paul Kirby', 'Quinn Jacobs', 'Ray Ingram', 'Sam Hayes', 'Tom Grant',
    'Umar Ford', 'Vince Ellis', 'Wade Doyle', 'Xander Cole', 'Yusuf Banks',
    'Zack Adams', 'Alan Bright', 'Brian Cross', 'Chris Dunn', 'Drew Estes'
  ];
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push(
      decision({
        name: names[i % names.length] + ' ' + i,
        position: positions[i % positions.length],
        action: 'REVIEW',
        sageMatched: false,
        sage: null,
        rosterImpact: { classification: 'UNKNOWN', weakestComparable: null },
        // Deliberately varied and NOT correlated with alphabetical name
        // order, so a correct fix must reorder away from the input's
        // (alphabetically-seeded) sequence.
        providerProjectedPoints: (i * 37) % 19
      })
    );
  }
  return out;
}

test('raw pool preserves all provider-reported players (no truncation)', () => {
  const pool = bigUnrankedPool(875);
  const recs = buildCustomerRecommendations(pool);
  assert.strictEqual(recs.length, 875, 'every FREE_AGENT/WAIVERS candidate must survive into recommendations');
});

test('PK and DEF remain included in the full pool', () => {
  const pool = [
    decision({ name: 'Some Kicker', position: 'K', action: 'REVIEW', providerProjectedPoints: 6 }),
    decision({ name: 'Some Defense', position: 'DST', action: 'REVIEW', providerProjectedPoints: 5 }),
    ...bigUnrankedPool(20)
  ];
  const recs = buildCustomerRecommendations(pool);
  assert.ok(recs.some((r) => r.name === 'Some Kicker' && r.position === 'K'));
  assert.ok(recs.some((r) => r.name === 'Some Defense' && r.position === 'DST'));
});

test('INELIGIBLE (not provider-available) candidates are still excluded, unchanged behavior', () => {
  const pool = [
    decision({ name: 'Rostered Elsewhere', position: 'WR', availabilityStatus: 'ROSTERED', action: 'INELIGIBLE' }),
    ...bigUnrankedPool(5)
  ];
  const recs = buildCustomerRecommendations(pool);
  assert.ok(!recs.some((r) => r.name === 'Rostered Elsewhere'));
});

test('Best For Me is not alphabetical for a large unranked pool', () => {
  const pool = bigUnrankedPool(200);
  const recs = buildCustomerRecommendations(pool);
  const names = recs.map((r) => r.name);
  const alphabetical = names.slice().sort((a, b) => a.localeCompare(b));
  assert.notDeepStrictEqual(names, alphabetical, 'default order must not equal a pure alphabetical sort');
});

test('a higher-impact player outranks an alphabetically earlier low-impact player', () => {
  const pool = [
    decision({
      name: 'Aaron Alpha', // alphabetically first
      position: 'RB',
      action: 'REVIEW',
      sageMatched: false,
      providerProjectedPoints: 0.4
    }),
    decision({
      name: 'Zeke Zulu', // alphabetically last
      position: 'RB',
      action: 'REVIEW',
      sageMatched: false,
      providerProjectedPoints: 14.8
    })
  ];
  const recs = buildCustomerRecommendations(pool);
  assert.strictEqual(recs[0].name, 'Zeke Zulu', 'meaningfully higher provider projection must outrank alphabetically-earlier name');
  assert.strictEqual(recs[1].name, 'Aaron Alpha');
});

test('rosterImpact UPGRADE outranks UNKNOWN regardless of alphabetical order, within the same verdict tier', () => {
  const pool = [
    decision({
      name: 'Aaron Alpha',
      position: 'WR',
      action: 'WATCH',
      rosterImpact: { classification: 'UNKNOWN', weakestComparable: null },
      providerProjectedPoints: 20
    }),
    decision({
      name: 'Zeke Zulu',
      position: 'WR',
      action: 'WATCH',
      sageMatched: true,
      sage: { position: 'WR', positionRank: 40 },
      rosterImpact: { classification: 'UPGRADE', weakestComparable: { name: 'Bench WR', sage: { positionRank: 55 } } },
      providerProjectedPoints: 5
    })
  ];
  const recs = buildCustomerRecommendations(pool);
  assert.strictEqual(recs[0].name, 'Zeke Zulu', 'a proven roster UPGRADE must outrank an UNKNOWN-impact player even with a lower provider projection');
});

test('FLEX-eligible upgrade outranks a non-FLEX-eligible upgrade when all else is tied', () => {
  const pool = [
    decision({
      name: 'Kelly Kicker',
      position: 'K',
      action: 'WATCH',
      rosterImpact: { classification: 'UPGRADE', weakestComparable: { name: 'Bench K' } },
      providerProjectedPoints: 8
    }),
    decision({
      name: 'Riley Runner',
      position: 'RB',
      action: 'WATCH',
      rosterImpact: { classification: 'UPGRADE', weakestComparable: { name: 'Bench RB' } },
      providerProjectedPoints: 8
    })
  ];
  const recs = buildCustomerRecommendations(pool);
  assert.strictEqual(recs[0].name, 'Riley Runner', 'FLEX-eligible (RB/WR/TE) upgrade should rank ahead of a non-FLEX-eligible upgrade when tied on projection');
});

test('position filtering preserves Best For Me relative order (stable sub-order)', () => {
  const pool = bigUnrankedPool(60);
  const recs = buildCustomerRecommendations(pool);
  const rbNamesInFullOrder = recs.filter((r) => r.position === 'RB').map((r) => r.name);
  const rbOnly = buildCustomerRecommendations(pool.filter((p) => p.position === 'RB'));
  assert.deepStrictEqual(
    rbOnly.map((r) => r.name),
    rbNamesInFullOrder,
    'the relative order of RB players must be identical whether filtered before or after ranking'
  );
});

test('an explicitly inactive player does not outrank an active high-impact player, when status evidence exists', () => {
  const pool = [
    decision({
      name: 'Aaron Alpha',
      position: 'WR',
      action: 'REVIEW',
      providerProjectedPoints: 25, // would otherwise win on projection alone
      active: false
    }),
    decision({
      name: 'Zeke Zulu',
      position: 'WR',
      action: 'REVIEW',
      providerProjectedPoints: 3
    })
  ];
  const recs = buildCustomerRecommendations(pool);
  assert.strictEqual(recs[0].name, 'Zeke Zulu', 'an explicitly inactive player must not outrank an active player on projection alone');
});

test('without active/inactive evidence, ranking is unaffected (forward-compatible no-op today)', () => {
  const pool = [
    decision({ name: 'Aaron Alpha', position: 'WR', action: 'REVIEW', providerProjectedPoints: 25 }),
    decision({ name: 'Zeke Zulu', position: 'WR', action: 'REVIEW', providerProjectedPoints: 3 })
  ];
  const recs = buildCustomerRecommendations(pool);
  assert.strictEqual(recs[0].name, 'Aaron Alpha', 'with no active-status evidence at all, projection still governs as before');
});

test('ownership is a tiebreaker only, applied after every roster-impact signal', () => {
  const pool = [
    decision({ name: 'Aaron Alpha', position: 'TE', action: 'REVIEW', providerProjectedPoints: 5, percentOwned: 40 }),
    decision({ name: 'Zeke Zulu', position: 'TE', action: 'REVIEW', providerProjectedPoints: 5, percentOwned: 12 })
  ];
  const recs = buildCustomerRecommendations(pool);
  assert.strictEqual(recs[0].name, 'Aaron Alpha', 'when every other signal ties, higher ownership breaks the tie');
});

test('alphabetical is the final tiebreak only, once every other signal ties', () => {
  const pool = [
    decision({ name: 'Zeke Zulu', position: 'TE', action: 'REVIEW', providerProjectedPoints: 5, percentOwned: 12 }),
    decision({ name: 'Aaron Alpha', position: 'TE', action: 'REVIEW', providerProjectedPoints: 5, percentOwned: 12 })
  ];
  const recs = buildCustomerRecommendations(pool);
  assert.strictEqual(recs[0].name, 'Aaron Alpha', 'fully tied evidence falls back to alphabetical, and only then');
});

test('verdict tier still takes precedence over roster-impact scoring (verdict meaning unchanged)', () => {
  const pool = [
    decision({ name: 'Aaron Alpha', position: 'RB', action: 'REVIEW', providerProjectedPoints: 30 }),
    decision({ name: 'Zeke Zulu', position: 'RB', action: 'ADD', providerProjectedPoints: 1, sageMatched: true, sage: { position: 'RB', positionRank: 3 }, rosterImpact: { classification: 'UPGRADE', weakestComparable: { name: 'Bench RB' } } })
  ];
  const recs = buildCustomerRecommendations(pool);
  assert.strictEqual(recs[0].verdict, 'ADD_NOW');
  assert.strictEqual(recs[0].name, 'Zeke Zulu', 'ADD_NOW still outranks REVIEW regardless of projection');
});

test('bestForMeCompare is directly usable and symmetric (a,b) === -(b,a) sign for a real pair', () => {
  const a = decision({ name: 'A', position: 'WR', action: 'REVIEW', providerProjectedPoints: 10 });
  const b = decision({ name: 'B', position: 'WR', action: 'REVIEW', providerProjectedPoints: 2 });
  const decoratedA = buildCustomerRecommendations([a])[0];
  const decoratedB = buildCustomerRecommendations([b])[0];
  const forward = bestForMeCompare(decoratedA, decoratedB);
  const backward = bestForMeCompare(decoratedB, decoratedA);
  assert.ok(forward < 0, 'higher projection should sort first (negative comparator result)');
  assert.ok(backward > 0);
});

console.log('');
console.log(`free-agents-ranking.test.js: ${passed}/${passed + failed} passed`);
if (failed > 0) {
  failures.forEach((f) => console.error('FAIL:', f));
  process.exitCode = 1;
}
