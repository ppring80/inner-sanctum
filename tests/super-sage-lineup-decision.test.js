'use strict';

// tests/super-sage-lineup-decision.test.js
//
// Rules of the Super SAGE lineup decision layer, tested on synthetic Weekly
// SAGE rankings shaped like the real builders' output. Assertions are about
// rules, never about specific real players.

const assert = require('assert');
const { decideLineup, explainLineup, buildEvidencePacket } = require('../netlify/functions/_super-sage-lineup-decision.js');
const { SIGNALS } = require('../netlify/functions/_super-sage-signal-registry.js');

const REQUEST = { scoring: 'half', season: 2026, week: 4 };

// Weekly SAGE's own tier cut-offs (12 teams): RB/WR START<=24, FLEX<=48; TE START<=12, FLEX<=24; QB START<=12.
function tierFor(position, rank) {
  if (position === 'QB' || position === 'K' || position === 'DEF') return rank <= 12 ? 'START' : 'SIT';
  if (position === 'TE') return rank <= 12 ? 'START' : rank <= 24 ? 'FLEX' : 'SIT';
  return rank <= 24 ? 'START' : rank <= 48 ? 'FLEX' : 'SIT';
}

function poolRow(position, rank, extra = {}) {
  return { name: `${position} filler ${rank}`, position, team: 'XX', rank, recommendation: tierFor(position, rank), sage: { score: 50 }, ...extra };
}

// Full position pools so tier bounds are real; named players replace pool rows.
function rankings(named) {
  const sizes = { QB: 32, RB: 70, WR: 100, TE: 40 };
  const positions = {};
  Object.entries(sizes).forEach(([pos, n]) => {
    positions[pos] = Array.from({ length: n }, (_, i) => poolRow(pos, i + 1));
  });
  named.forEach((row) => {
    const list = positions[row.position];
    const index = list.findIndex((r) => r.rank === row.rank);
    list[index] = { recommendation: tierFor(row.position, row.rank), ...row };
  });
  return { positions };
}

function projection(points) {
  return { projectedPoints: points, projection: { points, source: 'Tank01', season: 2026, week: 4, scoring: 'half', fresh: true } };
}

const SLOTS_ONE_FLEX = [{ slotLabel: 'W/R/T', eligiblePositions: ['RB', 'WR', 'TE'], count: 1 }];

function decide(named, { slots = SLOTS_ONE_FLEX, roster, registry } = {}) {
  const r = rankings(named);
  const candidates = (roster || named).map((row) => ({ name: row.name, position: row.position, rosterStatus: row.rosterStatus || null,
    row: r.positions[row.position].find((x) => x.name === row.name) }));
  return decideLineup({ rankings: r, candidates, slots, ...REQUEST, registry });
}

let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log('  ok - ' + name); }

test('within a position, Weekly SAGE order decides', () => {
  const d = decide([
    { name: 'Alpha', position: 'WR', rank: 30 },
    { name: 'Bravo', position: 'WR', rank: 12 }
  ], { slots: [{ slotLabel: 'WR', eligiblePositions: ['WR'], count: 1 }] });
  assert.strictEqual(d.slots[0].starter.name, 'Bravo');
  assert.strictEqual(d.slots[0].decidedBy, 'WITHIN_POSITION_ORDER');
});

test('raw scores and position-specific ranking values never decide across positions', () => {
  // The RB has a far larger raw score and ranking value but a weaker Weekly SAGE standing.
  const d = decide([
    { name: 'Raw RB', position: 'RB', rank: 44, sage: { score: 95, rankingScore: 92 } },
    { name: 'Steady WR', position: 'WR', rank: 27, sage: { score: 41 }, rankingScore: 60 }
  ]);
  assert.strictEqual(d.slots[0].starter.name, 'Steady WR');
});

test('evidence packets read the ranking value from either builder shape', () => {
  const nested = buildEvidencePacket({ name: 'A', position: 'RB', row: { rank: 3, recommendation: 'START', sage: { rankingScore: 70 } } }, REQUEST);
  const top = buildEvidencePacket({ name: 'B', position: 'WR', row: { rank: 3, recommendation: 'START', rankingScore: 71, sage: { score: 40 } } }, REQUEST);
  assert.strictEqual(nested.baseline.rankingValue, 70);
  assert.strictEqual(top.baseline.rankingValue, 71);
});

