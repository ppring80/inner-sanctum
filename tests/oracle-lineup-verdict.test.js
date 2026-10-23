'use strict';

// Regression: Week 7 Oracle lineup customer failure.
//
// The customer pressed "Ask The Oracle for Lineup Advice" and the Oracle
// (1) confirmed starters were "SCHEDULED" instead of evaluating them,
// (2) failed to resolve DeVonta Smith's team, (3) risked confusing Rashee Rice
// with another Rice, and (4) never compared starters with bench alternatives.
//
// Rankings come from the real Week 4 production Weekly SAGE fixture
// (tests/fixtures/super-sage-week4). LOGIC tests use a SYNTHETIC Week-7-shaped
// copy in which every timestamp and game date is shifted +21 days (so the
// evidence is internally consistent with Week 7). These prove decision
// mapping only; they are NOT acceptance evidence for live Week 7 behavior.
// Simply relabeling the Week 4 packet as Week 7 must be REJECTED.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const BASE = require('./fixtures/super-sage-week4/production-rankings.json');
const verdictModule = require('../netlify/functions/_oracle-lineup-verdict.js');
const { buildOracleLineupVerdict, normalizeLineupPayload, resolveIdentity, rankingRows, ORACLE_LINEUP_FORMAT } = verdictModule;
const { decideSharedLineup } = require('../netlify/functions/_super-sage-lineup-service.js');
const { evidenceForPlayer } = require('../netlify/functions/_sanctum-lineup-eligibility.js');

