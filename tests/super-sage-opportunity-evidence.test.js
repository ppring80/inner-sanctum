'use strict';

// tests/super-sage-opportunity-evidence.test.js
// Stable workload describes an established role. Role expansion requires
// evidence. Observed opportunity never becomes expected opportunity.

const assert = require('assert');
const { fromSnapshot, loadObservedOpportunity, observedEvidenceFor, validateSnapshot } = require('../netlify/functions/_super-sage-opportunity-evidence.js');
const { loadDecisionInputs } = require('../netlify/functions/_super-sage-decision-sources.js');
const { buildLineupDecisionRecord } = require('../netlify/functions/_super-sage-lineup-decision.js');
const { SIGNALS } = require('../netlify/functions/_super-sage-signal-registry.js');

const record = (avg, volume = 'moderate-volume', sample = 'adequate', trend = 'stable') => ({
  opportunities: { lastGame: avg, avgLast3: avg, avgLast5: avg }, persistence: { gamesSampled: 3 },
  signals: [{ type: 'sampleSize', value: sample }, { type: 'trendClassification', value: trend }, { type: 'volumeTier', value: volume }]
});
const { withRawGames } = require('./helpers/opportunity-snapshot.js');
// Raw games (the leakage authority) carry exactly the weeks the snapshot claims.
const snap = (weeks, records, season = 2026) => withRawGames({ weeks, records, season });
const store = (map) => ({ async get(key) { return map[key] || null; } });

let passed = 0;
async function test(name, fn) { await fn(); passed += 1; console.log('  ok - ' + name); }

