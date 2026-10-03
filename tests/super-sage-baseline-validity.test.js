'use strict';

// tests/super-sage-baseline-validity.test.js
// Rankings are priors. Current football state decides whether the prior still
// deserves authority. Synthetic names only; no player-specific outcomes.

const assert = require('assert');
const { assessBaselineValidity, resolveStatus, tierProjectionMedians } = require('../netlify/functions/_super-sage-baseline-validity.js');
const { POLICY } = require('../netlify/functions/_super-sage-decision-policy.js');
const { decideLineup, buildLineupDecisionRecord } = require('../netlify/functions/_super-sage-lineup-decision.js');

const T0 = '2026-10-03T12:00:00Z', T1 = '2026-10-03T20:00:00Z';
const fresh = (family, status, asOf = T0) => ({ family, source: family, status, asOf, fresh: true });
const proj = (points) => ({ admissible: true, points, fresh: true, source: 'Tank01', updatedAt: T0 });
const START = { tier: 'START', tierIndex: 0, positionRank: 10 };
const MEDIANS = { START: 14, FLEX: 8, SIT: 3 };
const assess = (o) => assessBaselineValidity({ position: 'WR', policy: POLICY, tierMedians: MEDIANS, standing: START, projection: proj(12), ...o });

let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log('  ok - ' + name); }

test('no contradicting evidence: VALID, the prior governs', () => {
  const v = assess({ statusEvidence: [fresh('production-availability', 'ACTIVE')] });
  assert.strictEqual(v.state, 'VALID');
  assert.strictEqual(v.authority, 'GOVERNS');
});

test('fresh OUT/IR: UNAVAILABLE', () => {
  for (const s of ['OUT', 'IR', 'SUSP']) assert.strictEqual(assess({ statusEvidence: [fresh('production-availability', s)] }).state, 'UNAVAILABLE');
});

test('DOUBTFUL alone (one source family): REASSESS, never INVALID', () => {
  const v = assess({ statusEvidence: [fresh('production-availability', 'DOUBTFUL')], projection: proj(12) });
  assert.strictEqual(v.state, 'REASSESS');
  assert.strictEqual(v.authority, 'GOVERNS_WITHOUT_BENEFIT_OF_DOUBT');
  assert.ok(v.triggers.some((t) => t.code === 'STATUS_DOUBTFUL'));
});

test('INVALID requires corroboration: OUT-leaning status + fresh near-zero projection (uncalibrated rule: exactly zero)', () => {
  const zero = assess({ statusEvidence: [fresh('production-availability', 'DOUBTFUL')], projection: proj(0) });
  assert.strictEqual(zero.state, 'INVALID');
  assert.strictEqual(zero.authority, 'SUSPENDED');
  assert.deepStrictEqual(zero.triggers.map((t) => t.code).slice(0, 2), ['STATUS_DOUBTFUL', 'NEAR_ZERO_PROJECTION']);
  const tiny = assess({ statusEvidence: [fresh('production-availability', 'DOUBTFUL')], projection: proj(0.02) });
  assert.strictEqual(tiny.state, 'REASSESS', 'uncalibrated near-zero is exactly zero; 0.02 does not corroborate');
});

test('a near-zero projection alone (no OUT-leaning status) is not INVALID', () => {
  const v = assess({ statusEvidence: [fresh('production-availability', 'ACTIVE')], projection: proj(0) });
  assert.notStrictEqual(v.state, 'INVALID');
});

test('stale or unsourced projections invalidate nothing', () => {
  const stale = assess({ statusEvidence: [fresh('production-availability', 'DOUBTFUL')], projection: { admissible: true, points: 0, fresh: false, source: 'Tank01' } });
  assert.strictEqual(stale.state, 'REASSESS');
  const unsourced = assess({ statusEvidence: [fresh('production-availability', 'DOUBTFUL')], projection: { admissible: false, points: 0 } });
  assert.strictEqual(unsourced.state, 'REASSESS');
});