test('observed workload, matchup and a higher projection together cannot displace an established option', () => {
  const d = decide([
    { name: 'Busy RB', position: 'RB', rank: 41, matchup: 'Positive', components: { opportunity: { opportunities: { avgLast3: 11 } } }, ...projection(13.4) },
    { name: 'Established WR', position: 'WR', rank: 27, ...projection(10.2) }
  ]);
  const slot = d.slots[0];
  assert.strictEqual(slot.starter.name, 'Established WR');
  assert.strictEqual(slot.decidedBy, 'ESTABLISHED_BASELINE_PRESERVED');
  assert.deepStrictEqual(slot.blockedChallengers[0].failed, ['VALIDATED_FORWARD_EVIDENCE']);
  const codes = slot.gate.notAdmissible.map((n) => n.code).sort();
  assert.deepStrictEqual(codes, ['MATCHUP', 'OBSERVED_OPPORTUNITY']);
});

test('a promoted verified signal + projection + same tier + no added uncertainty passes the gate', () => {
  const registry = { ...SIGNALS, 'test-promoted-rb-role': { status: 'promoted', positions: ['RB'], summary: 'test' } };
  const d = decide([
    { name: 'Rising RB', position: 'RB', rank: 41, superSageSignals: [{ id: 'test-promoted-rb-role', direction: 'up', verified: true }], ...projection(13.4) },
    { name: 'Established WR', position: 'WR', rank: 27, ...projection(10.2) }
  ], { registry });
  assert.strictEqual(d.slots[0].starter.name, 'Rising RB');
  assert.strictEqual(d.slots[0].decidedBy, 'DISPLACEMENT_GATE_PASSED');
  assert.ok(d.slots[0].gate.conditions.every((c) => c.passed));
});

test('a projection never overrides contradictory or incomplete evidence, however large', () => {
  // Approved semantics: a sourced projection may resolve an otherwise ORDINARY
  // comparison when the complete current evidence is coherent. Here the
  // established-role evidence is incomplete, so the comparison is SURPRISING
  // and keeps the forward-evidence burden.
  const d = decide([
    { name: 'Projected RB', position: 'RB', rank: 41, ...projection(25) },
    { name: 'Established WR', position: 'WR', rank: 27, ...projection(6) }
  ]);
  assert.strictEqual(d.slots[0].starter.name, 'Established WR');
  assert.strictEqual(d.slots[0].gate.comparisonClass, 'SURPRISING');
  assert.ok(d.slots[0].gate.classReasons.some((r) => /Established-role evidence is incomplete/.test(r)));
  assert.strictEqual(d.slots[0].gate.resolution, 'FORWARD_EVIDENCE_GATE');
});

test('candidate, observed, rejected and unverified signals cannot displace', () => {
  for (const id of ['turbine5-v3-causal-availability-transition-te', 'turbine5-v3-causal-availability-transition-rb', 'turbine5-v1-opportunity-share-magnitude']) {
    const position = id.endsWith('-te') ? 'TE' : 'RB';
    const rank = position === 'TE' ? 20 : 41;
    const d = decide([
      { name: 'Signal player', position, rank, superSageSignals: [{ id, direction: 'up', verified: true }], ...projection(14) },
      { name: 'Established WR', position: 'WR', rank: 27, ...projection(9) }
    ]);
    assert.strictEqual(d.slots[0].starter.name, 'Established WR', id);
    assert.ok(d.slots[0].gate.notAdmissible.some((n) => n.code === 'UNPROMOTED_SIGNAL'), id);
  }
  const registry = { ...SIGNALS, 'test-promoted': { status: 'promoted', positions: ['RB'] } };
  const unverified = decide([
    { name: 'Unverified RB', position: 'RB', rank: 41, superSageSignals: [{ id: 'test-promoted', direction: 'up', verified: false }], ...projection(14) },
    { name: 'Established WR', position: 'WR', rank: 27, ...projection(9) }
  ], { registry });
  assert.strictEqual(unverified.slots[0].starter.name, 'Established WR');
});

