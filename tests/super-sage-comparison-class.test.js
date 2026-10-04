'use strict';

// tests/super-sage-comparison-class.test.js
// Surprising recommendations carry a higher burden of proof. A sourced
// projection may resolve an otherwise ORDINARY comparison when the complete
// current evidence is coherent; a projection never overrides contradictory
// evidence. Synthetic names only.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { POLICY, UNCALIBRATED, projectionBandFor } = require('../netlify/functions/_super-sage-decision-policy.js');
const { buildLineupDecisionRecord, DECISION_SCOPE } = require('../netlify/functions/_super-sage-lineup-decision.js');
const { fromSnapshot } = require('../netlify/functions/_super-sage-opportunity-evidence.js');
const { toMcpLineup, toWebsiteLineup } = require('../netlify/functions/_super-sage-lineup-presenters.js');

// TEST-ONLY policy: exercises the ORDINARY resolution mechanism. It is NOT a
// calibration and is never shipped (see the policy-freeze test below).
const TEST_ONLY_CALIBRATED = {
  version: 'test-only', projectionNoiseBand: { status: 'CALIBRATED', values: { global: 1.5 }, provenance: { testOnly: true } },
  nearZeroProjection: POLICY.nearZeroProjection
};

const T0 = '2026-10-03T12:00:00Z';
const p = (name, position, rank, rec, points, extra = {}) => ({ name, position, team: 'XX', rank, recommendation: rec, projectedPoints: points,
  projection: { points, source: 'Tank01', week: 4, scoring: 'half', fresh: true }, availabilityVerified: true, ...extra });
function rankings(extra = []) {
  const positions = { RB: [], WR: [] };
  for (let r = 1; r <= 60; r += 1) {
    const rec = r <= 24 ? 'START' : r <= 48 ? 'FLEX' : 'SIT';
    positions.RB.push(p(`RB filler ${r}`, 'RB', r, rec, r <= 24 ? 14 : r <= 48 ? 8 : 3));
    positions.WR.push(p(`WR filler ${r}`, 'WR', r, rec, r <= 24 ? 14 : r <= 48 ? 8 : 3));
  }
  extra.forEach((x) => { positions[x.position][x.rank - 1] = x; });
  return { metadata: { availability: { updatedAt: T0, fresh: true } }, positions };
}
const { withRawGames } = require('./helpers/opportunity-snapshot.js');
const opp = (map) => fromSnapshot(withRawGames({ weeks: [1, 2, 3], computedAt: T0, records: Object.fromEntries(Object.entries(map).map(([k, [avg, vol]]) => [k, {
  opportunities: { lastGame: avg, avgLast3: avg, avgLast5: avg }, persistence: { gamesSampled: 3 },
  signals: [{ type: 'sampleSize', value: 'adequate' }, { type: 'trendClassification', value: 'stable' }, { type: 'volumeTier', value: vol }] }])) }), { season: 2026, week: 4 });
const slots = [{ slotLabel: 'W/R/T', eligiblePositions: ['RB', 'WR'], count: 1 }];
function run(players, { policy = POLICY, opportunity = null } = {}) {
  return buildLineupDecisionRecord({ rankings: rankings(players), roster: players.map((x) => ({ name: x.name, position: x.position })), slots, scoring: 'half', season: 2026, week: 4, policy, opportunity });
}
const roles = opp({ 'incumbent rb|RB': [11, 'moderate-volume'], 'challenger wr|WR': [7, 'moderate-volume'] });
const INC = p('Incumbent RB', 'RB', 28, 'FLEX', 7.2);
const CH = (points, extra) => p('Challenger WR', 'WR', 46, 'FLEX', points, extra);

let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log('  ok - ' + name); }