test('stale OUT cannot remove a player; it can only prompt reassessment', () => {
  const v = assess({ statusEvidence: [{ family: 'old-feed', source: 'old feed', status: 'OUT', asOf: T0, fresh: false }, fresh('production-availability', 'ACTIVE')] });
  assert.strictEqual(v.state, 'REASSESS');
  assert.ok(v.triggers.some((t) => t.code === 'STALE_STATUS'));
});

test('conflicting fresh sources: the most severe status applies and the conflict is recorded', () => {
  const v = assess({ statusEvidence: [fresh('provider-roster', 'Q'), fresh('production-availability', 'DOUBTFUL')] });
  assert.strictEqual(v.effectiveStatus.status, 'DOUBTFUL');
  assert.ok(v.conflict && v.conflict.length === 2);
  assert.ok(v.triggers.some((t) => t.code === 'SOURCE_CONFLICT'));
});

test('within one source family the newest report wins (an upgrade is honoured)', () => {
  const r = resolveStatus([fresh('production-availability', 'DOUBTFUL', T0), fresh('production-availability', 'ACTIVE', T1)]);
  assert.strictEqual(r.effective.statusClass, 'ACTIVE');
  const v = assess({ statusEvidence: [fresh('production-availability', 'DOUBTFUL', T0), fresh('production-availability', 'ACTIVE', T1)] });
  assert.strictEqual(v.state, 'VALID');
});

test('verified QB change, role change, Q and unverified availability each trigger REASSESS', () => {
  assert.strictEqual(assess({ statusEvidence: [], stateChanges: [{ type: 'QB_AVAILABILITY_CHANGE', note: 'QB out' }] }).state, 'REASSESS');
  assert.strictEqual(assess({ statusEvidence: [], stateChanges: [{ type: 'ROLE_CHANGE', redistributionVerified: false }] }).state, 'REASSESS');
  assert.strictEqual(assess({ statusEvidence: [fresh('provider-roster', 'Q')] }).state, 'REASSESS');
  assert.strictEqual(assess({ statusEvidence: [fresh('production-availability', 'UNVERIFIED')] }).state, 'REASSESS');
});

test('a fresh projection below the next-lower tier median contradicts the standing (REASSESS, no constant)', () => {
  const v = assess({ statusEvidence: [], projection: proj(7) });
  assert.strictEqual(v.state, 'REASSESS');
  assert.ok(v.triggers.some((t) => t.code === 'PROJECTION_CONTRADICTS_STANDING'));
  assert.strictEqual(assess({ statusEvidence: [], projection: proj(9) }).state, 'VALID');
});

test('missing evidence triggers nothing', () => {
  const v = assess({ statusEvidence: [], projection: { admissible: false } });
  assert.strictEqual(v.state, 'VALID');
});

// ---------- consequences inside the decision layer (synthetic names) ----------
const ROWS = (wr) => ({ metadata: { availability: { updatedAt: T0, fresh: true } }, positions: { WR: wr } });
const row = (name, rank, rec, points, extra = {}) => ({ name, position: 'WR', team: 'XX', rank, recommendation: rec,
  projectedPoints: points, projection: { points, source: 'Tank01', week: 4, scoring: 'half', fresh: true }, availabilityVerified: true, ...extra });
function wrPool(extra) {
  const list = [];
  for (let r = 1; r <= 60; r += 1) list.push(row(`Filler ${r}`, r, r <= 24 ? 'START' : r <= 48 ? 'FLEX' : 'SIT', r <= 24 ? 14 : r <= 48 ? 8 : 3));
  return list.map((x) => extra[x.rank] ? { ...x, ...extra[x.rank] } : x);
}
const decideWR = (wrRows, names, statusUpdates = []) => decideLineup({
  rankings: ROWS(wrRows),
  candidates: names.map((n) => ({ name: n, position: 'WR', row: wrRows.find((x) => x.name === n) })),
  slots: [{ slotLabel: 'WR', eligiblePositions: ['WR'], count: 1 }], scoring: 'half', season: 2026, week: 4, statusUpdates
});