test('added uncertainty on the challenger blocks displacement even with promoted evidence', () => {
  const registry = { ...SIGNALS, 'test-promoted': { status: 'promoted', positions: ['RB'] } };
  const d = decide([
    { name: 'Rising RB', position: 'RB', rank: 41, rosterStatus: 'Q', superSageSignals: [{ id: 'test-promoted', direction: 'up', verified: true }], ...projection(14) },
    { name: 'Established WR', position: 'WR', rank: 27, ...projection(9) }
  ], { registry, roster: [{ name: 'Rising RB', position: 'RB', rosterStatus: 'Q' }, { name: 'Established WR', position: 'WR' }] });
  assert.strictEqual(d.slots[0].starter.name, 'Established WR');
  assert.deepStrictEqual(d.slots[0].blockedChallengers[0].failed, ['NO_ADDED_UNCERTAINTY']);
});

test('a weaker Weekly SAGE tier never displaces, whatever the other evidence', () => {
  const registry = { ...SIGNALS, 'test-promoted': { status: 'promoted', positions: ['RB'] } };
  const d = decide([
    { name: 'Deep RB', position: 'RB', rank: 55, superSageSignals: [{ id: 'test-promoted', direction: 'up', verified: true }], ...projection(20) },
    { name: 'Established WR', position: 'WR', rank: 40, ...projection(8) }
  ], { registry });
  assert.strictEqual(d.slots[0].starter.name, 'Established WR');
  assert.ok(d.slots[0].blockedChallengers[0].failed.includes('TIER'));
});

test('missing or unlabelled projections keep the established option and create no alternative ranking', () => {
  const missing = decide([
    { name: 'Busy RB', position: 'RB', rank: 41 },
    { name: 'Established WR', position: 'WR', rank: 27 }
  ]);
  const unlabelled = decide([
    { name: 'Busy RB', position: 'RB', rank: 41, projectedPoints: 15 },
    { name: 'Established WR', position: 'WR', rank: 27, projectedPoints: 7 }
  ]);
  for (const d of [missing, unlabelled]) {
    assert.strictEqual(d.slots[0].starter.name, 'Established WR');
    assert.ok(d.slots[0].blockedChallengers[0].failed.includes('COMMON_UNIT_PROJECTION'));
  }
  const wrongWeek = buildEvidencePacket({ name: 'A', position: 'RB', row: { rank: 3, recommendation: 'START', projectedPoints: 9,
    projection: { points: 9, source: 'Tank01', week: 3, scoring: 'half' } } }, REQUEST);
  assert.strictEqual(wrongWeek.projection.admissible, false);
});

test('decisions depend on evidence, not names', () => {
  const a = decide([
    { name: 'Name One', position: 'RB', rank: 41, ...projection(13) },
    { name: 'Name Two', position: 'WR', rank: 27, ...projection(10) }
  ]);
  const b = decide([
    { name: 'Name Two', position: 'RB', rank: 41, ...projection(13) },
    { name: 'Name One', position: 'WR', rank: 27, ...projection(10) }
  ]);
  assert.strictEqual(a.slots[0].starter.position, 'WR');
  assert.strictEqual(b.slots[0].starter.position, 'WR');
  assert.notStrictEqual(a.slots[0].starter.name, b.slots[0].starter.name);
});

test('unavailable players never start; questionable players start with recorded uncertainty', () => {
  const d = decide([
    { name: 'Injured RB', position: 'RB', rank: 5 },
    { name: 'Questionable WR', position: 'WR', rank: 10 }
  ], { roster: [{ name: 'Injured RB', position: 'RB', rosterStatus: 'IR' }, { name: 'Questionable WR', position: 'WR', rosterStatus: 'Q' }] });
  assert.strictEqual(d.slots[0].starter.name, 'Questionable WR');
  assert.ok(d.slots[0].starter.uncertainty.some((u) => u.code === 'INJURY_DESIGNATION'));
  assert.deepStrictEqual(d.unavailable.map((p) => p.name), ['Injured RB']);
});

