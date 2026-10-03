'use strict';

// tests/super-sage-week4-acceptance.test.js
//
// Week 4 Super SAGE acceptance case (CBS, 12 teams, Half-PPR, two W/R/T FLEX).
// There is NO predetermined correct lineup: assertions are rules about how the
// decision was reached, never which named player must start. Runs on the
// stated-evidence fixture always, and on production-rankings.json when it has
// been captured (scripts/capture-super-sage-week4.js).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { run } = require('../scripts/run-super-sage-week4-acceptance.js');
const { decisionOf } = require('../netlify/functions/_super-sage-lineup-presenters.js');

const CAPTURE = path.join(__dirname, 'fixtures', 'super-sage-week4', 'production-rankings.json');

let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log('  ok - ' + name); }

function checkRules(label, result) {
  const { record, roster, mcp, website } = result;
  const unavailableNames = roster.roster.filter((p) => ['IR', 'OUT'].includes(String(p.rosterStatus || '').toUpperCase())).map((p) => p.name);

  test(`${label}: unavailable players never start`, () => {
    record.slots.filter((s) => s.starter).forEach((s) => assert.ok(!unavailableNames.includes(s.starter.name), s.starter.name));
    unavailableNames.forEach((name) => assert.ok(record.unavailable.some((p) => p.name === name), name));
  });

  test(`${label}: every cross-position displacement passed every gate condition with promoted evidence`, () => {
    record.slots.filter((s) => s.decidedBy === 'DISPLACEMENT_GATE_PASSED').forEach((s) => {
      assert.ok(s.gate.conditions.every((c) => c.passed), s.slotLabel);
      assert.ok(s.gate.conditions.find((c) => c.code === 'VALIDATED_FORWARD_EVIDENCE').supporting.length > 0);
    });
  });

  test(`${label}: observed workload and matchup are never the reason a player starts`, () => {
    record.slots.forEach((s) => {
      (s.gate ? s.gate.notAdmissible : []).forEach((n) => assert.ok(['OBSERVED_OPPORTUNITY', 'MATCHUP', 'UNPROMOTED_SIGNAL', 'UNVALIDATED_STATE_CHANGE'].includes(n.code)));
      s.explanation.why.filter((w) => /recent opportunities per game/.test(w))
        .forEach((w) => assert.match(w, /observed workload, not a verified forecast/));
    });
  });

  test(`${label}: missing evidence produces NO CALL, never an arbitrary pick`, () => {
    record.slots.forEach((s) => {
      if (s.decidedBy === 'UNRANKED_FILL') {
        const eligible = [s.starter, ...record.bench].filter((p) => s.eligiblePositions.includes(p.position));
        assert.strictEqual(eligible.length, 1, `${s.slotLabel}: unranked fill only when it is the sole legal option`);
      }
      if (s.decidedBy === 'INSUFFICIENT_EVIDENCE') {
        assert.strictEqual(s.starter, null);
        assert.strictEqual(s.confidence.label, 'None');
      }
    });
  });

  test(`${label}: every verified state change reaches the initial output`, () => {
    const players = [...record.slots.flatMap((s) => [s.starter, s.comparator, ...(s.candidates || [])]), ...record.bench].filter(Boolean);
    const withChanges = [...new Map(players.filter((p) => p.stateChanges.length).map((p) => [p.name, p])).values()];
    withChanges.forEach((p) => {
      const inSlot = record.slots.some((s) => s.explanation.materialFacts.some((m) => m.startsWith(`${p.name}:`)));
      const inWatch = record.benchWatch.some((w) => w.player === p.name);
      assert.ok(inSlot || inWatch, `${p.name}'s state change is not hidden`);
    });
  });

  test(`${label}: unverified role redistribution is labelled as unverified`, () => {
    record.bench.concat(record.slots.map((s) => s.starter).filter(Boolean))
      .flatMap((p) => p.stateChanges.filter((c) => c.type === 'ROLE_CHANGE' && !c.redistributionVerified))
      .forEach((c) => assert.match(c.note, /not verified/));
  });

  const packets = [...record.slots.flatMap((s) => [s.starter, s.comparator, ...(s.candidates || [])]), ...record.bench, ...record.unavailable].filter(Boolean);

  test(`${label}: no INVALID or UNAVAILABLE baseline decides a slot`, () => {
    record.slots.filter((s) => s.starter).forEach((s) => {
      const st = s.starter.baselineValidity.state;
      assert.ok(st !== 'UNAVAILABLE', s.slotLabel);
      if (st === 'INVALID') assert.strictEqual(s.decidedBy, 'INVALID_BASELINE_ONLY_OPTION', s.slotLabel);
    });
  });

  test(`${label}: every player with a fresh OUT-leaning status corroborated by a near-zero fresh projection is INVALID`, () => {
    const { isNearZeroProjection, POLICY } = require('../netlify/functions/_super-sage-decision-policy.js');
    packets.forEach((p) => {
      const eff = p.baselineValidity.effectiveStatus;
      if (eff && eff.status === 'DOUBTFUL' && p.projection.admissible && p.projection.fresh && isNearZeroProjection(POLICY, p.projection.points, null)) {
        assert.strictEqual(p.baselineValidity.state, 'INVALID', p.name);
      }
    });
  });

  test(`${label}: a REASSESS starter never carries more than Limited confidence`, () => {
    record.slots.filter((s) => s.starter && s.starter.baselineValidity.state === 'REASSESS').forEach((s) => assert.strictEqual(s.confidence.label, 'Limited', s.slotLabel));
  });

  test(`${label}: every displacement met its comparison class's burden`, () => {
    record.slots.forEach((s) => {
      if (s.decidedBy === 'CURRENT_EVIDENCE_COMPARISON') { assert.strictEqual(s.gate.comparisonClass, 'ORDINARY'); assert.ok(s.gate.band && s.gate.band.calibrated); }
      if (s.decidedBy === 'DISPLACEMENT_GATE_PASSED') assert.ok(s.gate.comparisonClass !== 'PROHIBITED' && s.gate.conditions.every((c) => c.passed));
    });
  });

  test(`${label}: observed workload never appears as expected opportunity; role expansion is never claimed without validation`, () => {
    packets.forEach((p) => {
      assert.ok(p.expectedOpportunity.every((e) => e.decisionActive === true), p.name);
      if (p.roleExpansion) assert.strictEqual(p.roleExpansion.claimed, p.roleExpansion.validated, p.name);
    });
  });

  test(`${label}: scope is START/SIT and the observed-opportunity source is recorded`, () => {
    assert.strictEqual(record.decisionScope, 'START_SIT');
    record.bench.forEach((b) => assert.strictEqual(b.lineupStatus, 'BENCH'));
    assert.ok(record.observedOpportunity && record.observedOpportunity.status);
    if (record.observedOpportunity.status === 'AVAILABLE') assert.ok(record.observedOpportunity.provenance.weeksIncluded.every((w) => w < record.request.week));
  });

  test(`${label}: MCP and website express the identical decision`, () => {
    assert.deepStrictEqual(decisionOf(mcp), decisionOf(website));
    assert.deepStrictEqual(decisionOf(website), record.slots.map((s) => ({ slot: s.slotLabel, player: s.starter ? s.starter.name : null, confidence: s.confidence.label })));
  });
}

checkRules('stated evidence', run({ preferStated: true }));

test('stated evidence: the material Week 4 facts from the brief reach the initial output', () => {
  const { record } = run({ preferStated: true });
  const allFacts = record.slots.flatMap((s) => s.explanation.materialFacts).concat(record.benchWatch.flatMap((w) => w.notes)).join(' ');
  assert.match(allFacts, /Baker Mayfield \(OUT\)/);
  assert.match(allFacts, /share is not verified/);
});

if (fs.existsSync(CAPTURE)) {
  checkRules('production capture', run());
} else {
  console.log('  skip - production capture not present (run scripts/capture-super-sage-week4.js)');
}

console.log('super-sage-week4-acceptance.test.js: ' + passed + ' passed');