test('shipped policy is frozen UNCALIBRATED with provenance; no value is invented', () => {
  assert.strictEqual(POLICY.projectionNoiseBand.status, UNCALIBRATED);
  assert.strictEqual(POLICY.projectionNoiseBand.values, null);
  assert.strictEqual(POLICY.nearZeroProjection.status, UNCALIBRATED);
  assert.strictEqual(POLICY.projectionNoiseBand.provenance.outcome, 'NOT_RUN_DATA_UNAVAILABLE');
  assert.strictEqual(projectionBandFor(POLICY, { scoring: 'half', positions: ['RB', 'WR'], source: 'Tank01' }).calibrated, false);
  assert.ok(Object.isFrozen(POLICY) && Object.isFrozen(POLICY.projectionNoiseBand));
  const src = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', '_super-sage-lineup-decision.js'), 'utf8');
  assert.ok(!/TEST_ONLY|test-only/.test(src), 'no test policy leaks into the decision layer');
});

test('coherent complete evidence is ORDINARY; while uncalibrated, the projection cannot resolve it', () => {
  const r = run([INC, CH(9.3)], { opportunity: roles });
  const s = r.slots[0];
  assert.strictEqual(s.starter.name, 'Incumbent RB');
  assert.strictEqual(s.gate.comparisonClass, 'ORDINARY');
  assert.strictEqual(s.gate.resolution, 'ORDINARY_UNRESOLVED_UNCALIBRATED');
  // An unresolved comparison is a conservative hold, never an edge.
  assert.strictEqual(s.decisionState, 'PROVISIONAL_UNRESOLVED');
  assert.strictEqual(s.hasValidatedEdge, false);
  assert.strictEqual(s.confidence.label, 'Unresolved');
  assert.match(s.explanation.headline, /^PROVISIONAL: START INCUMBENT RB — no validated edge over CHALLENGER WR$/);
  assert.ok(!/(Strong|Moderate|Limited) edge/.test(s.explanation.headline));
  assert.ok(s.explanation.why.some((w) => /not yet been calibrated/.test(w)));
  assert.ok(s.explanation.why.some((w) => /conservative hold, not a validated edge/.test(w)));
});

test('with a calibrated band, a coherent ORDINARY comparison is resolved by a projection gap beyond the band', () => {
  const beyond = run([INC, CH(9.3)], { opportunity: roles, policy: TEST_ONLY_CALIBRATED });
  assert.strictEqual(beyond.slots[0].decidedBy, 'CURRENT_EVIDENCE_COMPARISON');
  assert.strictEqual(beyond.slots[0].starter.name, 'Challenger WR');
  assert.ok(['Moderate', 'Limited'].includes(beyond.slots[0].confidence.label), 'never Strong');
  const within = run([INC, CH(8.0)], { opportunity: roles, policy: TEST_ONLY_CALIBRATED });
  assert.strictEqual(within.slots[0].starter.name, 'Incumbent RB');
  assert.strictEqual(within.slots[0].gate.resolution, 'ORDINARY_WITHIN_NOISE_BAND');
  assert.strictEqual(within.slots[0].decisionState, 'CLOSE_CALL_WITHIN_NOISE');
  assert.strictEqual(within.slots[0].confidence.label, 'Close call');
  assert.strictEqual(within.slots[0].hasValidatedEdge, false);
  assert.strictEqual(beyond.slots[0].decisionState, 'DECIDED');
  assert.strictEqual(beyond.slots[0].hasValidatedEdge, true);
});

test('a projection never overrides contradictory evidence (each contradiction makes the comparison SURPRISING)', () => {
  const cases = {
    'challenger adds uncertainty': [INC, CH(12, { injuryStatus: 'QUESTIONABLE' })],
    'one tier weaker': [INC, p('Challenger WR', 'WR', 52, 'SIT', 12)],
    'challenger baseline REASSESS': [INC, CH(12, { environmentContext: { type: 'QB_AVAILABILITY_CHANGE', note: 'QB out' } })]
  };
  Object.entries(cases).forEach(([label, players]) => {
    const r = run(players, { opportunity: roles, policy: TEST_ONLY_CALIBRATED });
    assert.strictEqual(r.slots[0].starter.name, 'Incumbent RB', label);
    assert.strictEqual(r.slots[0].gate.comparisonClass, 'SURPRISING', label);
    assert.strictEqual(r.slots[0].gate.resolution, 'FORWARD_EVIDENCE_GATE', label);
  });
});