test('the explanation is derived only from the decision record', () => {
  const qbNote = 'Offensive environment change: Starter QB (OUT) unavailable.';
  const d = decide([
    { name: 'Busy RB', position: 'RB', rank: 41, components: { opportunity: { opportunities: { avgLast3: 6.7 } } }, ...projection(11) },
    { name: 'Established WR', position: 'WR', rank: 27, team: 'TB', environmentContext: { type: 'QB_AVAILABILITY_CHANGE', status: 'REASSESS', note: qbNote }, ...projection(10) }
  ]);
  const e = explainLineup(d).slots[0];
  // Intentional change (approved baseline validity): the verified QB change puts
  // the starter's baseline under REASSESS, which caps confidence at Limited.
  assert.strictEqual(d.slots[0].starter.baselineValidity.state, 'REASSESS');
  assert.strictEqual(e.headline, 'START ESTABLISHED WR over BUSY RB — Limited edge');
  assert.ok(e.why.some((w) => /stronger established Weekly SAGE standing/.test(w)));
  assert.ok(e.why.some((w) => /6\.7 recent opportunities per game are observed workload, not a verified forecast/.test(w)));
  assert.ok(e.materialFacts.some((m) => m.includes(qbNote)), 'material state change in the initial output');
  assert.ok(e.whatCouldChange.some((w) => /validated evidence of a larger role for Busy RB/.test(w)));
  assert.ok(e.whatCouldChange.some((w) => /TB offensive evidence/.test(w)));
  assert.strictEqual(e.decidedBy, d.slots[0].decidedBy);
  // Nothing in the explanation refers to evidence that was not part of the record.
  assert.ok(!e.why.some((w) => /matchup/i.test(w)), 'matchup did not decide, so it is not offered as a reason');
});

test('an exact cross-position standing tie is a Limited-confidence close call, never decided by cross-position rank', () => {
  // TE14 and WR27 sit at the same depth of their FLEX tiers.
  const d = decide([
    { name: 'Tied TE', position: 'TE', rank: 14, ...projection(9) },
    { name: 'Tied WR', position: 'WR', rank: 27, ...projection(10) }
  ]);
  assert.strictEqual(d.slots[0].decidedBy, 'BASELINE_TIE');
  assert.strictEqual(d.slots[0].starter.name, 'Tied WR', 'tie broken by common-unit projection, not by TE14 < WR27');
  assert.strictEqual(d.slots[0].confidence.label, 'Limited');
});

test('the same evidence in any input order produces the same decision', () => {
  const named = [
    { name: 'A RB', position: 'RB', rank: 30 }, { name: 'B WR', position: 'WR', rank: 31 },
    { name: 'C TE', position: 'TE', rank: 15 }, { name: 'D RB', position: 'RB', rank: 60 }
  ];
  const slots = [{ slotLabel: 'W/R/T', eligiblePositions: ['RB', 'WR', 'TE'], count: 2 }];
  const forward = decide(named, { slots }).slots.map((s) => s.starter.name);
  const reverse = decide(named.slice().reverse(), { slots }).slots.map((s) => s.starter.name);
  assert.deepStrictEqual(forward, reverse);
});

test('missing standing for several legal options produces NO CALL, never an arbitrary pick', () => {
  const r = { positions: { WR: [{ name: 'Zeta WR', position: 'WR' }, { name: 'Alpha WR', position: 'WR' }] } };
  const d = decideLineup({ rankings: r, candidates: r.positions.WR.map((row) => ({ name: row.name, position: 'WR', row })),
    slots: [{ slotLabel: 'WR', eligiblePositions: ['WR'], count: 1 }], ...REQUEST });
  assert.strictEqual(d.slots[0].decidedBy, 'INSUFFICIENT_EVIDENCE');
  assert.strictEqual(d.slots[0].starter, null);
  const e = explainLineup(d).slots[0];
  assert.match(e.headline, /NO SUPER SAGE CALL for WR — evidence missing/);
  assert.strictEqual(e.confidence, 'None');
});

test('an unranked player fills a slot only when genuinely the only legal option', () => {
  const r = { positions: { TE: [{ name: 'Only TE', position: 'TE' }] } };
  const d = decideLineup({ rankings: r, candidates: [{ name: 'Only TE', position: 'TE', row: r.positions.TE[0] }],
    slots: [{ slotLabel: 'TE', eligiblePositions: ['TE'], count: 1 }], ...REQUEST });
  assert.strictEqual(d.slots[0].decidedBy, 'UNRANKED_FILL');
  assert.strictEqual(d.slots[0].confidence.label, 'Limited');
});

console.log('super-sage-lineup-decision.test.js: ' + passed + ' passed');
