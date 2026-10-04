'use strict';

// tests/super-sage-week4-metamorphic.test.js
//
// Metamorphic tests on the FROZEN production Week 4 rankings. Each perturbs
// evidence and asserts the decision follows the evidence. No test asserts
// which named player should start.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildLineupDecisionRecord } = require('../netlify/functions/_super-sage-lineup-decision.js');
const { fromSnapshot } = require('../netlify/functions/_super-sage-opportunity-evidence.js');
const { normalizePlayerName } = require('../netlify/functions/opportunity-intel.js');

const DIR = path.join(__dirname, 'fixtures', 'super-sage-week4');
const CAPTURE = path.join(DIR, 'production-rankings.json');
const PINNED_SHA = '12623998d9110f2e757e5f67405d851a7788ccdbe4ad6a384d553291eb01c535';

if (!fs.existsSync(CAPTURE)) { console.log('  skip - production capture not present'); console.log('super-sage-week4-metamorphic.test.js: 0 passed'); process.exit(0); }

const bytes = fs.readFileSync(CAPTURE);
const RANKINGS = JSON.parse(bytes.toString('utf8'));
const ROSTER = JSON.parse(fs.readFileSync(path.join(DIR, 'roster.json'), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const TEST_ONLY_CALIBRATED = { version: 'test-only', projectionNoiseBand: { status: 'CALIBRATED', values: { global: 1.5 }, provenance: { testOnly: true } },
  nearZeroProjection: { status: 'UNCALIBRATED', fractionOfTierMedian: null, uncalibratedRule: 'EXACT_ZERO', provenance: {} } };

function run({ rankings = RANKINGS, roster = ROSTER.roster, ...rest } = {}) {
  return buildLineupDecisionRecord({ rankings, roster, slots: ROSTER.slots, scoring: ROSTER.scoring, season: ROSTER.season, week: ROSTER.week, ...rest });
}
const starters = (r) => r.slots.map((s) => (s.starter ? `${s.starter.position}${s.starter.baseline.positionRank}` : null));
const allPackets = (r) => [...r.slots.flatMap((s) => [s.starter, s.comparator]), ...r.bench, ...r.unavailable].filter(Boolean);

// TEST-ONLY observed snapshot giving every rostered RB/WR/TE the same
// established moderate role, so ORDINARY comparisons can exist mechanically.
const { withRawGames } = require('./helpers/opportunity-snapshot.js');
const equalRoles = fromSnapshot(withRawGames({ weeks: [1, 2, 3], computedAt: '2026-09-30T00:00:00Z', records: Object.fromEntries(ROSTER.roster
  .filter((p) => ['RB', 'WR', 'TE'].includes(p.position)).map((p) => [`${normalizePlayerName(p.name)}|${p.position}`, {
    opportunities: { lastGame: 8, avgLast3: 8, avgLast5: 8 }, persistence: { gamesSampled: 3 },
    signals: [{ type: 'sampleSize', value: 'adequate' }, { type: 'trendClassification', value: 'stable' }, { type: 'volumeTier', value: 'moderate-volume' }] }])) }),
  { season: ROSTER.season, week: ROSTER.week });

let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log('  ok - ' + name); }

test('the frozen production capture is the pinned bytes', () => {
  assert.strictEqual(crypto.createHash('sha256').update(bytes).digest('hex'), PINNED_SHA);
});

test('reversing roster order leaves the decisionId and decision identical', () => {
  const a = run();
  const b = run({ roster: ROSTER.roster.slice().reverse() });
  assert.strictEqual(a.decisionId, b.decisionId);
  assert.deepStrictEqual(starters(a), starters(b));
});

test('swapping two players\' names swaps only the names: the decision follows the evidence', () => {
  const base = run();
  const benchWR = base.bench.filter((p) => p.position === 'WR').map((p) => p.name);
  const startWR = base.slots.filter((s) => s.starter && s.starter.position === 'WR').map((s) => s.starter.name);
  const [x, y] = [startWR[0], benchWR[0]];
  assert.ok(x && y, 'need one started and one benched WR');
  const swap = (n) => (n === x ? y : n === y ? x : n);
  const rankings = clone(RANKINGS);
  rankings.positions.WR.forEach((row) => {
    if (normalizePlayerName(row.name) === normalizePlayerName(x)) row.name = y;
    else if (normalizePlayerName(row.name) === normalizePlayerName(y)) row.name = x;
  });
  const swapped = run({ rankings, roster: ROSTER.roster.map((p) => ({ ...p, name: swap(p.name) })) });
  assert.deepStrictEqual(starters(swapped), starters(base), 'same evidence starts in the same slots');
  assert.deepStrictEqual(swapped.slots.map((s) => s.starter && swap(s.starter.name)), base.slots.map((s) => s.starter && s.starter.name));
});

test('a newer verified upgrade to ACTIVE removes a DOUBTFUL trigger for any affected player', () => {
  const base = run();
  const doubtful = allPackets(base).filter((p) => p.baselineValidity && p.baselineValidity.effectiveStatus && p.baselineValidity.effectiveStatus.status === 'DOUBTFUL');
  assert.ok(doubtful.length > 0, 'non-vacuous: at least one DOUBTFUL-affected player in the frozen data');
  doubtful.forEach((p) => {
    const after = run({ statusUpdates: [{ name: p.name, position: p.position, family: 'production-availability', status: 'ACTIVE', asOf: '2099-01-01T00:00:00Z' }] });
    const q = allPackets(after).find((x) => x.name === p.name);
    assert.ok(!q.baselineValidity.triggers.some((t) => t.code === 'STATUS_DOUBTFUL'), p.name);
    assert.notStrictEqual(q.baselineValidity.effectiveStatus.status, 'DOUBTFUL');
  });
});

test('adding uncertainty to an ORDINARY challenger makes that comparison SURPRISING', () => {
  const base = run({ opportunity: equalRoles });
  const ordinary = base.slots.filter((s) => s.gate && s.gate.comparisonClass === 'ORDINARY');
  assert.ok(ordinary.length > 0, 'non-vacuous: at least one ORDINARY comparison');
  ordinary.forEach((slot) => {
    const challenger = slot.comparator;
    const rankings = clone(RANKINGS);
    const row = rankings.positions[challenger.position].find((r) => normalizePlayerName(r.name) === normalizePlayerName(challenger.name));
    row.injuryStatus = 'QUESTIONABLE';
    const after = run({ rankings, opportunity: equalRoles });
    const same = after.slots.find((s) => s.slotLabel === slot.slotLabel && s.blockedChallengers.concat(s.comparator ? [{ name: s.comparator.name }] : []).some((b) => b.name === challenger.name));
    const entry = same && (same.comparator && same.comparator.name === challenger.name ? { comparisonClass: same.gate.comparisonClass } : same.blockedChallengers.find((b) => b.name === challenger.name));
    assert.ok(entry && entry.comparisonClass === 'SURPRISING', `${challenger.name}`);
  });
});

test('band mechanics on production rows: inside the band never displaces; beyond it only if ORDINARY', () => {
  const base = run({ opportunity: equalRoles, policy: TEST_ONLY_CALIBRATED });
  const ordinarySlots = base.slots.filter((s) => s.gate && s.gate.comparisonClass === 'ORDINARY');
  assert.ok(ordinarySlots.length > 0, 'non-vacuous: at least one ORDINARY comparison');
  ordinarySlots.forEach((slot) => {
    const inc = slot.decidedBy === 'CURRENT_EVIDENCE_COMPARISON' ? slot.comparator : slot.starter;
    const ch = slot.decidedBy === 'CURRENT_EVIDENCE_COMPARISON' ? slot.starter : slot.comparator;
    const setProjection = (pts) => {
      const rankings = clone(RANKINGS);
      const row = rankings.positions[ch.position].find((r) => normalizePlayerName(r.name) === normalizePlayerName(ch.name));
      row.projectedPoints = pts; row.projection = { ...row.projection, points: pts };
      return run({ rankings, opportunity: equalRoles, policy: TEST_ONLY_CALIBRATED });
    };
    const inside = setProjection(inc.projection.points + 0.75).slots.find((s) => s.slotLabel === slot.slotLabel && (s.starter.name === inc.name || s.starter.name === ch.name));
    assert.notStrictEqual(inside.decidedBy, 'CURRENT_EVIDENCE_COMPARISON');
  });
  assert.ok(base.slots.every((s) => s.decidedBy !== 'CURRENT_EVIDENCE_COMPARISON' || s.gate.comparisonClass === 'ORDINARY'));
});

test('no dependence on an irrelevant alternative: removing a set-aside REASSESS player does not change who is established for that FLEX slot', () => {
  const base = run();
  base.slots.filter((s) => s.reassessedFrom && s.eligiblePositions.length > 1).forEach((slot) => {
    const without = run({ roster: ROSTER.roster.filter((p) => p.name !== slot.reassessedFrom) });
    const same = without.slots.find((s) => s.slotLabel === slot.slotLabel && s.starter && s.starter.name === slot.starter.name);
    assert.ok(same, `${slot.slotLabel}: ${slot.starter.name} stays established without ${slot.reassessedFrom}`);
  });
});

test('the shipped (uncalibrated) policy never resolves any production comparison by projection', () => {
  [run(), run({ opportunity: equalRoles })].forEach((r) => {
    assert.ok(r.slots.every((s) => s.decidedBy !== 'CURRENT_EVIDENCE_COMPARISON'));
    assert.strictEqual(r.policy.projectionNoiseBand, 'UNCALIBRATED');
  });
});

console.log('super-sage-week4-metamorphic.test.js: ' + passed + ' passed');
