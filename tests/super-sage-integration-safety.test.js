'use strict';

// tests/super-sage-integration-safety.test.js
//
// Real kickoff cutoffs, the scheduled pregame ledger, and explicit,
// conservative degradation when any tributary fails. Generic rules only:
// no player-specific outcome is asserted here (the frozen Week 4 acceptance
// suite owns those).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createFakeBlobs } = require('./helpers/fake-netlify-blobs.js');
const { buildKickoffIndex, decisionCutoff, teamKickoffState, easternToIso } = require('../netlify/functions/_super-sage-kickoff.js');
const { decideSharedLineup } = require('../netlify/functions/_super-sage-lineup-service.js');
const { fromSnapshot } = require('../netlify/functions/_super-sage-opportunity-evidence.js');
const { verifyLedgerEntry, LEDGER_STORE_NAME } = require('../netlify/functions/_super-sage-pregame-ledger.js');
const ledgerFn = require('../netlify/functions/super-sage-pregame-ledger-snapshot.js');

const DIR = path.join(__dirname, 'fixtures', 'super-sage-week4');
const RANKINGS = JSON.parse(fs.readFileSync(path.join(DIR, 'production-rankings.json'), 'utf8'));
const ROSTER = JSON.parse(fs.readFileSync(path.join(DIR, 'roster.json'), 'utf8'));
const OPP = JSON.parse(fs.readFileSync(path.join(DIR, 'production-opportunity.json'), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const epoch = (iso) => String(Date.parse(iso) / 1000);

// Week 4 schedule rebuilt from the real game IDs/times in the production
// rankings (plus the Thursday PIT@CLE game Weekly SAGE had already excluded).
function week4Schedule() {
  const games = new Map();
  Object.values(RANKINGS.positions).flat().forEach((r) => {
    if (!r.gameID || games.has(r.gameID)) return;
    const [away, home] = r.gameID.split('_')[1].split('@');
    games.set(r.gameID, { gameID: r.gameID, gameDate: r.gameDate, gameTime: r.gameTime, gameTime_epoch: epoch(easternToIso(r.gameDate, r.gameTime)), gameStatus: 'Scheduled', away, home });
  });
  games.set('20261001_PIT@CLE', { gameID: '20261001_PIT@CLE', gameDate: '20261001', gameTime: '8:15p', gameTime_epoch: epoch(easternToIso('20261001', '8:15p')), gameStatus: 'Scheduled', away: 'PIT', home: 'CLE' });
  return { evidenceType: 'weekly-sage-schedule', season: '2026', week: 4, seasonType: 'reg', generatedAt: '2026-09-30T12:00:00Z', games: [...games.values()] };
}
const schedule = week4Schedule();
const rosterEntries = ROSTER.roster.map((p) => ({ name: p.name, eligiblePositions: [p.position], rosterStatus: p.rosterStatus || null }));
const oppStore = { async get(k) { return k === 'latest' ? OPP : null; } };
const decide = (over = {}) => decideSharedLineup({ rankings: RANKINGS, roster: rosterEntries, provider: 'cbs', slots: ROSTER.slots, season: 2026, week: 4, scoring: 'half', schedule, opportunityStore: oppStore, now: new Date('2026-10-01T18:00:00Z'), ...over });

let passed = 0;
async function test(name, fn) { await fn(); passed += 1; console.log('  ok - ' + name); }

(async () => {
  // ── Kickoff cutoffs ───────────────────────────────────────────────────
  await test('ET conversion honours DST; epoch accepted in seconds or milliseconds', async () => {
    assert.strictEqual(easternToIso('20260913', '1:00p'), '2026-09-13T17:00:00.000Z'); // EDT
    assert.strictEqual(easternToIso('20261213', '1:00p'), '2026-12-13T18:00:00.000Z'); // EST
    const idx = buildKickoffIndex({ season: 2026, week: 14, games: [{ gameID: 'a', away: 'AAA', home: 'BBB', gameTime_epoch: String(Date.parse('2026-12-13T18:00:00Z')) }] }, { season: 2026, week: 14 });
    assert.strictEqual(idx.firstKickoff, '2026-12-13T18:00:00.000Z');
  });

  await test('normal slate + Thursday game: the week cutoff is the real first kickoff (no day assumed)', async () => {
    const idx = buildKickoffIndex(schedule, { season: 2026, week: 4 });
    const cut = decisionCutoff(idx);
    assert.ok(cut.ok); assert.strictEqual(cut.cutoff, '2026-10-02T00:15:00.000Z', 'Thursday 8:15 p.m. ET');
    const sunday = decisionCutoff(idx, { teams: ['BUF', 'NE'] });
    assert.strictEqual(sunday.cutoff, '2026-10-04T17:00:00.000Z', 'team-specific cutoff for a Sunday 1:00 p.m. ET game');
    const london = decisionCutoff(idx, { teams: ['IND'] });
    assert.strictEqual(london.cutoff, '2026-10-04T13:30:00.000Z', 'international 9:30 a.m. ET game');
  });

  await test('Monday-only team stays pregame through Sunday; its cutoff is Monday night', async () => {
    const idx = buildKickoffIndex(schedule, { season: 2026, week: 4 });
    assert.strictEqual(teamKickoffState(idx, 'NO', new Date('2026-10-04T22:00:00Z')).state, 'PREGAME');
    assert.strictEqual(decisionCutoff(idx, { teams: ['NO'] }).cutoff, '2026-10-06T00:15:00.000Z');
    assert.strictEqual(teamKickoffState(idx, 'BUF', new Date('2026-10-04T22:00:00Z')).state, 'KICKED_OFF');
  });

  await test('postponed / unknown kickoff fails closed for the week and that team only', async () => {
    const s = clone(schedule);
    const g = s.games.find((x) => x.gameID === '20261004_NE@BUF'); g.gameStatus = 'Postponed';
    const idx = buildKickoffIndex(s, { season: 2026, week: 4 });
    assert.strictEqual(decisionCutoff(idx).ok, false, 'week first kickoff cannot be established');
    assert.strictEqual(decisionCutoff(idx, { teams: ['BUF'] }).ok, false);
    assert.strictEqual(decisionCutoff(idx, { teams: ['KC'] }).ok, true);
    assert.strictEqual(teamKickoffState(idx, 'NE').state, 'UNKNOWN');
    const t = clone(schedule); delete t.games.find((x) => x.gameID === '20261004_KC@LV').gameTime_epoch; t.games.find((x) => x.gameID === '20261004_KC@LV').gameTime = null;
    assert.strictEqual(decisionCutoff(buildKickoffIndex(t, { season: 2026, week: 4 })).ok, false, 'missing time fails closed');
    assert.strictEqual(buildKickoffIndex({ ...schedule, week: 5 }, { season: 2026, week: 4 }).ok, false, 'wrong-week schedule rejected');
  });

  await test('the real cutoff reaches opportunity validation and can only tighten it', async () => {
    assert.strictEqual(fromSnapshot(OPP, { season: 2026, week: 4, decisionCutoff: '2026-10-02T00:15:00.000Z' }).status, 'AVAILABLE');
    assert.strictEqual(fromSnapshot(OPP, { season: 2026, week: 4, decisionCutoff: '2026-09-28T00:00:00Z' }).status, 'REJECTED');
    const r = await decide();
    assert.strictEqual(r.record.observedOpportunity.provenance.decisionCutoff, '2026-10-02T00:15:00.000Z');
  });

  await test('players whose game kicked off are locked (unavailable); unknown kickoffs are availability-unverified', async () => {
    const s = clone(schedule); s.games.find((x) => x.gameID === '20261004_KC@LV').gameStatus = 'Postponed';
    const r = await decide({ schedule: s, now: new Date('2026-10-04T18:00:00Z') });
    const all = [...r.record.slots.flatMap((x) => [x.starter, x.comparator]), ...r.record.bench, ...r.record.unavailable].filter(Boolean);
    const locked = all.filter((p) => (p.availability.statusEvidence || []).some((e) => e.family === 'schedule' && e.status === 'INACTIVE'));
    assert.ok(locked.length > 0);
    locked.forEach((p) => assert.ok(r.record.unavailable.some((u) => u.name === p.name), `${p.name} kicked off but not unavailable`));
    const unknown = all.filter((p) => (p.availability.statusEvidence || []).some((e) => e.family === 'schedule' && e.status === 'UNVERIFIED'));
    assert.ok(unknown.length > 0, 'KC players have an unknown kickoff');
    unknown.forEach((p) => assert.notStrictEqual(p.baselineValidity.state, 'VALID', `${p.name} must not be VALID with an unknown kickoff`));
  });

  // ── Scheduled pregame ledger ──────────────────────────────────────────
  const blobs = createFakeBlobs();
  const ledger = blobs.module.getStore({ name: LEDGER_STORE_NAME });
  const fetchRankings = async (url) => { const scoring = new URL(url).searchParams.get('scoring'); return { ok: true, status: 200, json: async () => ({ ...clone(RANKINGS), scoring }) }; };
  const run = (iso, over = {}) => ledgerFn._test.runSnapshot({ now: new Date(iso), baseUrl: 'https://fixture.invalid', fetchImpl: fetchRankings, readSchedule: async () => schedule, ledgerStore: ledger, opportunityStore: oppStore, ...over });

  let baselineKeys = [];
  await test('weekly baseline is written once per scoring; a quiet run then writes nothing', async () => {
    const first = await run('2026-09-30T14:30:00Z');
    assert.deepStrictEqual(first.errors, []);
    assert.deepStrictEqual(first.written.map((w) => w.scoring).sort(), ['half', 'ppr', 'standard']);
    baselineKeys = first.written.map((w) => w.key);
    const again = await run('2026-09-30T16:30:00Z');
    assert.strictEqual(again.written.length, 0);
    assert.ok(again.skipped.every((x) => /baseline exists/.test(x)));
  });

  await test('within 4h of a real kickoff a new snapshot is added; earlier snapshots are preserved', async () => {
    const pre = await run('2026-10-01T23:30:00Z'); // 45 min before Thursday kickoff
    assert.strictEqual(pre.written.length, 3);
    for (const k of baselineKeys) assert.ok(await ledger.get(k, { type: 'json' }), 'baseline preserved');
    const entry = await ledger.get(pre.written[0].key, { type: 'json' });
    assert.ok(verifyLedgerEntry(entry), 'content hash verifies');
    assert.ok(Date.parse(entry.generatedAt) < Date.parse(entry.firstKickoff), 'generated before its first kickoff');
    assert.ok(!/actualFantasyPoints|"outcome"/.test(JSON.stringify(entry)), 'no outcome data');
    assert.ok(entry.season && entry.week && entry.scoring && entry.sources.projections && entry.sources.projections.updatedAt, 'season/week/scoring/source timestamps');
  });

  await test('after Thursday kicks off, Sunday snapshots exclude started games and stay pregame', async () => {
    const sun = await run('2026-10-04T11:30:00Z'); // 2h before the London game
    assert.strictEqual(sun.written.length, 3);
    const entry = await ledger.get(sun.written[0].key, { type: 'json' });
    assert.strictEqual(entry.firstKickoff, '2026-10-04T13:30:00.000Z');
    assert.ok(entry.players.filter((p) => p.lineupEligible).every((p) => !p.kickoff || Date.parse(p.kickoff) > Date.parse(entry.generatedAt)), 'no started game written as pregame');
  });

  await test('a ledger entry is never overwritten (same instant, same content -> refused)', async () => {
    const t = '2026-10-04T16:30:00Z';
    const a = await run(t); const b = await run(t);
    assert.strictEqual(a.written.length, 3);
    assert.strictEqual(b.written.length, 0);
    assert.ok(b.skipped.some((x) => /never overwritten/.test(x)));
  });

  await test('no write without real kickoff truth; nothing written when every game has started', async () => {
    const noSched = await run('2026-10-02T14:30:00Z', { readSchedule: async () => { throw new Error('cache miss'); } });
    assert.strictEqual(noSched.written.length, 0); assert.ok(noSched.skipped.some((x) => /Schedule unavailable/.test(x)));
    const done = await run('2026-10-06T05:00:00Z');
    assert.strictEqual(done.written.length, 0); assert.ok(done.skipped.some((x) => /No pregame games remain/.test(x)));
  });

  await test('ledger write failure is contained: recorded, never thrown', async () => {
    const broken = { async get() { return null; }, async setJSON() { throw new Error('blob outage'); } };
    const r = await run('2026-10-01T23:30:00Z', { ledgerStore: broken });
    assert.strictEqual(r.written.length, 0);
    assert.ok(r.errors.length === 3 && r.errors.every((e) => /blob outage/.test(e)));
  });

  await test('a Weekly SAGE response for the wrong scoring/week is never filed (fail closed)', async () => {
    const wrong = async () => ({ ok: true, status: 200, json: async () => ({ ...clone(RANKINGS), scoring: 'half' }) });
    const store = createFakeBlobs().module.getStore({ name: LEDGER_STORE_NAME });
    const r = await run('2026-10-01T23:30:00Z', { fetchImpl: wrong, ledgerStore: store });
    assert.deepStrictEqual(r.written.map((w) => w.scoring), ['half']);
    assert.ok(r.errors.some((e) => /returned 2026\/4\/half for requested 2026\/4\/ppr/.test(e)));
    assert.ok(r.errors.some((e) => /for requested 2026\/4\/standard/.test(e)));
  });

  // ── Degradation: each tributary failing independently ─────────────────
  await test('Weekly SAGE unavailable: no decision, explicitly', async () => {
    const r = await decide({ rankings: null, rankingsError: 'Weekly SAGE responded 503.' });
    assert.strictEqual(r.status, 'UNAVAILABLE'); assert.strictEqual(r.record, null);
    assert.strictEqual(r.evidenceStatus.weeklySage.status, 'UNAVAILABLE');
  });

  await test('opportunity unavailable: comparisons are never treated as coherent (no ORDINARY)', async () => {
    const r = await decide({ opportunityStore: { async get() { throw new Error('blob outage'); } } });
    assert.strictEqual(r.status, 'DECIDED'); assert.strictEqual(r.evidenceStatus.opportunity.status, 'UNAVAILABLE');
    r.record.slots.flatMap((s) => s.blockedChallengers || []).forEach((b) => assert.notStrictEqual(b.comparisonClass, 'ORDINARY', b.name));
  });

  await test('projections unavailable: nothing is resolved by projection; reported explicitly', async () => {
    const rk = clone(RANKINGS); Object.values(rk.positions).flat().forEach((r) => { delete r.projection; delete r.projectedPoints; }); rk.metadata.projections = { available: false };
    const r = await decide({ rankings: rk });
    assert.strictEqual(r.evidenceStatus.projections.status, 'UNAVAILABLE');
    r.record.slots.forEach((s) => assert.ok(!['CURRENT_EVIDENCE_COMPARISON'].includes(s.decidedBy)));
    [...r.record.slots.map((s) => s.starter), ...r.record.bench].filter(Boolean).forEach((p) => assert.ok(!p.baselineValidity.triggers.some((t) => /PROJECTION/.test(t.code))));
  });

  await test('injury/status feed unavailable: no player is treated as verified-healthy', async () => {
    const rk = clone(RANKINGS); Object.values(rk.positions).flat().forEach((r) => { delete r.injuryStatus; delete r.availabilityVerified; }); delete rk.metadata.availability;
    const r = await decide({ rankings: rk });
    assert.strictEqual(r.evidenceStatus.availability.status, 'UNAVAILABLE');
    r.record.slots.filter((s) => s.starter).forEach((s) => {
      assert.notStrictEqual(s.starter.baselineValidity.state, 'VALID', s.starter.name);
      assert.notStrictEqual(s.confidence.label, 'Strong');
    });
  });

  await test('schedule unavailable: decision still produced, gap reported, opportunity guard still enforced', async () => {
    const r = await decide({ schedule: null, scheduleError: 'cache miss' });
    assert.strictEqual(r.status, 'DECIDED'); assert.strictEqual(r.evidenceStatus.schedule.status, 'UNAVAILABLE');
    assert.deepStrictEqual(r.record.observedOpportunity.provenance.weeksIncluded, [1, 2, 3]);
  });

  await test('no customer path can be blocked by the ledger (no ledger dependency)', async () => {
    for (const f of ['_super-sage-lineup-service.js', 'super-sage-lineup.js', 'chatgpt-mcp.js']) {
      assert.ok(!fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', f), 'utf8').includes('pregame-ledger'), f);
    }
  });

  console.log('super-sage-integration-safety.test.js: ' + passed + ' passed');
})().catch((e) => { console.error(e); process.exit(1); });
