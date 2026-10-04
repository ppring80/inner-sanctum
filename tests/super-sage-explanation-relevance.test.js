'use strict';

// tests/super-sage-explanation-relevance.test.js
//
// Explanations must be decision-relevant and honest about confidence:
//  * a player set aside in an earlier slot is narrated only where that set-aside
//    newly decided a slot; downstream slots carry it as audit data only;
//  * a slot without a validated edge never presents an "edge".
// Rules only; no player-specific outcomes are asserted.

const assert = require('assert');
const { run } = require('../scripts/run-super-sage-week4-acceptance.js');
const { buildLineupDecisionRecord } = require('../netlify/functions/_super-sage-lineup-decision.js');

let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log('  ok - ' + name); }

const textOf = (slot) => [...slot.explanation.why, ...slot.explanation.whatCouldChange, ...slot.explanation.materialFacts].join(' \n ');

function checkRecord(label, record) {
  test(`${label}: a set-aside is narrated once, where it decided a slot`, () => {
    const narrated = new Set();
    record.slots.forEach((slot) => {
      const name = slot.reassessedFrom;
      if (!name) return;
      const text = textOf(slot);
      const involved = [slot.starter && slot.starter.name, slot.comparator && slot.comparator.name].includes(name);
      if (slot.decidedBy !== 'BASELINE_REASSESSED' && !involved) {
        assert.ok(!text.includes(name), `${slot.slotLabel}: ${name} did not take part in this comparison but appears in its explanation`);
      }
      if (slot.decidedBy === 'BASELINE_REASSESSED' && narrated.has(name)) {
        assert.ok(!/leads in Weekly SAGE, but that standing is under REASSESS/.test(text), `${slot.slotLabel}: full ${name} narrative repeated`);
      }
      if (slot.decidedBy === 'BASELINE_REASSESSED') narrated.add(name);
    });
  });

  test(`${label}: every set-aside player still reaches the output through a slot that decided it, or bench/watch`, () => {
    record.slots.filter((s) => s.reassessedFrom).forEach((s) => {
      const name = s.reassessedFrom;
      const inDecidingSlot = record.slots.some((x) => x.reassessedFrom === name && x.decidedBy === 'BASELINE_REASSESSED' && textOf(x).includes(name));
      const onWatch = record.benchWatch.some((w) => w.player === name);
      assert.ok(inDecidingSlot || onWatch, name);
    });
  });

  test(`${label}: no slot without a validated edge presents an edge`, () => {
    record.slots.filter((s) => s.starter).forEach((s) => {
      if (s.hasValidatedEdge === false) {
        assert.ok(!/\bedge\b/.test(s.explanation.headline.replace(/no validated edge/, '')), `${s.slotLabel}: ${s.explanation.headline}`);
        assert.ok(!['Strong', 'Moderate', 'Limited'].includes(s.confidence.label), `${s.slotLabel}: confidence ${s.confidence.label}`);
      }
      if (['ORDINARY_UNRESOLVED_UNCALIBRATED', 'ORDINARY_WITHIN_NOISE_BAND'].includes(s.gate && s.gate.resolution) && s.decidedBy !== 'CURRENT_EVIDENCE_COMPARISON') {
        assert.strictEqual(s.hasValidatedEdge, false, `${s.slotLabel}: unresolved resolution must not claim an edge`);
      }
    });
  });
}

checkRecord('frozen production Week 4', run().record);

// Synthetic: one REASSESS leader set aside in a fixed slot, then FLEX.
const ranks = { positions: { RB: [], WR: [] } };
const row = (name, pos, rank, rec, pts, extra = {}) => ({ name, position: pos, team: 'XX', rank, recommendation: rec,
  projectedPoints: pts, projection: { points: pts, source: 'Tank01', week: 4, scoring: 'half', fresh: true }, availabilityVerified: true, ...extra });
for (let i = 1; i <= 60; i += 1) { ranks.positions.RB.push(row(`R${i}`, 'RB', i, i <= 24 ? 'START' : i <= 48 ? 'FLEX' : 'SIT', 8)); ranks.positions.WR.push(row(`W${i}`, 'WR', i, i <= 24 ? 'START' : i <= 48 ? 'FLEX' : 'SIT', 8)); }
ranks.positions.WR[9] = row('Doubtful Leader', 'WR', 10, 'START', 0.1, { injuryStatus: 'DOUBTFUL' });
ranks.positions.WR[29] = row('Next WR', 'WR', 30, 'FLEX', 9);
ranks.positions.WR[39] = row('Flex WR', 'WR', 40, 'FLEX', 8);
ranks.positions.RB[29] = row('Flex RB', 'RB', 30, 'FLEX', 7);
ranks.metadata = { availability: { updatedAt: '2026-10-03T12:00:00Z', fresh: true } };
const synthetic = buildLineupDecisionRecord({ rankings: ranks, roster: ['Doubtful Leader', 'Next WR', 'Flex WR', 'Flex RB'].map((name) => ({ name, position: name.includes('RB') ? 'RB' : 'WR' })),
  slots: [{ slotLabel: 'WR', eligiblePositions: ['WR'], count: 1 }, { slotLabel: 'W/R/T', eligiblePositions: ['RB', 'WR'], count: 1 }], scoring: 'half', season: 2026, week: 4 });
checkRecord('synthetic set-aside then FLEX', synthetic);

test('synthetic: the downstream FLEX record keeps the set-aside as audit data (carried forward)', () => {
  const flex = synthetic.slots.find((s) => s.slotLabel === 'W/R/T');
  if (flex.reassessedFrom) assert.strictEqual(flex.reassessedFromCarriedForward, true);
});

console.log('super-sage-explanation-relevance.test.js: ' + passed + ' passed');