test('a REASSESS leader gives way to a VALID same-position rival (next tier) with a higher fresh projection; rank is unchanged', () => {
  const rows = wrPool({ 19: { name: 'Leader', injuryStatus: 'DOUBTFUL', projectedPoints: 0.02, projection: { points: 0.02, source: 'Tank01', week: 4, scoring: 'half', fresh: true } }, 35: { name: 'Rival' } });
  const d = decideWR(rows, ['Leader', 'Rival']);
  assert.strictEqual(d.slots[0].decidedBy, 'BASELINE_REASSESSED');
  assert.strictEqual(d.slots[0].starter.name, 'Rival');
  const leader = d.packets.find((p) => p.name === 'Leader');
  assert.strictEqual(leader.baselineValidity.state, 'REASSESS');
  assert.strictEqual(leader.baseline.positionRank, 19, 'no numeric penalty: the rank is untouched');
});

test('a REASSESS leader keeps its place when the rival has no higher fresh projection', () => {
  const rows = wrPool({ 19: { name: 'Leader', injuryStatus: 'QUESTIONABLE' }, 35: { name: 'Rival' } });
  const d = decideWR(rows, ['Leader', 'Rival']);
  assert.strictEqual(d.slots[0].starter.name, 'Leader');
  assert.strictEqual(d.slots[0].confidence.label, 'Limited');
});

test('an INVALID baseline never orders anyone and starts only when no other legal option exists', () => {
  const invalid = { name: 'Suspended', injuryStatus: 'DOUBTFUL', projectedPoints: 0, projection: { points: 0, source: 'Tank01', week: 4, scoring: 'half', fresh: true } };
  const withRival = decideWR(wrPool({ 3: invalid, 50: { name: 'Depth' } }), ['Suspended', 'Depth']);
  assert.strictEqual(withRival.slots[0].starter.name, 'Depth');
  const alone = decideWR(wrPool({ 3: invalid }), ['Suspended']);
  assert.strictEqual(alone.slots[0].decidedBy, 'INVALID_BASELINE_ONLY_OPTION');
  assert.strictEqual(alone.slots[0].confidence.label, 'Limited');
});

test('a newer verified upgrade restores the prior\'s authority', () => {
  const rows = wrPool({ 19: { name: 'Leader', injuryStatus: 'DOUBTFUL' }, 35: { name: 'Rival' } });
  const d = decideWR(rows, ['Leader', 'Rival'], [{ name: 'Leader', position: 'WR', family: 'production-availability', status: 'ACTIVE', asOf: T1 }]);
  assert.strictEqual(d.packets.find((p) => p.name === 'Leader').baselineValidity.state, 'VALID');
  assert.strictEqual(d.slots[0].starter.name, 'Leader');
});

test('validity depends on evidence, not names', () => {
  const ev = { injuryStatus: 'DOUBTFUL', projectedPoints: 0.02, projection: { points: 0.02, source: 'Tank01', week: 4, scoring: 'half', fresh: true } };
  const a = decideWR(wrPool({ 19: { name: 'Alpha', ...ev }, 35: { name: 'Beta' } }), ['Alpha', 'Beta']);
  const b = decideWR(wrPool({ 19: { name: 'Beta', ...ev }, 35: { name: 'Alpha' } }), ['Alpha', 'Beta']);
  assert.strictEqual(a.slots[0].starter.baseline.positionRank, b.slots[0].starter.baseline.positionRank);
  assert.notStrictEqual(a.slots[0].starter.name, b.slots[0].starter.name);
});

test('tier medians use only fresh, sourced, scoring-matched projections', () => {
  const m = tierProjectionMedians({ positions: { WR: [row('a', 1, 'START', 10), row('b', 2, 'START', 20), { ...row('c', 3, 'START', 99), projection: { points: 99, source: 'Tank01', fresh: false } }] } }, { scoring: 'half' });
  assert.strictEqual(m.WR.START, 15);
});

console.log('super-sage-baseline-validity.test.js: ' + passed + ' passed');
