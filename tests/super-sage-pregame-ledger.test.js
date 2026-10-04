'use strict';

// tests/super-sage-pregame-ledger.test.js
//
// The pregame ledger accumulates temporally valid evidence for future
// calibration: append-only, pregame-only, hash-verified, outcome-free.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createFakeBlobs } = require('./helpers/fake-netlify-blobs.js');
const { buildPregameLedgerEntry, verifyLedgerEntry, ledgerKey, writePregameLedgerEntry, LEDGER_STORE_NAME } = require('../netlify/functions/_super-sage-pregame-ledger.js');
const { fromSnapshot } = require('../netlify/functions/_super-sage-opportunity-evidence.js');
const { run } = require('../scripts/run-super-sage-week4-acceptance.js');

const DIR = path.join(__dirname, 'fixtures', 'super-sage-week4');
const rankings = JSON.parse(fs.readFileSync(path.join(DIR, 'production-rankings.json'), 'utf8'));
const opportunity = fromSnapshot(JSON.parse(fs.readFileSync(path.join(DIR, 'production-opportunity.json'), 'utf8')), { season: 2026, week: 4, key: 'production-opportunity.json' });
const FIRST_KICKOFF = '2026-10-02T00:15:00Z'; // Week 4 Thursday night (PIT@CLE), 8:15 p.m. ET
const PREGAME = '2026-10-01T18:00:00Z';

let passed = 0;
async function test(name, fn) { await fn(); passed += 1; console.log('  ok - ' + name); }

(async () => {
  const entry = buildPregameLedgerEntry({ rankings, generatedAt: PREGAME, firstKickoff: FIRST_KICKOFF, opportunity, decisionRecords: [run().record] });

  await test('an entry preserves every required pregame field', async () => {
    assert.strictEqual(entry.season, '2026'); assert.strictEqual(entry.week, 4); assert.strictEqual(entry.scoring, 'half');
    assert.strictEqual(entry.generatedAt, PREGAME.replace('Z', '.000Z'));
    assert.strictEqual(entry.pregameVerified, true);
    const ranked = entry.players.filter((p) => p.lineupEligible);
    const total = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].reduce((n, pos) => n + rankings.positions[pos].length, 0);
    assert.strictEqual(ranked.length, total, 'every ranked player, not just one roster');
    const withProj = ranked.find((p) => p.projection && p.projection.points != null);
    assert.ok(withProj.projection.source && withProj.projection.updatedAt, 'projection + source timestamp');
    assert.ok(ranked.every((p) => p.weeklySage.rank != null && p.weeklySage.recommendation), 'rank/tier');
    assert.ok(ranked.some((p) => p.weeklySage.confidenceLabel), 'confidence');
    assert.ok(entry.players.some((p) => !p.lineupEligible && p.availability.status), 'inactive availability preserved');
    assert.ok(ranked.some((p) => p.availability.injuryStatus === 'DOUBTFUL'), 'injury state');
    assert.ok(ranked.some((p) => p.stateChanges.some((c) => c.type === 'QB_AVAILABILITY_CHANGE')), 'material state changes');
    assert.deepStrictEqual(entry.sources.observedOpportunity.provenance.weeksIncluded, [1, 2, 3], 'opportunity provenance with observed weeks');
    assert.ok(Array.isArray(entry.promotedForwardSignals), 'promoted signals recorded (empty today)');
    assert.strictEqual(entry.decisions[0].decisionId, run().record.decisionId, 'decision fingerprint');
  });

  await test('entries contain no outcome data', async () => {
    const text = JSON.stringify(entry);
    assert.ok(!/actualFantasyPoints|"outcome"|finalScore/.test(text));
  });

  await test('the content hash verifies, and any tampering breaks it', async () => {
    assert.ok(verifyLedgerEntry(entry));
    const tampered = JSON.parse(JSON.stringify(entry));
    tampered.players[0].projection.points = 99;
    assert.ok(!verifyLedgerEntry(tampered));
  });

  await test('an entry generated at or after the first kickoff is refused', async () => {
    assert.throws(() => buildPregameLedgerEntry({ rankings, generatedAt: FIRST_KICKOFF, firstKickoff: FIRST_KICKOFF }), /not before the first kickoff/);
    assert.throws(() => buildPregameLedgerEntry({ rankings, generatedAt: '2026-10-04T17:00:00Z', firstKickoff: FIRST_KICKOFF }), /would not be pregame evidence/);
  });

  await test('the writer is append-only: an existing entry is never overwritten', async () => {
    const blobs = createFakeBlobs();
    const store = blobs.module.getStore({ name: LEDGER_STORE_NAME });
    const first = await writePregameLedgerEntry(store, entry);
    assert.strictEqual(first.written, true);
    const again = await writePregameLedgerEntry(store, entry);
    assert.strictEqual(again.written, false);
    assert.match(again.reason, /never overwritten/);
    const stored = await store.get(first.key, { type: 'json' });
    assert.strictEqual(stored.contentHash, entry.contentHash);
  });

  await test('a later snapshot of the same week is kept alongside the earlier one', async () => {
    const blobs = createFakeBlobs();
    const store = blobs.module.getStore({ name: LEDGER_STORE_NAME });
    const later = buildPregameLedgerEntry({ rankings, generatedAt: '2026-10-01T22:00:00Z', firstKickoff: FIRST_KICKOFF, opportunity });
    const a = await writePregameLedgerEntry(store, entry);
    const b = await writePregameLedgerEntry(store, later);
    assert.ok(a.written && b.written && a.key !== b.key);
    assert.ok(ledgerKey(entry) < ledgerKey(later), 'keys sort chronologically');
  });

  await test('the writer refuses an entry whose hash does not verify', async () => {
    const store = createFakeBlobs().module.getStore({ name: LEDGER_STORE_NAME });
    await assert.rejects(() => writePregameLedgerEntry(store, { ...entry, week: 5 }), /does not verify/);
  });

  await test('not wired: no Netlify function or scheduled job imports the ledger yet', async () => {
    const dir = path.join(__dirname, '..', 'netlify', 'functions');
    const importers = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && f !== '_super-sage-pregame-ledger.js')
      .filter((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes('_super-sage-pregame-ledger'));
    assert.deepStrictEqual(importers, []);
  });

  console.log('super-sage-pregame-ledger.test.js: ' + passed + ' passed');
})().catch((e) => { console.error(e); process.exit(1); });