(async () => {
  await test('an as-of window containing only earlier weeks is admitted with provenance', async () => {
    const o = fromSnapshot(snap([1, 2, 3], { 'alpha|RB': record(11) }), { season: 2026, week: 4 });
    assert.strictEqual(o.status, 'AVAILABLE');
    assert.deepStrictEqual(o.provenance.weeksIncluded, [1, 2, 3]);
  });

  await test('leakage guard: any snapshot that includes the target week or later is rejected', async () => {
    for (const weeks of [[1, 2, 3, 4], [4], [1, 5]]) {
      const o = fromSnapshot(snap(weeks, { 'alpha|RB': record(11) }), { season: 2026, week: 4 });
      assert.strictEqual(o.status, 'REJECTED', `weeks ${weeks}`);
      assert.match(o.reason, /leakage/);
    }
  });

  await test('a snapshot without raw observations, or from another season, is rejected', async () => {
    assert.strictEqual(validateSnapshot({ records: {} }, { season: 2026, week: 4 }).ok, false);
    assert.strictEqual(fromSnapshot(snap([1, 2, 3], {}, 2025), { season: 2026, week: 4 }).status, 'REJECTED');
  });

  await test('the store reader prefers the exact pre-week window and refuses a leaking "latest"', async () => {
    const ok = await loadObservedOpportunity({ season: 2026, week: 4, store: store({ 'window:2026:1-2-3': snap([1, 2, 3], {}), latest: snap([1, 2, 3, 4], {}) }) });
    assert.strictEqual(ok.status, 'AVAILABLE');
    assert.strictEqual(ok.provenance.key, 'window:2026:1-2-3');
    const leak = await loadObservedOpportunity({ season: 2026, week: 4, store: store({ latest: snap([1, 2, 3, 4], {}) }) });
    assert.strictEqual(leak.status, 'NO_AS_OF_WINDOW');
    assert.match(leak.reason, /leakage/);
  });

  await test('a failed store read returns an explicit gap and never throws', async () => {
    const o = await loadObservedOpportunity({ season: 2026, week: 4, store: { async get() { throw new Error('blob outage'); } } });
    assert.strictEqual(o.status, 'UNAVAILABLE');
    assert.match(o.reason, /blob outage/);
    const none = await loadDecisionInputs({ season: 2026, week: 4, rankings: {} });
    assert.strictEqual(none.opportunity.status, 'UNAVAILABLE');
  });

  await test('stable adequate workload describes an ESTABLISHED role; a limited sample asserts none', async () => {
    const o = fromSnapshot(snap([1, 2, 3], { 'alpha|RB': record(11), 'beta|WR': record(4, 'role-player', 'limited') }), { season: 2026, week: 4 });
    const a = observedEvidenceFor(o, { name: 'Alpha', position: 'RB' });
    assert.strictEqual(a.establishedRole.status, 'ESTABLISHED');
    assert.strictEqual(a.establishedRole.level, 'moderate-volume');
    assert.strictEqual(observedEvidenceFor(o, { name: 'Beta', position: 'WR' }).establishedRole.status, 'INSUFFICIENT_SAMPLE');
    assert.strictEqual(observedEvidenceFor(o, { name: 'Gamma', position: 'TE' }).establishedRole.status, 'NO_OBSERVED_DATA');
  });

  await test('an observed "expanding" trend never claims role expansion; only promoted signals can', async () => {
    const o = fromSnapshot(snap([1, 2, 3], { 'alpha|RB': record(11, 'moderate-volume', 'adequate', 'expanding') }), { season: 2026, week: 4 });
    const plain = observedEvidenceFor(o, { name: 'Alpha', position: 'RB' });
    assert.strictEqual(plain.observedOpportunity.observedTrend, 'expanding');
    assert.strictEqual(plain.roleExpansion.claimed, false);
    assert.strictEqual(plain.roleExpansion.validated, false);
    const withRoleChange = observedEvidenceFor(o, { name: 'Alpha', position: 'RB', verifiedRoleChange: { type: 'ROLE_CHANGE' } });
    assert.strictEqual(withRoleChange.roleExpansion.claimed, false);
    assert.match(withRoleChange.roleExpansion.note, /no validated evidence forecasts its size/);
    const promoted = observedEvidenceFor(o, { name: 'Alpha', position: 'RB', promotedExpansion: [{ id: 'some-promoted-signal' }] });
    assert.strictEqual(promoted.roleExpansion.claimed, true);
  });

  // Record-level: observed never reaches expectedOpportunity or forward evidence.
  const rows = { metadata: { availability: { updatedAt: '2026-10-03T00:00:00Z', fresh: true } }, positions: {
    RB: [{ name: 'Alpha', position: 'RB', rank: 30, recommendation: 'FLEX', projectedPoints: 9, projection: { points: 9, source: 'Tank01', week: 4, scoring: 'half', fresh: true }, availabilityVerified: true }],
    WR: [{ name: 'Delta', position: 'WR', rank: 30, recommendation: 'FLEX', projectedPoints: 8, projection: { points: 8, source: 'Tank01', week: 4, scoring: 'half', fresh: true }, availabilityVerified: true }]
  } };
  const base = { rankings: rows, roster: [{ name: 'Alpha', position: 'RB' }, { name: 'Delta', position: 'WR' }],
    slots: [{ slotLabel: 'W/R/T', eligiblePositions: ['RB', 'WR'], count: 1 }], scoring: 'half', season: 2026, week: 4 };
  const opp = fromSnapshot(snap([1, 2, 3], { 'alpha|RB': record(14, 'high-volume', 'adequate', 'expanding'), 'delta|WR': record(6) }), { season: 2026, week: 4 });

  await test('observed workload reaches the record before the decision but never becomes expected opportunity or forward evidence', async () => {
    const r = buildLineupDecisionRecord({ ...base, opportunity: opp });
    const all = [...r.slots.flatMap((s) => [s.starter, s.comparator]), ...r.bench].filter(Boolean);
    const alpha = all.find((p) => p.name === 'Alpha');
    assert.strictEqual(alpha.observedOpportunity.avgLast3, 14);
    assert.strictEqual(alpha.establishedRole.status, 'ESTABLISHED');
    assert.deepStrictEqual(alpha.expectedOpportunity, []);
    const gates = r.slots.map((s) => s.gate).filter(Boolean);
    gates.forEach((g) => {
      const fwd = g.conditions.find((c) => c.code === 'VALIDATED_FORWARD_EVIDENCE');
      assert.ok(!fwd.passed && fwd.supporting.length === 0, 'observed workload never satisfies forward evidence');
    });
    assert.strictEqual(r.observedOpportunity.status, 'AVAILABLE');
    assert.deepStrictEqual(r.observedOpportunity.provenance.weeksIncluded, [1, 2, 3]);
  });

  await test('observed-opportunity provenance changes the decisionId; an absent source is recorded, not hidden', async () => {
    const withOpp = buildLineupDecisionRecord({ ...base, opportunity: opp });
    const without = buildLineupDecisionRecord(base);
    assert.notStrictEqual(withOpp.decisionId, without.decisionId);
    assert.strictEqual(without.observedOpportunity.status, 'NOT_SUPPLIED');
  });

  await test('records are keyed exactly like the producer (spaces kept; suffixes, periods, hyphens normalized)', async () => {
    const o = fromSnapshot(snap([1, 2, 3], { 'chris godwin|WR': record(5), 'amon ra st brown|WR': record(9) }), { season: 2026, week: 4 });
    assert.strictEqual(observedEvidenceFor(o, { name: 'Chris Godwin Jr.', position: 'WR' }).observedOpportunity.avgLast3, 5);
    assert.strictEqual(observedEvidenceFor(o, { name: 'Amon-Ra St. Brown', position: 'WR' }).observedOpportunity.avgLast3, 9);
  });

  await test('registry has no promoted signals (nothing promoted by this change)', async () => {
    assert.deepStrictEqual(Object.values(SIGNALS).filter((s) => s.status === 'promoted'), []);
  });

  console.log('super-sage-opportunity-evidence.test.js: ' + passed + ' passed');
})().catch((err) => { console.error(err); process.exit(1); });