test('position-calibrated volume labels are never ranked across positions; incomplete role evidence is still SURPRISING', () => {
  // RB high-volume vs WR role-player: labels describe each role, but there is
  // no validated mapping between positions, so no contradiction is claimed.
  const labels = opp({ 'incumbent rb|RB': [16, 'high-volume'], 'challenger wr|WR': [3, 'role-player'] });
  const r = run([INC, CH(12)], { opportunity: labels, policy: TEST_ONLY_CALIBRATED });
  assert.ok(!r.slots[0].gate.classReasons.some((x) => /Observed workload contradicts/.test(x)), 'no cross-position label contradiction');
  assert.strictEqual(r.slots[0].gate.comparisonClass, 'ORDINARY');
  // ...and the reverse labelling changes nothing either (label symmetry).
  const reversed = run([INC, CH(12)], { opportunity: opp({ 'incumbent rb|RB': [3, 'role-player'], 'challenger wr|WR': [16, 'high-volume'] }), policy: TEST_ONLY_CALIBRATED });
  assert.strictEqual(reversed.slots[0].gate.comparisonClass, r.slots[0].gate.comparisonClass);
  assert.strictEqual(reversed.slots[0].starter.name, r.slots[0].starter.name);
  // Labels still DESCRIBE each player's own role.
  const described = [r.slots[0].starter, r.slots[0].comparator].map((x) => `${x.name}: ${x.establishedRole.description}`);
  assert.ok(described.some((d) => /^Incumbent RB: Established high-volume role/.test(d)), described.join(' | '));
  assert.ok(described.some((d) => /^Challenger WR: Established role-player role/.test(d)), described.join(' | '));
  const incomplete = run([INC, CH(12)], { policy: TEST_ONLY_CALIBRATED });
  assert.ok(incomplete.slots[0].gate.classReasons.some((x) => /Established-role evidence is incomplete/.test(x)));
});

test('two or more tiers weaker, or an INVALID challenger, is PROHIBITED', () => {
  const two = run([p('Incumbent RB', 'RB', 10, 'START', 14), p('Challenger WR', 'WR', 55, 'SIT', 20)], { opportunity: roles, policy: TEST_ONLY_CALIBRATED });
  assert.strictEqual(two.slots[0].gate.comparisonClass, 'PROHIBITED');
  assert.strictEqual(two.slots[0].gate.resolution, 'PROHIBITED');
  assert.strictEqual(two.slots[0].starter.name, 'Incumbent RB');
});

test('classification and outcome do not depend on input order or names', () => {
  const a = run([INC, CH(9.3)], { opportunity: roles, policy: TEST_ONLY_CALIBRATED });
  const b = run([CH(9.3), INC], { opportunity: roles, policy: TEST_ONLY_CALIBRATED });
  assert.strictEqual(a.decisionId, b.decisionId);
  assert.strictEqual(a.slots[0].starter.name, b.slots[0].starter.name);
});

test('scope is START/SIT: bench never implies DROP, in the record or any presentation', () => {
  const r = run([INC, CH(9.3), p('Backup RB', 'RB', 58, 'SIT', 2)], { opportunity: roles });
  assert.strictEqual(r.decisionScope, DECISION_SCOPE);
  assert.strictEqual(r.rosterValue.assessed, false);
  r.bench.forEach((b) => { assert.strictEqual(b.lineupStatus, 'BENCH'); assert.strictEqual(b.rosterImplication, 'NONE'); });
  const text = JSON.stringify({ e: r.slots.map((s) => s.explanation), mcp: toMcpLineup(r), web: toWebsiteLineup(r), watch: r.benchWatch });
  // The scope disclaimer itself ("does not imply DROP") is the only permitted mention.
  const scrubbed = text.split(r.rosterValue.note).join('').replace(/not use the old rank alone to recommend dropping/gi, '');
  assert.ok(text.includes('does not imply DROP'), 'the disclaimer is present');
  assert.ok(!/\b(drop|release|waive|cut)\b/i.test(scrubbed), 'no DROP recommendation language');
});

console.log('super-sage-comparison-class.test.js: ' + passed + ' passed');
