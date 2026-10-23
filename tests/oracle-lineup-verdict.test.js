'use strict';

// Regression: Week 7 Oracle lineup customer failure.
//
// The customer pressed "Ask The Oracle for Lineup Advice" and the Oracle
// (1) confirmed starters were "SCHEDULED" instead of evaluating them,
// (2) failed to resolve DeVonta Smith's team, (3) risked confusing Rashee Rice
// with another Rice, and (4) never compared starters with bench alternatives.
//
// Rankings come from the real Week 4 production Weekly SAGE fixture
// (tests/fixtures/super-sage-week4). Week 7 cases reuse those real row shapes
// with targetWeek relabeled to 7; any injected row is marked SYNTHETIC.

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

const WEEK7_NOW = new Date('2026-10-23T17:00:00Z'); // resolves to NFL Week 7
const clone = (o) => JSON.parse(JSON.stringify(o));
function week7Rankings(mutate) {
  const r = clone(BASE);
  r.targetWeek = 7;
  // A real Week 7 response carries Week 7 projections (SAGE rejects wrong-week ones).
  [...Object.values(r.positions).flat(), ...Object.values(r.inactive).flat()].forEach((p) => { if (p.projection) p.projection.week = 7; });
  if (mutate) mutate(r);
  return r;
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
  const calls = { roster: null };
  return {
    calls,
    deps: {
      fetch: async () => ({ ok: true, json: async () => clone(rankings) }),
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
  out.verdict.rows.forEach((r) => assert.ok(['KEEP', 'SWAP', 'HOLD PENDING NEWS'].includes(r.decision), r.decision));
  assert.match(out.text, /^The Oracle has weighed every starter against your bench/);
  assert.match(out.text, /Week 7 verdict: 1 SWAP, 6 KEEP\./);
  assert.equal((out.text.match(/Would you like the deeper SAGE analysis on your lineup\?/g) || []).length, 1);
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

test('same-name players without a team are HOLD, never guessed, and withheld from SAGE', async () => {
  const lineup = customerLineup();
  lineup.starters[4] = { slotLabel: 'Wide Receiver 2', slotPos: 'WR', name: 'Rashee Rice', position: 'WR', team: null };
  const { deps: d, calls } = deps(week7Rankings(withSecondRashee));
  const out = await buildOracleLineupVerdict({ lineup, event: {}, deps: d });
  const rice = out.verdict.rows.find((r) => r.player.startsWith('Rashee Rice'));
  assert.equal(rice.decision, 'HOLD PENDING NEWS');
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

test('a starter with no Weekly SAGE evidence and no team is HOLD with an honest reason', async () => {
  const lineup = customerLineup();
  lineup.starters[5] = { slotLabel: 'Tight End', slotPos: 'TE', name: 'Zzyzx Quarrington', position: null, team: null };
  const { deps: d } = deps(week7Rankings());
  const out = await buildOracleLineupVerdict({ lineup, event: {}, deps: d });
  const row = out.verdict.rows.find((r) => r.player.startsWith('Zzyzx'));
  assert.equal(row.decision, 'HOLD PENDING NEWS');
  assert.match(row.reason, /could not match Zzyzx Quarrington to verified Week 7 evidence — his team is unresolved/);
  assert.ok(!/Zzyzx Quarrington \(/.test(row.reason), 'no invented team or stats');
});

test('league team that disagrees with current evidence is surfaced, not hidden', async () => {
  const { deps: d } = deps(week7Rankings());
  const out = await buildOracleLineupVerdict({ lineup: customerLineup(), event: {}, deps: d });
  assert.match(out.text, /Jakobi Meyers: your league lists LV, current NFL evidence lists JAX/);
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
  assert.ok(!/could not match DeVonta Smith/.test(out.text));
  assert.match(out.text, /Evidence degraded — availability: Injury\/status feed is stale/);
});

test('a projection from another week is never shown as Week 7 evidence', async () => {
  const r = week7Rankings((x) => { [...Object.values(x.positions).flat(), ...Object.values(x.inactive).flat()].forEach((p) => { if (p.projection) p.projection.week = 4; }); });
  const { deps: d } = deps(r);
  const out = await buildOracleLineupVerdict({ lineup: customerLineup(), event: {}, deps: d });
  assert.equal(out.status, 'VERDICT');
  assert.ok(!/\bproj\b/.test(out.text), 'Week 4 projections are inadmissible for Week 7');
  assert.match(out.verdict.rows.find((row) => row.player.startsWith('Rashee Rice')).reason, /Rashee Rice \(KC, WR20, @ LV/);
});

test('Weekly SAGE evidence for the wrong week is rejected, not presented', async () => {
  const wrong = week7Rankings((r) => { r.targetWeek = 6; });
  const { deps: d } = deps(wrong, {
    buildLineupEligibility: async () => ({ week: 7, rows: [{ name: 'Sam LaPorta', team: 'DET', status: 'BYE', injury: 'none in snapshot' }] })
  });
  const out = await buildOracleLineupVerdict({ lineup: customerLineup(), event: {}, deps: d });
  assert.equal(out.status, 'UNAVAILABLE');
  assert.match(out.text, /The Oracle will not guess\. SAGE's Week 7 evaluation is unavailable right now \(Weekly SAGE returned Week 6 evidence, not Week 7\)/);
  assert.match(out.text, /SWAP — Sam LaPorta \(DET\): on bye in Week 7\. Do not start him\./);
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
  const r6 = week7Rankings((r) => { r.targetWeek = 6; });
  const { deps: d } = deps(r6);
  const out = await buildOracleLineupVerdict({ lineup: customerLineup({ week: 6 }), event: {}, deps: d });
  assert.match(out.text, /you asked about Week 6; the current NFL week is Week 7/);
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

// ─── 6. Request contract and scoring ───────────────────────────────────

test('league scoring is used when provided and disclosed when assumed', async () => {
  assert.equal(normalizeLineupPayload(customerLineup({ scoring: 'Half-PPR' })).payload.scoring, 'half');
  assert.equal(normalizeLineupPayload(customerLineup({ scoring: 'ppr' })).payload.scoring, 'ppr');
  assert.equal(normalizeLineupPayload(customerLineup({ scoring: 'standard' })).payload.scoring, 'standard');
  const { deps: d, calls } = deps(week7Rankings());
  const out = await buildOracleLineupVerdict({ lineup: customerLineup({ scoring: null }), event: {}, deps: d });
  assert.equal(calls.args.scoring, 'half');
  assert.match(out.text, /your league scoring was not provided, so Half-PPR was assumed/);
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
  global.fetch = async () => ({ ok: true, json: async () => week7Rankings() });
  try {
    const res = await chat.handler({
      httpMethod: 'POST', headers: { origin: 'https://theinnersanctum.xyz', host: 'theinnersanctum.xyz' },
      body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 1000, system: 'You are The Oracle', messages: [{ role: 'user', content: 'It is NFL Week 7. Here is my current lineup:\n\nSTARTERS:\nQuarterback: Jalen Hurts' }], lineup: customerLineup() })
    });
    const body = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.equal(body.format, ORACLE_LINEUP_FORMAT);
    assert.equal(body.content[0].type, 'text', 'customer response contract preserved');
    assert.match(body.content[0].text, /SWAP — Wide Receiver 1: Start Blake Corum/);
    assert.equal(modelCalls.length, 0);
  } finally { global.fetch = realFetch; }
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
