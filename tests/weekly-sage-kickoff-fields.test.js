'use strict';

// Regression: RB, K and DEF Weekly SAGE rows must carry the kickoff fields
// (gameID, gameDate, gameTime, location) that QB/WR/TE rows already carry.
//
// Live Week 7 (2026-10-23) showed 171 of 204 game-less rows were RB/K/DEF:
// those leaderboards held the schedule game but copied only the opponent.
// The other 33 were bye-team inactive QB/WR/TE rows, which correctly have no
// game and are asserted unchanged here.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');
const SCHEDULE = {
  evidenceType: 'weekly-sage-schedule', season: '2026', targetWeek: 7, seasonType: 'reg',
  games: [
    { gameID: '20261025_PIT@CIN', away: 'PIT', home: 'CIN', gameDate: '20261025', gameTime: '1:00p' },
    { gameID: '20261026_DAL@PHI', away: 'DAL', home: 'PHI', gameDate: '20261026', gameTime: '8:15p' }
  ],
  byeTeams: ['BUF']
};

function withBlobs(stores, fn) {
  const blobsPath = require.resolve('@netlify/blobs');
  const saved = require.cache[blobsPath];
  require.cache[blobsPath] = { id: blobsPath, filename: blobsPath, loaded: true, exports: {
    connectLambda() {},
    getStore: ({ name }) => ({ get: async (key) => (stores[name] ? stores[name][key] ?? null : null), setJSON: async () => {} })
  } };
  const fnPaths = Object.keys(require.cache).filter((k) => /netlify[\\/]functions[\\/]weekly-sage-(k|def)-leaderboard/.test(k));
  fnPaths.forEach((k) => delete require.cache[k]);
  return Promise.resolve(fn()).finally(() => { if (saved) require.cache[blobsPath] = saved; else delete require.cache[blobsPath]; });
}

const KEY = 'week:2026:7:reg';
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('RB leaderboard rows copy kickoff fields from the shared upcomingGame', () => {
  const file = path.join(ROOT, 'netlify/functions/weekly-sage-rb-leaderboard.js');
  const m = new Module(file, module);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(fs.readFileSync(file, 'utf8') + '\nmodule.exports.__leaderboardRecord = leaderboardRecord;', file);
  const withGame = m.exports.__leaderboardRecord({
    player: { playerID: 'rb1', name: 'Jaylen Warren', team: 'PIT', position: 'RB' },
    upcomingGame: { opponent: 'CIN', location: 'away', gameID: '20261025_PIT@CIN', gameDate: '20261025', gameTime: '1:00p' },
    components: {}, sage: {}
  });
  assert.equal(withGame.opponent, 'CIN');
  assert.equal(withGame.location, 'away');
  assert.equal(withGame.gameID, '20261025_PIT@CIN');
  assert.equal(withGame.gameDate, '20261025');
  assert.equal(withGame.gameTime, '1:00p');
  const noGame = m.exports.__leaderboardRecord({ player: { playerID: 'rb2', name: 'X', team: 'BUF' }, upcomingGame: null, components: {}, sage: {} });
  assert.equal(noGame.gameID, null);
  assert.equal(noGame.gameDate, null);
  assert.equal(noGame.gameTime, null);
});

test('K leaderboard rows carry the schedule game; bye teams carry none', () => withBlobs({
  'k-snapshot': { [KEY]: { evidenceType: 'weekly-sage-k-snapshot', season: '2026', targetWeek: 7, population: [
    { playerID: 'k1', name: 'Chris Boswell', team: 'PIT', sageScore: 70, rankingScore: 70 },
    { playerID: 'k2', name: 'Bye Kicker', team: 'BUF', sageScore: 60, rankingScore: 60 }
  ] } },
  'weekly-sage-schedule': { [KEY]: SCHEDULE }
}, async () => {
  const { handler } = require('../netlify/functions/weekly-sage-k-leaderboard.js');
  const res = await handler({ httpMethod: 'GET', queryStringParameters: { season: '2026', week: '7', seasonType: 'reg', scoring: 'half' } });
  assert.equal(res.statusCode, 200, res.body);
  const rows = JSON.parse(res.body).leaderboard;
  const pit = rows.find((r) => r.team === 'PIT');
  assert.deepEqual([pit.opponent, pit.location, pit.gameID, pit.gameDate, pit.gameTime], ['CIN', 'away', '20261025_PIT@CIN', '20261025', '1:00p']);
  const bye = rows.find((r) => r.team === 'BUF');
  assert.equal(bye.opponent, 'BYE');
  assert.equal(bye.gameID, undefined);
}));