const WEEK7_NOW = new Date('2026-10-24T23:00:00Z'); // Saturday of NFL Week 7, after the shifted generatedAt
const clone = (o) => JSON.parse(JSON.stringify(o));
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
function shiftDays(obj, days) {
  const ms = days * 86400000;
  return JSON.parse(JSON.stringify(obj)
    .replace(/(\d{4})-(\d{2})-(\d{2})T/g, (m, y, mo, d) => new Date(Date.UTC(+y, +mo - 1, +d) + ms).toISOString().slice(0, 10) + 'T')
    .replace(/\b(2026)(09|10)(\d{2})(?=[_"])/g, (m, y, mo, d) => ymd(Date.UTC(+y, +mo - 1, +d) + ms)));
}
const allRows = (r) => [...Object.values(r.positions).flat(), ...Object.values(r.inactive).flat()];
function relabeledWeek4() { // what a careless or malicious caller might send
  const r = clone(BASE);
  r.targetWeek = 7;
  allRows(r).forEach((p) => { if (p.projection) p.projection.week = 7; });
  return r;
}
function week7Rankings(mutate, { week = 7, days = 21 } = {}) { // SYNTHETIC, internally consistent
  const r = shiftDays(BASE, days);
  r.targetWeek = week;
  allRows(r).forEach((p) => { if (p.projection) p.projection.week = week; });
  if (mutate) mutate(r);
  return r;
}
function scheduleFrom(r, week = 7) { // SYNTHETIC schedule built from the same shifted game IDs
  const games = new Map();
  allRows(r).forEach((p) => { if (p.gameID && !games.has(p.gameID)) {
    const [away, home] = p.gameID.split('_')[1].split('@');
    games.set(p.gameID, { gameID: p.gameID, away, home, gameDate: p.gameDate, gameTime: p.gameTime });
  } });
  return { season: '2026', targetWeek: week, games: [...games.values()], generatedAt: r.generatedAt };
}
const findRow = (r, name) => [...Object.values(r.positions).flat(), ...Object.values(r.inactive).flat()].find((p) => p.name === name);

function customerLineup(overrides = {}) {
  return {
    week: 7, scoring: 'half-ppr', teams: 12, provider: 'sleeper',
    slotCounts: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, BENCH: 6 },
    starters: [
      { slotLabel: 'Quarterback', slotPos: 'QB', name: 'Jalen Hurts', position: 'QB', team: 'PHI' },
      { slotLabel: 'Running Back 1', slotPos: 'RB', name: 'Bijan Robinson', position: 'RB', team: 'ATL' },
      { slotLabel: 'Running Back 2', slotPos: 'RB', name: 'Kyren Williams', position: 'RB', team: 'LAR' },
      { slotLabel: 'Wide Receiver 1', slotPos: 'WR', name: 'DeVonta Smith', position: 'WR', team: 'PHI' },
      { slotLabel: 'Wide Receiver 2', slotPos: 'WR', name: 'Rashee Rice', position: 'WR', team: 'KC' },
      { slotLabel: 'Tight End', slotPos: 'TE', name: 'Sam LaPorta', position: 'TE', team: 'DET' },
      { slotLabel: 'Flex (RB/WR/TE)', slotPos: 'FLEX', name: 'Puka Nacua', position: 'WR', team: 'LAR' }
    ],
    bench: [
      { name: 'Jakobi Meyers', position: 'WR', team: 'LV' }, // league team stale vs evidence (JAX)
      { name: 'Blake Corum', position: 'RB', team: 'LAR' }
    ],
    ...overrides
  };
}

function deps(rankings, extra = {}) {
  const calls = { roster: null, urls: [] };
  return {
    calls,
    deps: {
      fetch: async (url) => { calls.urls.push(url); return { ok: true, json: async () => clone(rankings) }; },
      readSchedule: async () => null,
      getStore: () => null,
      now: () => WEEK7_NOW,
      decideSharedLineup: async (args) => { calls.roster = args.roster; calls.args = args; return decideSharedLineup(args); },
      buildLineupEligibility: async () => null,
      ...extra
    }
  };
}

const rowFor = (out, name) => out.verdict.rows.find((r) => r.player.startsWith(name) || r.player.startsWith('(') && r.replacement && r.replacement.startsWith(name));
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ─── 1. The customer case ──────────────────────────────────────────────

test('Week 7 customer case: complete verdict, never a SCHEDULED echo', async () => {
  const { deps: d } = deps(week7Rankings());
  const out = await buildOracleLineupVerdict({ lineup: customerLineup(), event: { headers: { host: 'test' } }, deps: d });
  assert.equal(out.status, 'VERDICT');
  assert.ok(!/SCHEDULED/i.test(out.text), 'must not present schedule status as a verdict');
  assert.equal(out.verdict.rows.length, 7, 'every starter gets exactly one verdict row');
  out.verdict.rows.forEach((r) => assert.ok(['KEEP', 'SWAP', 'HOLD PENDING NEWS', 'NOT EVALUATED'].includes(r.decision), r.decision));
  // 1-second layer: the verdict counts first.
  assert.match(out.text, /^The Oracle has weighed your Week 7 lineup against your bench: 1 SWAP, 6 KEEP\.\n/);
  // Every change is explained, with the slide spelled out and the reason.
  assert.match(out.text, /\nSWAP WR1: bench DeVonta Smith, move Puka Nacua to WR1 and start Blake Corum at FLEX — DeVonta Smith is out \(hamstring\)/);
  // Routine KEEPs are grouped; the strongest bench alternative is explained.
  assert.match(out.text, /\nKEEP Jalen Hurts, Bijan Robinson, Kyren Williams, Rashee Rice, Sam LaPorta, Puka Nacua\.\n/);
  assert.match(out.text, /\nBest bench option: Jakobi Meyers \(WR, JAX, 8\.1 proj\) — doesn't improve your lineup; Rashee Rice, your weakest eligible starter, brings 4\.2 more projected points\./);
  assert.equal((out.text.match(/Would you like the deeper SAGE analysis on your lineup\?/g) || []).length, 1);
  assert.ok(out.text.length <= 1000, `voice-length answer (${out.text.length} chars)`);
  assert.ok(!/scrolls|prophecy|spirits/i.test(out.text), 'no theatrical filler');
  // 10-second layer is offered separately and carries every comparison.
  assert.match(out.deeper, /^Deeper SAGE analysis — Week 7: 1 SWAP, 6 KEEP\./);
  assert.match(out.deeper, /KEEP — Wide Receiver 2: Rashee Rice \(KC, WR20/);
});

test('DeVonta Smith resolves to PHI and his OUT status drives a SWAP with the real replacement', async () => {
  const { deps: d, calls } = deps(week7Rankings());
  const out = await buildOracleLineupVerdict({ lineup: customerLineup(), event: {}, deps: d });
  const smith = out.verdict.rows.find((r) => r.player.startsWith('DeVonta Smith'));
  assert.equal(smith.player, 'DeVonta Smith (WR, PHI)');
  assert.equal(smith.decision, 'SWAP');
  assert.match(smith.reason, /DeVonta Smith is OUT — Oct 2: Smith \(hamstring\)/);
  assert.match(smith.reason, /Start Blake Corum \(LAR, RB28/);
  assert.match(smith.reason, /Slide Puka Nacua from Flex \(RB\/WR\/TE\) into Wide Receiver 1 and start Blake Corum at Flex/);
  const sent = calls.roster.find((e) => e.name === 'DeVonta Smith');
  assert.equal(sent.sageCompatibleId, '4241478', 'SAGE receives the resolved provider ID, not a bare name');
  assert.deepEqual(sent.eligiblePositions, ['WR']);
  const nacua = out.verdict.rows.find((r) => r.player.startsWith('Puka Nacua'));
  assert.equal(nacua.decision, 'KEEP');
  assert.match(nacua.reason, /moves to Wide Receiver 1 to make room for Blake Corum/);
});

test('Rashee Rice stays KC, is compared with the bench, and no other Rice appears', async () => {
  const { deps: d, calls } = deps(week7Rankings());
  const out = await buildOracleLineupVerdict({ lineup: customerLineup(), event: {}, deps: d });
  const rice = out.verdict.rows.find((r) => r.player.startsWith('Rashee Rice'));
  assert.equal(rice.player, 'Rashee Rice (WR, KC)');
  assert.equal(rice.decision, 'KEEP');
  assert.match(rice.reason, /Rashee Rice \(KC, WR20, 12\.3 proj, @ LV/);
  assert.match(rice.reason, /Beats your best eligible bench option, Jakobi Meyers \(JAX, WR41, 8\.1 proj/);
  assert.equal(calls.roster.find((e) => e.name === 'Rashee Rice').sageCompatibleId, '4428331');
  assert.ok(!/Jerry Rice/.test(out.text));
  assert.equal((out.text.match(/\bRice\b/g) || []).filter(Boolean).length, (out.text.match(/Rashee Rice/g) || []).length, 'every "Rice" is Rashee Rice');
});

test('presentation never alters the SAGE decision (same decisionId as the shared authority)', async () => {
  const { deps: d, calls } = deps(week7Rankings());
  const out = await buildOracleLineupVerdict({ lineup: customerLineup(), event: {}, deps: d });
  const direct = await decideSharedLineup({ ...calls.args, rankings: week7Rankings() });
  assert.equal(out.verdict.decisionId, direct.record.decisionId);
  const sageStarters = direct.record.slots.map((s) => s.starter && s.starter.name).sort();
  assert.deepEqual(sageStarters, ['Bijan Robinson', 'Blake Corum', 'Jalen Hurts', 'Kyren Williams', 'Puka Nacua', 'Rashee Rice', 'Sam LaPorta']);
});

// ─── 2. Similarly named players ────────────────────────────────────────

function withSecondRashee(r) {
  // SYNTHETIC: a second WR named Rashee Rice on another team, to prove team
  // disambiguation. Real row shape, distinct ID.
  const copy = { ...clone(findRow(r, 'Rashee Rice')), playerID: '9900001', team: 'NYJ', currentTeam: 'NYJ', rank: 90, projectedPoints: 3.1, projection: { ...findRow(r, 'Rashee Rice').projection, points: 3.1 } };
  r.positions.WR.push(copy);
}

test('same-name players are separated by team before SAGE sees them', async () => {
  const { deps: d, calls } = deps(week7Rankings(withSecondRashee));
  const out = await buildOracleLineupVerdict({ lineup: customerLineup(), event: {}, deps: d });
  assert.equal(calls.roster.find((e) => e.name === 'Rashee Rice').sageCompatibleId, '4428331');
  assert.equal(out.verdict.rows.find((r) => r.player.startsWith('Rashee Rice')).player, 'Rashee Rice (WR, KC)');
});

test('same-name players without a team are NOT EVALUATED, never guessed, and withheld from SAGE', async () => {
  const lineup = customerLineup();
  lineup.starters[4] = { slotLabel: 'Wide Receiver 2', slotPos: 'WR', name: 'Rashee Rice', position: 'WR', team: null };
  const { deps: d, calls } = deps(week7Rankings(withSecondRashee));
  const out = await buildOracleLineupVerdict({ lineup, event: {}, deps: d });
  const rice = out.verdict.rows.find((r) => r.player.startsWith('Rashee Rice'));
  assert.equal(rice.decision, 'NOT EVALUATED');
  assert.match(rice.reason, /More than one WR named Rashee Rice .*\(KC, NYJ\).*I won't guess/);
  assert.ok(!calls.roster.some((e) => e.name === 'Rashee Rice'), 'ambiguous identity is not handed to SAGE');
});

test('a provider ID is trusted only when the name agrees', () => {
  const rows = rankingRows(week7Rankings());
  const mismatch = resolveIdentity({ name: 'Jakobi Meyers', eligiblePositions: ['WR'], team: null, providerPlayerId: '4428331' }, rows);
  assert.equal(mismatch.row.name, 'Jakobi Meyers');
  assert.equal(mismatch.via, 'name only');
  const byId = resolveIdentity({ name: 'Rashee Rice', position: 'WR', eligiblePositions: ['WR'], team: 'KC', providerPlayerId: '4428331' }, rows);
  assert.equal(byId.via, 'provider ID');
});

test('a player absent from the evidence never resolves to a substring look-alike (live Week 7 pattern)', () => {
  // Observed in authentic Week 7 Weekly SAGE (2026-10-23): Rashee Rice was absent,
  // while a loose substring match on "rice" hit Jadarian Price (SEA, KC's opponent)
  // and Audric Estime ("audRIC Estime"). Minimal rows below mirror those names.
  const rows = rankingRows({ positions: { RB: [
    { name: 'Jadarian Price', position: 'RB', team: 'SEA', playerID: 'x1' },
    { name: 'Audric Estime', position: 'RB', team: 'CLE', playerID: 'x2' }
  ], WR: [{ name: 'Xavier Worthy', position: 'WR', team: 'KC', playerID: 'x3' }] }, inactive: {} });
  assert.equal(resolveIdentity({ name: 'Rashee Rice', position: 'WR', eligiblePositions: ['WR'], team: 'KC' }, rows).status, 'NOT_FOUND');
  assert.equal(resolveIdentity({ name: 'Rashee Rice', position: null, eligiblePositions: ['QB', 'RB', 'WR', 'TE', 'K'], team: null }, rows).status, 'NOT_FOUND');
});

test('legacy cache lookup narrows same-name players by position, then team', () => {
  const players = {
    a: { longName: 'Mike Williams', pos: 'WR', team: 'NYJ' },
    b: { longName: 'Mike Williams', pos: 'WR', team: 'PIT' },
    c: { longName: 'Mike Williams', pos: 'TE', team: 'KC' }
  };
  assert.equal(evidenceForPlayer('Mike Williams', players), null, 'name alone is ambiguous');
  assert.equal(evidenceForPlayer('Mike Williams', players, { position: 'TE' }).team, 'KC');
  assert.equal(evidenceForPlayer('Mike Williams', players, { position: 'WR' }), null, 'still ambiguous without team');
  assert.equal(evidenceForPlayer('Mike Williams', players, { position: 'WR', team: 'pit' }).team, 'PIT');
});

// ─── 3. Unresolved team data ───────────────────────────────────────────

test('a starter with no Weekly SAGE evidence and no team is NOT EVALUATED with an honest reason', async () => {
  const lineup = customerLineup();
  lineup.starters[5] = { slotLabel: 'Tight End', slotPos: 'TE', name: 'Zzyzx Quarrington', position: null, team: null };
  const { deps: d } = deps(week7Rankings());
  const out = await buildOracleLineupVerdict({ lineup, event: {}, deps: d });
  const row = out.verdict.rows.find((r) => r.player.startsWith('Zzyzx'));
  assert.equal(row.decision, 'NOT EVALUATED');
  assert.match(row.reason, /could not match Zzyzx Quarrington to verified Week 7 evidence — his team is unresolved/);
  assert.ok(!/Zzyzx Quarrington \(/.test(row.reason), 'no invented team or stats');
});

test('league team that disagrees with current evidence is surfaced, not hidden', async () => {
  const { deps: d } = deps(week7Rankings());
  const out = await buildOracleLineupVerdict({ lineup: customerLineup(), event: {}, deps: d });
  assert.match(out.deeper, /Jakobi Meyers: your league lists LV, current NFL evidence lists JAX/);
});

// ─── 4. Stale evidence ─────────────────────────────────────────────────

test('stale injury evidence never confirms a starter', async () => {
  const stale = week7Rankings((r) => { r.metadata.availability.fresh = false; });
  const { deps: d } = deps(stale);
  const out = await buildOracleLineupVerdict({ lineup: customerLineup(), event: {}, deps: d });
  assert.equal(out.status, 'VERDICT');
  assert.equal(out.verdict.rows.filter((r) => r.decision === 'KEEP').length, 0, 'no KEEP on stale availability');
  const holds = out.verdict.rows.filter((r) => r.decision === 'HOLD PENDING NEWS');
  assert.ok(holds.length >= 5);
  holds.forEach((r) => assert.match(r.reason, /injury report is stale/));
  const smith = out.verdict.rows.find((r) => r.player.startsWith('DeVonta Smith'));
  assert.equal(smith.player, 'DeVonta Smith (WR, PHI)', 'identity stays resolved even when status is stale');
  assert.match(smith.reason, /latest listed status is OUT, and the injury report is stale/);
  assert.ok(!/could not match DeVonta Smith/.test(out.text + out.deeper));
  assert.match(out.deeper, /Evidence degraded — availability: Injury\/status feed is stale/);
  assert.match(out.text, /Caution: injury report is stale/);
  assert.ok(!/\nKEEP /.test(out.text), 'no KEEP line on stale availability');
});

test('a projection from another week rejects the evidence packet', async () => {
  const r = week7Rankings((x) => { allRows(x).forEach((p) => { if (p.projection) p.projection.week = 4; }); });
  const { deps: d } = deps(r);
  const out = await buildOracleLineupVerdict({ lineup: customerLineup(), event: {}, deps: d });
  assert.equal(out.status, 'UNAVAILABLE');
  assert.match(out.text, /player projections are not Week 7 Half-PPR projections/);
  assert.ok(!/\bproj\b|KEEP/.test(out.text));
});

// ─── 1b. Source-week evidence guard (acceptance criterion 1) ────────────

test('relabeled Week 4 data (targetWeek and projection.week set to 7) is rejected', async () => {
  const { deps: d, calls } = deps(relabeledWeek4(), { now: () => new Date('2026-10-23T17:00:00Z') });
  const out = await buildOracleLineupVerdict({ lineup: customerLineup(), event: {}, deps: d });
  assert.equal(out.status, 'UNAVAILABLE');
  assert.equal(calls.args, undefined, 'SAGE is never asked to decide on non-Week-7 evidence');
  assert.match(out.text, /the evidence is not verifiably Week 7; see server diagnostics/);
  assert.match(out.text, /projections updated 2026-10-03T18:50:17\.806Z, outside Week 7/);
  assert.match(out.text, /injury report updated 2026-10-03T21:00:56\.354Z, outside Week 7/);
  assert.match(out.text, /player games fall outside Week 7 \(.*game 20261004/);
  assert.ok(!/KEEP|proj\)/.test(out.text));
});

test('only the injury report being from an earlier week is enough to reject', async () => {
  const r = week7Rankings((x) => { x.metadata.availability.updatedAt = BASE.metadata.availability.updatedAt; });
  const { deps: d } = deps(r);
  const out = await buildOracleLineupVerdict({ lineup: customerLineup(), event: {}, deps: d });
  assert.equal(out.status, 'UNAVAILABLE');
  assert.match(out.text, /injury report updated 2026-10-03T21:00:56\.354Z, outside Week 7/);
});

test('only stale matchups (game dates from an earlier week) are enough to reject', async () => {
  const r = week7Rankings((x) => { const row = findRow(x, 'Rashee Rice'); row.gameDate = '20261004'; row.gameID = '20261004_KC@LV'; });
  const { deps: d } = deps(r);
  const out = await buildOracleLineupVerdict({ lineup: customerLineup(), event: {}, deps: d });
  assert.equal(out.status, 'UNAVAILABLE');
  assert.match(out.text, /1 player games fall outside Week 7 \(Rashee Rice game 20261004\)/);
});

test('matchups that contradict the Week 7 schedule are rejected', async () => {
  const r = week7Rankings();
  const schedule = scheduleFrom(r);
  schedule.games = schedule.games.map((g) => (g.gameID === '20261025_KC@LV' ? { ...g, gameID: '20261025_KC@DEN', home: 'DEN' } : g));
  schedule.games.push({ gameID: '20261025_NYJ@LV', away: 'NYJ', home: 'LV', gameDate: '20261025', gameTime: '4:25p' });
  const { deps: d } = deps(r, { readSchedule: async () => schedule });
  const out = await buildOracleLineupVerdict({ lineup: customerLineup(), event: {}, deps: d });
  assert.equal(out.status, 'UNAVAILABLE');
  assert.match(out.text, /the evidence is not verifiably Week 7; see server diagnostics/);
});

test('evidence generated after the request time (future-dated) is rejected', async () => {
  const { deps: d } = deps(week7Rankings(), { now: () => new Date('2026-10-21T12:00:00Z') });
  const out = await buildOracleLineupVerdict({ lineup: customerLineup(), event: {}, deps: d });
  assert.equal(out.status, 'UNAVAILABLE');
  assert.match(out.text, /the evidence is not verifiably Week 7; see server diagnostics/);
});

test('Weekly SAGE evidence for the wrong week is rejected, not presented', async () => {
  const wrong = week7Rankings((r) => { r.targetWeek = 6; });
  const { deps: d } = deps(wrong, {
    buildLineupEligibility: async () => ({ week: 7, rows: [{ name: 'Sam LaPorta', team: 'DET', status: 'BYE', injury: 'none in snapshot' }] })
  });
  const out = await buildOracleLineupVerdict({ lineup: customerLineup(), event: {}, deps: d });
  assert.equal(out.status, 'UNAVAILABLE');
  assert.match(out.text, /SAGE cannot verify the Week 7 lineup evidence/);
  assert.match(out.text, /the evidence is not verifiably Week 7; see server diagnostics/);
  assert.doesNotMatch(out.text, /SWAP|Sam LaPorta|on bye/i);
  assert.ok(!/KEEP/.test(out.text));
});

test('SAGE unavailable: the Oracle says so and invents nothing', async () => {
  const { deps: d } = deps(null, { fetch: async () => ({ ok: false, status: 503 }) });
  const out = await buildOracleLineupVerdict({ lineup: customerLineup(), event: {}, deps: d });
  assert.equal(out.status, 'UNAVAILABLE');
  assert.match(out.text, /Weekly SAGE responded 503/);
  assert.match(out.text, /Nothing in your lineup is confirmed by this answer\./);
  assert.ok(!/SCHEDULED|KEEP|proj/.test(out.text));
});

test('a stale week selection is disclosed', async () => {
  const r6 = week7Rankings(null, { week: 6, days: 14 });
  const { deps: d } = deps(r6);
  const out = await buildOracleLineupVerdict({ lineup: customerLineup({ week: 6 }), event: {}, deps: d });
  assert.match(out.text, /\(The current NFL week is Week 7\.\)/);
  assert.match(out.deeper, /you asked about Week 6; the current NFL week is Week 7/);
});

// ─── 5. Starter vs bench comparisons ───────────────────────────────────

test('a better bench player produces a SWAP with football reasons', async () => {
  const lineup = customerLineup();
  lineup.starters[3] = { slotLabel: 'Wide Receiver 1', slotPos: 'WR', name: 'Puka Nacua', position: 'WR', team: 'LAR' };
  lineup.starters[4] = { slotLabel: 'Wide Receiver 2', slotPos: 'WR', name: 'Jakobi Meyers', position: 'WR', team: 'JAX' };
  lineup.starters[6] = { slotLabel: 'Flex (RB/WR/TE)', slotPos: 'FLEX', name: 'Blake Corum', position: 'RB', team: 'LAR' };
  lineup.bench = [{ name: 'Rashee Rice', position: 'WR', team: 'KC' }];
  const { deps: d } = deps(week7Rankings());
  const out = await buildOracleLineupVerdict({ lineup, event: {}, deps: d });
  const swaps = out.verdict.rows.filter((r) => r.decision === 'SWAP');
  const meyers = swaps.find((r) => r.player.startsWith('Jakobi Meyers'));
  assert.ok(meyers, 'Meyers is swapped out');
  assert.equal(meyers.replacement, 'Rashee Rice (WR, KC)');
  assert.match(meyers.reason, /Start Rashee Rice \(KC, WR20, 12\.3 proj, @ LV, negative matchup\) over Jakobi Meyers \(JAX, WR41, 8\.1 proj, @ CIN/);
});

test('KEEP names the best eligible bench option, or says none exists', async () => {
  const { deps: d } = deps(week7Rankings());
  const out = await buildOracleLineupVerdict({ lineup: customerLineup(), event: {}, deps: d });
  assert.match(out.verdict.rows.find((r) => r.player.startsWith('Kyren Williams')).reason, /Beats your best eligible bench option, Blake Corum \(LAR, RB28/);
  assert.match(out.verdict.rows.find((r) => r.player.startsWith('Jalen Hurts')).reason, /No eligible bench player challenges him/);
});

test('a Questionable starter is HOLD PENDING NEWS with his bench fallback', async () => {
  const q = week7Rankings((r) => {
    const row = findRow(r, 'Rashee Rice');
    row.injuryStatus = 'QUESTIONABLE';
    row.injuryDescription = 'Oct 22: Rice (knee) was limited at practice.'; // SYNTHETIC designation
  });
  const { deps: d } = deps(q);
  const out = await buildOracleLineupVerdict({ lineup: customerLineup(), event: {}, deps: d });
  const rice = out.verdict.rows.find((r) => r.player.startsWith('Rashee Rice'));
  assert.equal(rice.decision, 'HOLD PENDING NEWS');
  assert.match(rice.reason, /listed questionable \(Oct 22: Rice \(knee\) was limited at practice\.\)/);
  assert.match(rice.reason, /If he's out, Jakobi Meyers \(JAX, WR41/);
});

// ─── 5b. Kickoff, scoring and roster-eligibility constraints (criterion 3) ─

const SUNDAY_1_30_ET = new Date('2026-10-25T17:30:00Z'); // 1:00p ET games kicked off; 4:25p not yet

test('starters whose game kicked off are LOCKED (KEEP), never swapped, and withheld from SAGE', async () => {
  const { deps: d, calls } = deps(week7Rankings(), { now: () => SUNDAY_1_30_ET });
  const out = await buildOracleLineupVerdict({ lineup: customerLineup(), event: {}, deps: d });
  ['Jalen Hurts', 'DeVonta Smith', 'Puka Nacua'].forEach((n) => {
    const row = out.verdict.rows.find((r) => r.player.startsWith(n));
    assert.equal(row.decision, 'KEEP', n);
    assert.match(row.reason, /^Locked: .*game kicked off at 2026-10-25T17:00:00\.000Z \(Weekly SAGE game time\)/);
    assert.ok(!calls.roster.some((e) => e.name === n), `${n} is not handed to SAGE`);
  });
  assert.ok(!out.verdict.rows.some((r) => r.decision === 'SWAP'), 'no move is suggested into or out of a started game');
  assert.deepEqual(calls.args.slots.map((x) => `${x.slotLabel}x${x.count}`), ['RBx2', 'WRx1', 'TEx1'], 'locked slots are not re-decided');
  assert.match(out.deeper, /Jakobi Meyers: game already kicked off — cannot be moved into your lineup/);
  assert.match(out.text, /\nLocked \(games started\): Jalen Hurts, DeVonta Smith, Puka Nacua\./);
});

test('kickoff locks use the Week 7 schedule when it is available', async () => {
  const r = week7Rankings();
  const { deps: d } = deps(r, { now: () => SUNDAY_1_30_ET, readSchedule: async () => scheduleFrom(r) });
  const lineup = customerLineup();
  lineup.starters = lineup.starters.filter((x) => !['Bijan Robinson', 'Kyren Williams'].includes(x.name));
  lineup.bench = [{ name: 'Jakobi Meyers', position: 'WR', team: 'JAX' }];
  const out = await buildOracleLineupVerdict({ lineup, event: {}, deps: d });
  assert.equal(out.status, 'VERDICT');
  assert.match(out.verdict.rows.find((x) => x.player.startsWith('Jalen Hurts')).reason, /\(Week schedule\)/);
  assert.equal(out.verdict.rows.find((x) => x.player.startsWith('Rashee Rice')).decision, 'KEEP', '4:25p game is still open');
});

function riceOutFlexLineup() {
  const lineup = customerLineup();
  lineup.starters[4] = { slotLabel: 'Wide Receiver 2', slotPos: 'WR', name: 'Puka Nacua', position: 'WR', team: 'LAR' };
  lineup.starters[6] = { slotLabel: 'Flex (RB/WR/TE)', slotPos: 'FLEX', name: 'Rashee Rice', position: 'WR', team: 'KC' };
  return lineup;
}
const riceOut = (x) => { const row = findRow(x, 'Rashee Rice'); row.injuryStatus = 'OUT'; row.injuryDescription = 'SYNTHETIC: ruled out.'; };

test('a SWAP to a player with unverifiable kickoff is a caveat before the slate, HOLD once games are underway', async () => {
  const before = deps(week7Rankings(riceOut));
  const pre = await buildOracleLineupVerdict({ lineup: riceOutFlexLineup(), event: {}, deps: before.deps });
  const preRow = pre.verdict.rows.find((r) => r.player.startsWith('Rashee Rice'));
  assert.equal(preRow.decision, 'SWAP');
  assert.match(preRow.reason, /Kickoff for Blake Corum is not verified; make this move before his game starts\./);

  const during = deps(week7Rankings(riceOut), { now: () => SUNDAY_1_30_ET });
  const live = await buildOracleLineupVerdict({ lineup: riceOutFlexLineup(), event: {}, deps: during.deps });
  const liveRow = live.verdict.rows.find((r) => r.player.startsWith('Rashee Rice'));
  assert.equal(liveRow.decision, 'HOLD PENDING NEWS');
  assert.match(liveRow.reason, /games are underway and Blake Corum's kickoff cannot be verified — he may already be locked/);
});

const asPpr = (x) => { x.scoring = 'ppr'; allRows(x).forEach((p) => { if (p.projection) p.projection.scoring = 'ppr'; }); }; // SYNTHETIC relabel of scoring only

test('a Weekly SAGE packet in a different scoring than the league is rejected', async () => {
  const { deps: d, calls } = deps(week7Rankings()); // half-PPR packet
  const out = await buildOracleLineupVerdict({ lineup: customerLineup({ scoring: 'ppr' }), event: {}, deps: d });
  assert.equal(out.status, 'UNAVAILABLE');
  assert.equal(calls.args, undefined);
  assert.match(out.text, /Weekly SAGE returned half scoring, not ppr/);
});

test('league scoring reaches Weekly SAGE and the authority unchanged', async () => {
  const { deps: d, calls } = deps(week7Rankings(asPpr));
  await buildOracleLineupVerdict({ lineup: customerLineup({ scoring: 'PPR' }), event: { headers: { host: 'theinnersanctum.xyz' } }, deps: d });
  assert.match(calls.urls[0], /^https:\/\/theinnersanctum\.xyz\/\.netlify\/functions\/weekly-sage-rankings\?season=2026&week=7&seasonType=reg&scoring=ppr&teams=12$/);
  assert.equal(calls.args.scoring, 'ppr');
});

test('every SWAP replacement is roster-eligible for the slot it ends up in', async () => {
  const lineups = [customerLineup(), riceOutFlexLineup()];
  const alt = customerLineup();
  alt.starters[3] = { slotLabel: 'Wide Receiver 1', slotPos: 'WR', name: 'Puka Nacua', position: 'WR', team: 'LAR' };
  alt.starters[4] = { slotLabel: 'Wide Receiver 2', slotPos: 'WR', name: 'Jakobi Meyers', position: 'WR', team: 'JAX' };
  alt.starters[6] = { slotLabel: 'Flex (RB/WR/TE)', slotPos: 'FLEX', name: 'Blake Corum', position: 'RB', team: 'LAR' };
  alt.bench = [{ name: 'Rashee Rice', position: 'WR', team: 'KC' }];
  lineups.push(alt);
  const ELIG = { QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], FLEX: ['RB', 'WR', 'TE'] };
  for (const [i, lineup] of lineups.entries()) {
    const { deps: d } = deps(week7Rankings(i === 1 ? riceOut : null));
    const out = await buildOracleLineupVerdict({ lineup, event: {}, deps: d });
    out.verdict.rows.filter((r) => r.decision === 'SWAP' && r.replacement).forEach((r) => {
      const demoted = lineup.starters.find((x) => r.player.startsWith(x.name));
      const pos = r.replacement.match(/\((QB|RB|WR|TE|K|DEF),/)[1];
      if (!ELIG[demoted.slotPos].includes(pos)) assert.match(r.reason, /Slide .* into .* and start /, `${r.replacement} needs a legal slide`);
    });
  }
});

// ─── 5c. Meaningful comparisons and explicit uncertainty (criteria 4-5) ─

test('KEEP explains what separates the starter from the bench, not just rank', async () => {
  const { deps: d } = deps(week7Rankings());
  const out = await buildOracleLineupVerdict({ lineup: customerLineup(), event: {}, deps: d });
  const rice = out.verdict.rows.find((r) => r.player.startsWith('Rashee Rice')).reason;
  assert.match(rice, /Rashee Rice brings 4\.2 more projected points and a stronger role score \(66 vs 52\), despite a tougher matchup \(negative vs neutral\)\./);
  const bijan = out.verdict.rows.find((r) => r.player.startsWith('Bijan Robinson')).reason;
  assert.match(bijan, /12\.7 more projected points, a stronger role score \(84 vs 60\) and a stronger production score \(74 vs 58\)/);
});

test('point gaps require same-week, same-scoring, fresh projections on BOTH players', async () => {
  const cases = {
    'scoring label missing': (row) => { delete row.projection.scoring; },
    'stale projection': (row) => { row.projection.fresh = false; },
    'week label missing': (row) => { delete row.projection.week; }
  };
  for (const [label, mutate] of Object.entries(cases)) {
    const r = week7Rankings((x) => mutate(findRow(x, 'Jakobi Meyers')));
    const { deps: d } = deps(r);
    const out = await buildOracleLineupVerdict({ lineup: customerLineup(), event: {}, deps: d });
    assert.equal(out.status, 'VERDICT', label);
    const rice = out.verdict.rows.find((x) => x.player.startsWith('Rashee Rice')).reason;
    assert.match(rice, /Jakobi Meyers \(JAX, WR41, no comparable projection/, label);
    assert.ok(!/more projected points/.test(rice), `${label}: no point gap stated`);
    assert.equal(out.verdict.rows.find((x) => x.player.startsWith('Rashee Rice')).decision, 'KEEP', `${label}: SAGE decision unchanged`);
  }
});

test('contradictory status sources are stated, with SAGE applying the most severe', async () => {
  const lineup = customerLineup();
  lineup.starters[4].rosterStatus = 'OUT'; // provider says OUT; Weekly SAGE availability says active
  const { deps: d } = deps(week7Rankings());
  const out = await buildOracleLineupVerdict({ lineup, event: {}, deps: d });
  const rice = out.verdict.rows.find((r) => r.player.startsWith('Rashee Rice'));
  assert.notEqual(rice.decision, 'KEEP', 'a contradiction never yields an unqualified KEEP');
  assert.match(rice.reason, /Sources disagree \(Provider roster: UNAVAILABLE vs Inner Sanctum availability: ACTIVE\); SAGE applies the most severe current status\./);
});

test('a missing projection is said out loud, never filled in', async () => {
  const r = week7Rankings((x) => { const row = findRow(x, 'Jakobi Meyers'); delete row.projection; delete row.projectedPoints; });
  const { deps: d } = deps(r);
  const out = await buildOracleLineupVerdict({ lineup: customerLineup(), event: {}, deps: d });
  const rice = out.verdict.rows.find((x) => x.player.startsWith('Rashee Rice')).reason;
  assert.match(rice, /Jakobi Meyers \(JAX, WR41, no comparable projection, @ CIN/);
  assert.ok(!/more projected points/.test(rice), 'no projection gap is computed against a missing projection');
});

test('unknown kickoff without a schedule is reported explicitly', async () => {
  const { deps: d } = deps(week7Rankings());
  const out = await buildOracleLineupVerdict({ lineup: customerLineup(), event: {}, deps: d });
  assert.match(out.deeper, /Evidence unavailable — kickoff: Kickoff could not be established for Bijan Robinson, Kyren Williams, Blake Corum/);
  assert.match(out.deeper, /Evidence unavailable — schedule: Schedule unavailable\./);
  assert.match(out.text, /\nKickoff time unverified for Bijan Robinson, Kyren Williams and Blake Corum\. Bijan Robinson and Kyren Williams are KEEPs, so no move depends on it\. The SWAP involving Blake Corum is safe only if made before his game starts\.\n/);
  assert.ok(!/make moves before their games/.test(out.text), 'no generic kickoff warning');
});

// ─── 5d. Rostered-player invariant and concise 1/3/10 output ────────────

// Mirrors the authentic Week 7 observation (2026-10-23): Rashee Rice on KC's
// Tank01 roster, listed Questionable, but absent from Weekly SAGE (outside the
// top-4 WR depth-chart population). The roster entry below copies that fact.
const RICE_ROSTER = { updatedAt: '2026-10-23T16:20:21.805Z', players: {
  r1: { longName: 'Rashee Rice', pos: 'WR', team: 'KC', injury: { designation: 'Questionable', description: 'Oct 22: Rice (hamstring/knee) did not practice Thursday.' } },
  r2: { longName: 'Rasheed Walker', pos: 'OT', team: 'CAR', injury: {} },
  r3: { longName: 'Jadarian Price', pos: 'RB', team: 'SEA', injury: {} }
} };
const withoutRice = (x) => { x.positions.WR = x.positions.WR.filter((p) => p.name !== 'Rashee Rice'); };

test('a rostered starter outside SAGE evidence is named with roster facts, never dropped', async () => {
  const { deps: d } = deps(week7Rankings(withoutRice), { readPlayerData: async () => RICE_ROSTER });
  const out = await buildOracleLineupVerdict({ lineup: customerLineup(), event: {}, deps: d });
  const rice = out.verdict.rows.find((r) => r.player.startsWith('Rashee Rice'));
  assert.equal(rice.decision, 'NOT EVALUATED', 'no verdict is assigned');
  assert.equal(rice.player, 'Rashee Rice (WR, KC)');
  assert.ok(!/WR\d|proj|SAGE ranks|matchup|KEEP|SWAP/.test(rice.reason + ' ' + rice.brief), 'no invented ranking, projection or verdict');
  assert.match(out.text, /^The Oracle has weighed your Week 7 lineup against your bench: [^\n]*1 NOT EVALUATED/);
  assert.match(rice.reason, /Rashee Rice is on KC's roster and listed Questionable \(Oct 22: Rice \(hamstring\/knee\) did not practice Thursday\.\), but SAGE did not evaluate him for Week 7/);
  assert.match(out.text, /\nNOT EVALUATED WR2 Rashee Rice: on KC's roster, listed questionable \(hamstring\/knee\); SAGE has no Week 7 evaluation, so no call\./);
  assert.ok(!/Price|Walker/.test(out.text), 'never mapped to a look-alike');
});

test('a rostered bench player outside SAGE evidence is listed as not evaluated', async () => {
  const lineup = customerLineup();
  lineup.starters[4] = { slotLabel: 'Wide Receiver 2', slotPos: 'WR', name: 'Jakobi Meyers', position: 'WR', team: 'JAX' };
  lineup.bench = [{ name: 'Rashee Rice', position: 'WR', team: 'KC' }, { name: 'Blake Corum', position: 'RB', team: 'LAR' }];
  const { deps: d } = deps(week7Rankings(withoutRice), { readPlayerData: async () => RICE_ROSTER });
  const out = await buildOracleLineupVerdict({ lineup, event: {}, deps: d });
  assert.match(out.text, /\nNot evaluated by SAGE this week: Rashee Rice \(KC, questionable\)\./);
  assert.match(out.deeper, /Rashee Rice: on KC's roster, listed Questionable, but not evaluated by SAGE this week/);
});

test('a player in neither SAGE evidence nor the roster cache is still named', async () => {
  const lineup = customerLineup();
  lineup.bench.push({ name: 'Zzyzx Quarrington', position: 'WR', team: null });
  const { deps: d } = deps(week7Rankings(), { readPlayerData: async () => RICE_ROSTER });
  const out = await buildOracleLineupVerdict({ lineup, event: {}, deps: d });
  assert.match(out.text, /Not evaluated by SAGE this week: Zzyzx Quarrington\./);
});

test('a narrow KEEP is listed individually with its margin, not hidden in the group', async () => {
  const r = week7Rankings((x) => { const m = findRow(x, 'Jakobi Meyers'); m.projection.points = 11.9; m.projectedPoints = 11.9; });
  const { deps: d } = deps(r);
  const out = await buildOracleLineupVerdict({ lineup: customerLineup(), event: {}, deps: d });
  assert.match(out.text, /\nKEEP WR2 Rashee Rice: edges Jakobi Meyers by 0\.4 projected points\./);
  assert.ok(!/KEEP [^\n]*, Rashee Rice,/.test(out.text), 'not also grouped as routine');
});

test('a HOLD in the concise answer names the risk, the game and the bench fallback', async () => {
  const q = week7Rankings((x) => { const row = findRow(x, 'Rashee Rice'); row.injuryStatus = 'QUESTIONABLE'; row.injuryDescription = 'Oct 22: Rice (knee) was limited at practice.'; });
  const { deps: d } = deps(q);
  const out = await buildOracleLineupVerdict({ lineup: customerLineup(), event: {}, deps: d });
  assert.match(out.text, /\nHOLD WR2 Rashee Rice: questionable \(knee\), @ LV Sun 4:25p; if he's out, start Jakobi Meyers\./);
  assert.ok(out.text.length <= 1000);
});

test('website Start/Sit names rostered players SAGE could not evaluate', async () => {
  const { _test } = require('../netlify/functions/super-sage-lineup.js');
  const res = await _test.handler({ httpMethod: 'POST', headers: { host: 'theinnersanctum.xyz' }, body: JSON.stringify({
    season: 2026, week: 7, scoring: 'half', provider: 'sleeper',
    roster: [{ name: 'Rashee Rice', position: 'WR', team: 'KC' }, { name: 'Puka Nacua', position: 'WR', team: 'LAR' }, { name: 'Jakobi Meyers', position: 'WR', team: 'JAX' }],
    slots: [{ slotLabel: 'WR', eligiblePositions: ['WR'], count: 1 }]
  }) }, { fetch: async () => ({ ok: true, json: async () => week7Rankings(withoutRice) }), readSchedule: async () => null, getStore: () => null, connectLambda() {}, now: () => WEEK7_NOW });
  const body = JSON.parse(res.body);
  assert.equal(body.status, 'DECIDED');
  assert.ok(body.customerAnswer.oneSecond.includes('Not evaluated by SAGE this week (no Weekly SAGE evidence): Rashee Rice. This is not a bench or drop call.'));
  assert.deepEqual(body.record.slots.map((x) => x.starter.name), ['Puka Nacua'], 'SAGE decision unchanged');
});

test('sanctum.html answers yes/no to the deeper-analysis offer locally, without a model call', () => {
  const html = fs.readFileSync(path.join(ROOT, 'sanctum.html'), 'utf8');
  const grab = (name) => { const start = html.indexOf('function ' + name + '('); let depth = 0, i = html.indexOf('{', start);
    for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; } return html.slice(start, i + 1); };
  const pick = (re) => html.match(re)[0];
  const ctx = { hist: { oracle: [{ role: 'assistant', content: 'verdict', deeperAnalysis: 'Deeper SAGE analysis — Week 7: 1 SWAP.\nKEEP — QB: x' }] }, ap: 'oracle', draws: 0,
    document: { getElementById: () => ({ value: 'x' }) } };
  ctx.draw = () => { ctx.draws++; };
  vm.createContext(ctx);
  vm.runInContext([pick(/var DEEPER_YES = [^\n]+/), pick(/var DEEPER_NO = [^\n]+/), grab('escapeVerdictHtml'), grab('answerDeeperOffer')].join('\n'), ctx);
  assert.equal(vm.runInContext('answerDeeperOffer("Who should I start at flex?")', ctx), false, 'other questions take the normal path');
  assert.equal(vm.runInContext('DEEPER_NO.test("No — keep it simple")', ctx), true, "contract's No wording");
  assert.equal(vm.runInContext('answerDeeperOffer("Yes — show me the details")', ctx), true, "contract's Yes wording");
  const h = ctx.hist.oracle;
  assert.equal(h[h.length - 1].content, 'Deeper SAGE analysis — Week 7: 1 SWAP.\nKEEP — QB: x');
  assert.ok(h[h.length - 1].displayHtml.includes('<br>'));
  assert.equal(vm.runInContext('answerDeeperOffer("yes")', ctx), false, 'offered once');
  assert.ok(html.includes('if (answerDeeperOffer(q, displayTxt)) return;'), 'checked before quota and network');
  assert.ok(html.indexOf('if (answerDeeperOffer(q, displayTxt)) return;') < html.indexOf('refreshIsAcolyteFromGate();\n\n  if (!isAcolyte)'), 'no question is spent');
});

// ─── 6. Request contract and scoring ───────────────────────────────────

test('league scoring is used when provided and disclosed when assumed', async () => {
  assert.equal(normalizeLineupPayload(customerLineup({ scoring: 'Half-PPR' })).payload.scoring, 'half');
  assert.equal(normalizeLineupPayload(customerLineup({ scoring: 'ppr' })).payload.scoring, 'ppr');
  assert.equal(normalizeLineupPayload(customerLineup({ scoring: 'standard' })).payload.scoring, 'standard');
  const { deps: d, calls } = deps(week7Rankings());
  const out = await buildOracleLineupVerdict({ lineup: customerLineup({ scoring: null }), event: {}, deps: d });
  assert.equal(calls.args.scoring, 'half');
  assert.match(out.text, /Caution: league scoring not provided, so Half-PPR was assumed/);
});

test('roster rules come from the league slot counts, including empty slots', () => {
  const p = normalizeLineupPayload(customerLineup({ slotCounts: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, SFLEX: 1, K: 1, DEF: 1 } })).payload;
  assert.deepEqual(p.slots.map((s) => `${s.slotLabel}x${s.count}`), ['QBx1', 'RBx2', 'WRx3', 'TEx1', 'Kx1', 'DEFx1', 'FLEXx1', 'SUPERFLEXx1']);
  assert.equal(normalizeLineupPayload({ week: 19, starters: [] }).ok, false);
});

// ─── 7. chat.js wiring (Oracle path) and legacy behavior ───────────────

function loadChatWithMocks() {
  const modelCalls = [];
  const fakeStore = { get: async () => null, setJSON: async () => {} };
  const blobsPath = require.resolve('@netlify/blobs');
  const sdkPath = require.resolve('@anthropic-ai/sdk');
  require.cache[blobsPath] = { id: blobsPath, filename: blobsPath, loaded: true, exports: { getStore: () => fakeStore, connectLambda: () => {} } };
  function FakeAnthropic() { this.messages = { create: async (args) => { modelCalls.push(args); return { content: [{ type: 'text', text: 'legacy model reply' }], usage: {} }; } }; }
  require.cache[sdkPath] = { id: sdkPath, filename: sdkPath, loaded: true, exports: FakeAnthropic };
  for (const k of Object.keys(require.cache)) if (/netlify[\\/]functions[\\/]/.test(k)) delete require.cache[k];
  return { chat: require('../netlify/functions/chat.js'), modelCalls };
}

test('chat.js answers the Oracle lineup button from SAGE without asking the model to evaluate', async () => {
  const { chat, modelCalls } = loadChatWithMocks();
  const realFetch = global.fetch;
  // Real clock here: +19 days keeps the synthetic Week 7 evidence in the past.
  global.fetch = async () => ({ ok: true, json: async () => week7Rankings(null, { days: 19 }) });
  try {
    const res = await chat.handler({
      httpMethod: 'POST', headers: { origin: 'https://theinnersanctum.xyz', host: 'theinnersanctum.xyz' },
      body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 1000, system: 'You are The Oracle', messages: [{ role: 'user', content: 'It is NFL Week 7. Here is my current lineup:\n\nSTARTERS:\nQuarterback: Jalen Hurts' }], lineup: customerLineup() })
    });
    const body = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.equal(body.format, ORACLE_LINEUP_FORMAT);
    assert.equal(body.content[0].type, 'text', 'customer response contract preserved');
    assert.match(body.content[0].text, /^The Oracle has weighed your Week 7 lineup against your bench: /);
    assert.match(body.deeperAnalysis, /^Deeper SAGE analysis — Week 7: /);
    assert.equal(modelCalls.length, 0);
  } finally { global.fetch = realFetch; }
});

test('chat.js fails closed when structured Oracle lineup evidence cannot be retrieved', async () => {
  const { chat, modelCalls } = loadChatWithMocks();
  const realFetch = global.fetch;
  global.fetch = async () => { throw new Error('weekly rankings unavailable'); };
  try {
    const res = await chat.handler({
      httpMethod: 'POST', headers: { origin: 'https://theinnersanctum.xyz', host: 'theinnersanctum.xyz' },
      body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 1000, system: 'You are The Oracle', messages: [{ role: 'user', content: 'Check my lineup' }], lineup: customerLineup() })
    });
    const body = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.equal(body.format, ORACLE_LINEUP_FORMAT);
    assert.equal(body.content[0].type, 'text');
    assert.match(body.content[0].text, /cannot verify|unavailable|not evaluated/i);
    assert.doesNotMatch(body.content[0].text, /legacy model reply/);
    assert.equal(modelCalls.length, 0, 'structured lineup must never fall back to language model');
  } finally { global.fetch = realFetch; }
});

test('chat.js never falls through to model when Oracle verdict returns null or throws', () => {
  const src = fs.readFileSync(path.join(ROOT, 'netlify/functions/chat.js'), 'utf8');
  const start = src.indexOf('if (effectiveLineup) {');
  const end = src.indexOf('let liveDataContext =', start);
  assert.ok(start >= 0 && end > start);
  const branch = src.slice(start, end);
  assert.match(branch, /if \(oracleVerdict\)/);
  assert.match(branch, /return \{[\s\S]*?cannot verify your lineup with SAGE/);
  assert.ok(branch.indexOf('cannot verify your lineup with SAGE') > branch.indexOf('if (oracleVerdict)'), 'unavailable response must follow verdict handling');
});

test('rejected evidence never turns benched players into SWAP or invented bye warnings', () => {
  const { renderUnavailableText } = require('../netlify/functions/_oracle-lineup-verdict.js');
  const text = renderUnavailableText({week:7,reason:'one matchup mismatch',eligibility:{rows:[
    {name:'Chris Rodriguez Jr.',team:'JAX',status:'BYE'},
    {name:'Rashee Rice',team:'KC',status:'INJURY BLOCKED'}
  ]}});
  assert.match(text,/cannot verify/);
  assert.doesNotMatch(text,/SWAP|Chris Rodriguez|Rashee Rice|on bye|listed Out/i);
});

test('all three personas use shared SAGE for pasted lineups', () => {
  const chat = fs.readFileSync(path.join(ROOT,'netlify/functions/chat.js'),'utf8');
  assert.match(chat,/parsePastedOracleLineup\\(messages\\)/);
  assert.match(chat,/personaKey === 'trash'/);
  assert.match(chat,/personaKey === 'analyst'/);
  assert.match(chat,/buildOracleLineupVerdict\\(\\{ lineup: effectiveLineup/);
});

test('chat.js requests without a structured lineup keep the existing model path', async () => {
  const { chat, modelCalls } = loadChatWithMocks();
  const res = await chat.handler({
    httpMethod: 'POST', headers: { origin: 'https://theinnersanctum.xyz' },
    body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 1000, system: 'You are The Oracle', messages: [{ role: 'user', content: 'Who is the best rookie WR?' }] })
  });
  assert.equal(JSON.parse(res.body).content[0].text, 'legacy model reply');
  assert.equal(modelCalls.length, 1);
});

test('legacy eligibility text no longer presents "scheduled" as a verdict', () => {
  const src = fs.readFileSync(path.join(ROOT, 'netlify/functions/_sanctum-lineup-eligibility.js'), 'utf8');
  assert.ok(!src.includes('SCHEDULED; injury snapshot checked'));
  assert.ok(src.includes('it is NOT a start/sit evaluation'));
  assert.ok(src.includes('Never tell the user a starter is confirmed'));
});

// ─── 8. Client payload (sanctum.html) ──────────────────────────────────

test('sanctum.html sends position, team, status and provider ID for Oracle lineups only', () => {
  const html = fs.readFileSync(path.join(ROOT, 'sanctum.html'), 'utf8');
  assert.ok(html.includes("if (ap === 'oracle') {\n    ask(modelPrompt, visiblePrompt, buildOracleLineupPayload(week));"));
  assert.ok(html.includes('if (lineup) requestBody.lineup = lineup;'));
  assert.ok(html.includes("(h[j].displayHtml || h[j].content)"));
  const grab = (name) => {
    const start = html.indexOf('function ' + name + '(');
    let depth = 0, i = html.indexOf('{', start);
    for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
    return html.slice(start, i + 1);
  };
  const fields = { 'slot-QB': 'Jalen Hurts', 'slot-WR1': 'DeVonta Smith', 'slot-WR2': '', 'slot-FLEX': 'Rashee Rice', 'slot-BN1': 'Jakobi Meyers' };
  const ctx = {
    document: { getElementById: (id) => (id in fields ? { value: fields[id] } : null) },
    STARTER_SLOTS: [{ id: 'QB', label: 'Quarterback', pos: 'QB' }, { id: 'WR1', label: 'Wide Receiver 1', pos: 'WR' }, { id: 'WR2', label: 'Wide Receiver 2', pos: 'WR' }, { id: 'FLEX', label: 'Flex (RB/WR/TE)', pos: 'FLEX' }],
    BENCH_SLOTS: [{ id: 'BN1', label: 'Bench 1', pos: 'ANY' }],
    sleeperRosterPlayers: [{ name: 'Jalen Hurts', pos: 'QB', team: 'PHI' }, { name: 'DeVonta Smith', pos: 'WR', team: 'PHI' }, { name: 'Rashee Rice', pos: 'WR', team: 'KC' }, { name: 'Jakobi Meyers', pos: 'WR', team: 'FA' }],
    allSleeperPlayers: [],
    sleeperConnected: false,
    LeagueConnection: { getActiveConnection: () => ({ provider: 'espn', scoringFormat: 'ppr', teamCount: 10, roster: [{ name: 'DeVonta Smith', playerId: '4241478', status: 'ACTIVE' }] }) }
  };
  vm.createContext(ctx);
  vm.runInContext(['oracleRosterDetail', 'oracleProviderDetail', 'buildOracleLineupPayload', 'escapeVerdictHtml'].map(grab).join('\n'), ctx);
  const payload = vm.runInContext('buildOracleLineupPayload("7")', ctx);
  assert.equal(payload.week, 7);
  assert.equal(payload.scoring, 'ppr');
  assert.equal(payload.provider, 'espn');
  assert.equal(JSON.stringify(payload.slotCounts), JSON.stringify({ QB: 1, WR: 2, FLEX: 1 }));
  assert.equal(payload.starters.length, 3, 'empty slots are not sent as players');
  const smith = payload.starters.find((s) => s.name === 'DeVonta Smith');
  assert.equal(JSON.stringify(smith), JSON.stringify({ name: 'DeVonta Smith', position: 'WR', team: 'PHI', rosterStatus: 'ACTIVE', providerPlayerId: '4241478', slotLabel: 'Wide Receiver 1', slotPos: 'WR' }));
  assert.equal(payload.starters.find((s) => s.name === 'Rashee Rice').team, 'KC');
  assert.equal(payload.bench[0].team, null, 'FA is not sent as a team');
  assert.equal(vm.runInContext('escapeVerdictHtml("A <b> & B\\nC")', ctx), 'A &lt;b&gt; &amp; B<br>C');
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('PASS', t.name); }
    catch (e) { failed++; console.log('FAIL', t.name); console.log(e && e.stack || e); }
  }
  console.log(`\noracle-lineup-verdict: ${tests.length - failed}/${tests.length} passed`);
  if (failed) process.exit(1);
})();
