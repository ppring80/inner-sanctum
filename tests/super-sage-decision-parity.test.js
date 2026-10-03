'use strict';

// tests/super-sage-decision-parity.test.js
//
// The same roster + scoring + week + evidence must produce the same Super SAGE
// decision whether the customer asks through ChatGPT (MCP) or the website.
// Presentation may differ. Decision logic may not.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildLineupDecisionRecord } = require('../netlify/functions/_super-sage-lineup-decision.js');
const { toMcpLineup, toWebsiteLineup, decisionOf } = require('../netlify/functions/_super-sage-lineup-presenters.js');

const PRESENTERS = path.join(__dirname, '..', 'netlify', 'functions', '_super-sage-lineup-presenters.js');

function tierFor(position, rank) {
  if (position === 'QB') return rank <= 12 ? 'START' : 'SIT';
  if (position === 'TE') return rank <= 12 ? 'START' : rank <= 24 ? 'FLEX' : 'SIT';
  return rank <= 24 ? 'START' : rank <= 48 ? 'FLEX' : 'SIT';
}
const proj = (points) => ({ projectedPoints: points, projection: { points, source: 'Tank01', week: 4, scoring: 'half' } });

// A fully ranked synthetic league so every slot is decided.
function fixture() {
  const positions = { QB: [], RB: [], WR: [], TE: [] };
  const sizes = { QB: 32, RB: 70, WR: 100, TE: 40 };
  Object.entries(sizes).forEach(([pos, n]) => {
    for (let rank = 1; rank <= n; rank += 1) positions[pos].push({ name: `${pos}${rank}`, position: pos, team: 'XX', rank, recommendation: tierFor(pos, rank) });
  });
  const set = (pos, rank, extra) => Object.assign(positions[pos][rank - 1], extra);
  set('WR', 30, { environmentContext: { type: 'QB_AVAILABILITY_CHANGE', status: 'REASSESS', note: 'Starting QB OUT.' }, ...proj(9.8) });
  set('RB', 44, { components: { opportunity: { opportunities: { avgLast3: 6.7 } } }, ...proj(10.4) });
  set('RB', 38, { roleContext: { status: 'REASSESS', projectionRecalculated: false, note: 'Backfield change; share not verified.' } });
  const roster = ['QB5', 'QB20', 'RB3', 'RB18', 'RB44', 'RB38', 'WR8', 'WR22', 'WR30', 'WR35', 'WR70', 'TE9']
    .map((name) => ({ name, position: name.replace(/\d+/, '') }));
  roster.push({ name: 'RB60', position: 'RB', rosterStatus: 'IR' });
  const slots = [
    { slotLabel: 'QB', eligiblePositions: ['QB'], count: 1 },
    { slotLabel: 'RB', eligiblePositions: ['RB'], count: 2 },
    { slotLabel: 'WR', eligiblePositions: ['WR'], count: 2 },
    { slotLabel: 'TE', eligiblePositions: ['TE'], count: 1 },
    { slotLabel: 'W/R/T', eligiblePositions: ['RB', 'WR', 'TE'], count: 2 }
  ];
  return { rankings: { positions }, roster, slots, scoring: 'half', season: 2026, week: 4 };
}

const recordDecision = (record) => record.slots.map((s) => ({ slot: s.slotLabel, player: s.starter ? s.starter.name : null, confidence: s.confidence.label }));

let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log('  ok - ' + name); }

test('MCP and website presentations express exactly the record\'s decision', () => {
  const record = buildLineupDecisionRecord(fixture());
  assert.ok(record.slots.every((s) => s.starter), 'fixture decides every slot');
  const expected = recordDecision(record);
  assert.deepStrictEqual(decisionOf(toMcpLineup(record)), expected);
  assert.deepStrictEqual(decisionOf(toWebsiteLineup(record)), expected);
});

test('the record survives the HTTP boundary unchanged (website receives JSON)', () => {
  const record = buildLineupDecisionRecord(fixture());
  const overTheWire = JSON.parse(JSON.stringify(record));
  assert.deepStrictEqual(overTheWire, record);
  assert.deepStrictEqual(decisionOf(toWebsiteLineup(overTheWire)), decisionOf(toMcpLineup(record)));
});

test('the same inputs produce the same decisionId and decision; changed evidence changes the decisionId', () => {
  const a = buildLineupDecisionRecord(fixture());
  const b = buildLineupDecisionRecord(fixture());
  assert.strictEqual(a.decisionId, b.decisionId);
  assert.deepStrictEqual(a, b);
  const changed = fixture();
  changed.rankings.positions.RB[43].projectedPoints = 15;
  changed.rankings.positions.RB[43].projection.points = 15;
  assert.notStrictEqual(buildLineupDecisionRecord(changed).decisionId, a.decisionId);
});

test('roster order does not change the decision or the decisionId', () => {
  const forward = fixture();
  const reversed = fixture();
  reversed.roster.reverse();
  const a = buildLineupDecisionRecord(forward);
  const b = buildLineupDecisionRecord(reversed);
  assert.strictEqual(a.decisionId, b.decisionId);
  assert.deepStrictEqual(recordDecision(a), recordDecision(b));
});

test('presenters import nothing that can decide, sort or score', () => {
  const source = fs.readFileSync(PRESENTERS, 'utf8');
  assert.ok(!/require\(/.test(source.replace(/^\s*\/\/.*$/gm, '')), 'presenters must not require any module');
  assert.ok(!/\.sort\(|lineupPlayerValue|rankingScore|projectedPoints|sageScore/.test(source), 'presenters must not reorder or read scoring fields');
});

test('the parity check catches a consumer that re-decides', () => {
  const record = buildLineupDecisionRecord(fixture());
  // A hypothetical website consumer that "helpfully" re-sorts FLEX by projection.
  const rogue = toWebsiteLineup(record);
  const flexRows = rogue.rows.filter((r) => r.slotLabel === 'W/R/T');
  const benchRb = record.bench.find((p) => p.projection.admissible);
  if (benchRb) flexRows[flexRows.length - 1].playerName = benchRb.name;
  assert.notDeepStrictEqual(decisionOf(rogue), decisionOf(toMcpLineup(record)), 'divergence must be detectable');
});

console.log('super-sage-decision-parity.test.js: ' + passed + ' passed');