test('DEF leaderboard rows carry the schedule game through both build stages', () => withBlobs({
  'def-snapshot': { [KEY]: { evidenceType: 'weekly-sage-def-snapshot', season: '2026', targetWeek: 7, allOffenseYardsValues: [300, 320, 340], population: [
    { playerID: 'PHI', name: 'PHI', team: 'PHI', sageScore: 72 },
    { playerID: 'DAL', name: 'DAL', team: 'DAL', sageScore: 55 },
    { playerID: 'BUF', name: 'BUF', team: 'BUF', sageScore: 66 }
  ] } },
  'weekly-sage-schedule': { [KEY]: SCHEDULE }
}, async () => {
  const { handler } = require('../netlify/functions/weekly-sage-def-leaderboard.js');
  const res = await handler({ httpMethod: 'GET', queryStringParameters: { season: '2026', week: '7', seasonType: 'reg', scoring: 'half' } });
  assert.equal(res.statusCode, 200, res.body);
  const rows = JSON.parse(res.body).leaderboard;
  const phi = rows.find((r) => r.team === 'PHI');
  assert.deepEqual([phi.opponent, phi.location, phi.gameID, phi.gameDate, phi.gameTime], ['DAL', 'home', '20261026_DAL@PHI', '20261026', '8:15p']);
  const dal = rows.find((r) => r.team === 'DAL');
  assert.equal(dal.location, 'away');
  const bye = rows.find((r) => r.team === 'BUF');
  assert.equal(bye && bye.gameID, null, 'bye defense has no game');
}));

// ─── The new fields must not change any SAGE recommendation ────────────
// Real Week 4 production rankings, with RB/K/DEF rows enriched exactly as the
// fixed leaderboards now emit (each team's game from the same schedule, taken
// here from that team's own QB/WR/TE rows).
const BASE = require('./fixtures/super-sage-week4/production-rankings.json');
const clone = (o) => JSON.parse(JSON.stringify(o));
function enriched() {
  const x = clone(BASE), game = {};
  ['QB', 'WR', 'TE'].forEach((pos) => [...x.positions[pos], ...(x.inactive[pos] || [])].forEach((p) => {
    if (p.gameID && !game[p.team]) game[p.team] = { gameID: p.gameID, gameDate: p.gameDate, gameTime: p.gameTime };
  }));
  ['RB', 'K', 'DEF'].forEach((pos) => x.positions[pos].forEach((p) => { if (game[p.team]) Object.assign(p, game[p.team]); }));
  return x;
}

test('SAGE lineup decisions are identical with the new fields; only the decision ID changes', async () => {
  const { decideSharedLineup } = require('../netlify/functions/_super-sage-lineup-service.js');
  const pick = (pos, from, to) => BASE.positions[pos].slice(from, to).map((p) => ({ name: p.name, eligiblePositions: [pos], team: p.team }));
  const roster = [...pick('QB', 0, 2), ...pick('RB', 8, 20), ...pick('WR', 0, 5), ...pick('TE', 0, 2), ...pick('K', 2, 5), ...pick('DEF', 4, 7)];
  const slots = [{ slotLabel: 'QB', eligiblePositions: ['QB'], count: 1 }, { slotLabel: 'RB', eligiblePositions: ['RB'], count: 2 }, { slotLabel: 'WR', eligiblePositions: ['WR'], count: 2 },
    { slotLabel: 'TE', eligiblePositions: ['TE'], count: 1 }, { slotLabel: 'FLEX', eligiblePositions: ['RB', 'WR', 'TE'], count: 2 }, { slotLabel: 'K', eligiblePositions: ['K'], count: 1 }, { slotLabel: 'DEF', eligiblePositions: ['DEF'], count: 1 }];
  const run = (rk) => decideSharedLineup({ rankings: clone(rk), roster, slots, season: 2026, week: 4, scoring: 'half', now: new Date('2026-10-03T22:00:00Z') });
  const before = await run(BASE), after = await run(enriched()), again = await run(enriched());
  const strip = (r) => { const c = clone(r.record); delete c.decisionId; return c; };
  assert.deepEqual(strip(after), strip(before), 'every slot, comparator, confidence and explanation unchanged');
  // Decision ID changes because matched Weekly SAGE rows are part of the hashed
  // decision inputs; it stays deterministic for the same evidence.
  assert.notEqual(after.record.decisionId, before.record.decisionId);
  assert.equal(again.record.decisionId, after.record.decisionId);
});

test('the rankings started-game filter removes exactly the same players', () => {
  const file = path.join(ROOT, 'netlify/functions/weekly-sage-rankings.js');
  const m = new Module(file, module);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(fs.readFileSync(file, 'utf8') + '\nmodule.exports.__removeStartedGames = removeStartedGames;', file);
  for (const t of ['2026-10-04T17:30:00Z', '2026-10-04T21:00:00Z', '2026-10-05T01:00:00Z']) {
    const a = clone(BASE.positions), b = clone(enriched().positions);
    const ra = m.exports.__removeStartedGames(a, new Date(t)).map((r) => r.position + ':' + r.name).sort();
    const rb = m.exports.__removeStartedGames(b, new Date(t)).map((r) => r.position + ':' + r.name).sort();
    assert.deepEqual(rb, ra, t);
    assert.deepEqual(Object.values(b).map((rows) => rows.map((r) => r.name)), Object.values(a).map((rows) => rows.map((r) => r.name)), t);
  }
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('PASS', t.name); }
    catch (e) { failed++; console.log('FAIL', t.name); console.log(e && e.stack || e); }
  }
  console.log(`\nweekly-sage-kickoff-fields: ${tests.length - failed}/${tests.length} passed`);
  if (failed) process.exit(1);
})();
