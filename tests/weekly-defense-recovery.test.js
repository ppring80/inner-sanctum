'use strict';
// Synthetic provider + actual Blobs SDK transport. No outbound network is allowed.
// The same suite can execute the real Netlify writer bundle using DEFENSE_WRITER_BUNDLE.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs'), vm = require('node:vm');
const { connectLambda, getStore } = require('@netlify/blobs');
const recovery = require('../netlify/functions/_weekly-refresh-recovery');
const { failure, summarize, DEFENSE_POLICY } = require('../netlify/functions/_weekly-defense-failure');
const { weeklyReadiness } = require('../netlify/functions/_weekly-sage-readiness');
const { refreshDiagnostics } = require('../netlify/functions/_weekly-refresh-diagnostics');
const { decideLineup } = require('../netlify/functions/_super-sage-lineup-decision');
const writer = require(process.env.DEFENSE_WRITER_BUNDLE ? path.resolve(process.env.DEFENSE_WRITER_BUNDLE) : '../netlify/functions/refresh-weekly-sage-defense');
const { buildWeeklyDefense, _test } = require('../netlify/functions/weekly-sage-defense-week');
const { runJob, nextJob, inspectJobs, stateKey, cacheKey, jobsForWeek, canRetry } = recovery;
const realFetch = global.fetch, RealDate = Date;
const savedEnv = { ...process.env };
let clock = RealDate.parse('2026-11-03T06:00:00Z');
// Freeze time only in this isolated test process. All dates/leases/budgets use the same clock.
class Clock extends RealDate {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
}
global.Date = Clock;
const event = { headers: { 'x-nf-site-id': 'synthetic-site', 'x-nf-deploy-id': 'synthetic-deploy' },
  blobs: Buffer.from(JSON.stringify({ url: 'https://blobs.synthetic.invalid', token: 'synthetic-only' })).toString('base64'),
  queryStringParameters: { season: '2026', week: '8', seasonType: 'reg' } };
process.env.TANK01_API_KEY = 'synthetic-only';
process.env.TANK01_KILL_SWITCH = 'false';
process.env.TANK01_DAILY_CALL_LIMIT = '700';
process.env.TANK01_NORMAL_CALL_LIMIT = '600';
connectLambda(event);
let records, revision, providerCalls, builds, mode, writes, dispatchedWorker = null, customerRankings = null;
function reset(nextMode = 'complete') {
  records = new Map(); revision = 0; providerCalls = 0; builds = 0; mode = nextMode; writes = [];
}
const recordKey = (store, key) => `${store}/${key}`;
function seed(store, key, data) { records.set(recordKey(store, key), { data: structuredClone(data), etag: String(++revision) }); }
function read(store, key) { return records.get(recordKey(store, key))?.data; }
const game = { gameID: '20261102_DAL_NYG', home: 'DAL', away: 'NYG', gameStatus: 'Final/OT', gameWeek: '8', season: '2026' };
function stats(team) { return { teamAbv: team, passCompletionsAndAttempts: '20-30', sacksAndYardsLost: '2-10', rushingAttempts: '25', rushingYards: '100', rushTD: '0', passingYards: '220', passTD: '2', interceptionsThrown: '0', totalYards: '320', totalPlays: '57' }; }
function box() { return { homePts: '14', awayPts: '21', teamStats: { home: stats('DAL'), away: stats('NYG') }, playerStats: {}, scoringPlays: [] }; }
global.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.origin === 'https://fixture.invalid') {
    if (url.pathname.endsWith('/weekly-sage-refresh-background') && dispatchedWorker) {
      await dispatchedWorker.handler({ ...event, httpMethod: 'POST', headers: { ...event.headers, ...init.headers }, body: init.body });
      return new Response(null, { status: 202 });
    }
    if (customerRankings) return Response.json(customerRankings);
    throw Error('Unexpected synthetic customer route');
  }
  if (url.origin === 'https://blobs.synthetic.invalid') {
    const segments = url.pathname.split('/').slice(1).map(decodeURIComponent);
    assert.equal(segments.shift(), 'synthetic-site', 'Storage never crosses the synthetic site boundary');
    segments[0] = segments[0].replace(/^site:/, '');
    const key = segments.join('/'), prior = records.get(key), headers = new Headers(init.headers);
    if (String(init.method).toUpperCase() === 'PUT') {
      if ((headers.get('if-none-match') === '*' && prior) || (headers.has('if-match') && headers.get('if-match') !== prior?.etag))
        return new Response(null, { status: 412 });
      const data = JSON.parse(typeof init.body === 'string' ? init.body : await new Response(init.body).text());
      const etag = String(++revision); records.set(key, { data, etag }); writes.push(key);
      return new Response(null, { status: 200, headers: { etag } });
    }
    return prior ? new Response(JSON.stringify(prior.data), { status: 200, headers: { etag: prior.etag } }) : new Response(null, { status: 404 });
  }
  if (url.hostname === 'tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com') {
    providerCalls++;
    if (url.pathname.endsWith('/getNFLGamesForWeek')) {
      builds++;
      if (mode === 'schedule-http') return new Response(null, { status: 503 });
      const games = mode === 'duplicate' ? [game, game] : mode === 'wrong-week' ? [{ ...game, gameWeek: 7 }] : [game];
      return Response.json({ body: mode === 'not-final' ? [{ ...game, gameStatus: 'In Progress' }] : games });
    }
    assert(url.pathname.endsWith('/getNFLBoxScore'), 'Only existing defensive provider calls are permitted');
    if (mode === 'request-error') throw Error('synthetic request failed with SECRET_URL');
    if (mode === 'provider-403') return new Response(null, { status: 403 });
    if (mode === 'invalid-json') return new Response('not JSON');
    const data = box();
    if (mode === 'two-incomplete' && builds <= 2) delete data.teamStats.away;
    if (mode === 'missing-numeric') delete data.teamStats.home.rushTD;
    if (mode === 'missing-score') data.homePts = null;
    if (mode === 'bad-pair') data.teamStats.home.passCompletionsAndAttempts = 'unknown';
    if (mode === 'wrong-team') data.teamStats.home.teamAbv = 'SEA';
    return Response.json({ body: data });
  }
  throw Error('Unexpected network access blocked by defensive recovery test');
};
const defense = jobsForWeek(2026, 9).find(j => j.store === 'weekly-sage-defense' && j.week === 8);
const status = () => read('weekly-sage-refresh-status', stateKey(defense));
const build = () => writer.handler(event);
async function attempt() { return runJob(defense, event, { getStore, build, now: clock }); }

function positionSnapshot(job) {
  const position = job.store.split('-')[0].toUpperCase();
  return { evidenceType: job.evidenceType, season: '2026', targetWeek: 9, seasonType: 'reg',
    population: [{ name: `Fixture ${position}`, position, rank: 1 }], failures: [], nextStep: { ready: true },
    populationSummary: { weeksWithEvidence: 8, weeksScanned: 8 } };
}
const progressed = [];
async function pipelineView() { return inspectJobs(getStore, 2026, 9, clock); }
function seedCorePrerequisites() {
  const stamp = new Clock().toISOString();
  for (const job of jobsForWeek(2026, 9)) {
    if (job.store.endsWith('-snapshot') || job.store === defense.store && job.week === 8) continue;
    const base = { evidenceType: job.evidenceType, season: job.season, targetWeek: job.week, week: job.week, seasonType: 'reg' };
    let value;
    if (job.store === 'weekly-sage-schedule') value = { ...base, games: [{ ...game, gameWeek: String(job.week) }], gamesReturned: 1 };
    else if (job.store === 'weekly-sage-defense') value = { ...base, schedule: { gamesReturned: 1, completedGames: 1, processedGames: 1 }, gameResults: [{ status: 'processed' }] };
    else if (job.store === 'opportunity-intel') value = { ...base, weeksRequested: [job.week], gamesFound: 1, gamesFailed: 0, records: { synthetic: {} } };
    else if (job.store === 'risers-fallers') value = { ...base, currentWeek: job.week, previousWeek: job.week - 1, allDeltas: { synthetic: {} } };
    else if (job.store === 'player-data') value = { updatedAt: stamp, availabilityMode: 'tank01-full-player-list-v1', teamsSucceeded: 32, teamsFailed: 0, players: Object.fromEntries(Array.from({ length: 1000 }, (_, i) => ['synthetic-' + i, {}])) };
    else if (job.store === 'weekly-projections') value = { ...base, generatedAt: stamp, rows: Array.from({ length: 100 }, () => ({})) };
    else if (job.store === 'sage-newswire') value = { updatedAt: stamp, mode: 'editorial-with-sources', collection: { automaticStories: 1 }, stories: [{ headline: 'Synthetic verified source' }] };
    else if (job.store === 'sage-role-events') value = { version: 1, season: 2026, events: [], dedicatedCollection: { checkedAt: stamp, indexesSucceeded: 1 } };
    seed(job.store, cacheKey(job), value);
  }
}

function loadPipeline(file) {
  const sandbox = { exports: {}, Date: Clock, URL, process, console, fetch: (...args) => global.fetch(...args),
    require(name) {
      if (name === './_weekly-refresh-recovery.js') return { ...recovery, inspectJobs: pipelineView, resolveCurrentNFLWeek: () => 9 };
      if (name === './refresh-weekly-sage-defense.js') return writer;
      if (/^\.\/refresh-(qb|rb|wr|te|k|def)-snapshot\.js$/.test(name)) return { handler: async incoming => {
        const job = jobsForWeek(2026, 9).find(j => name === './' + j.job + '.js');
        assert.equal(incoming.queryStringParameters.week, '9');
        assert(recovery.completeCache(read(defense.store, cacheKey(defense)), defense), 'No positional build before complete defense');
        progressed.push(job.store.split('-')[0].toUpperCase());
        await getStore({ name: job.store }).setJSON(cacheKey(job), positionSnapshot(job));
        return { statusCode: 200, body: JSON.stringify({ cached: true }) };
      } };
      return require(name === '@netlify/blobs' ? name : '../netlify/functions/' + name);
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../netlify/functions', file), 'utf8'), sandbox);
  return sandbox.exports;
}

async function main() {
  reset('two-incomplete');
  seedCorePrerequisites();
  process.env.TANK01_REFRESH_TOKEN = 'synthetic-signing-only';
  process.env.URL = 'https://fixture.invalid';
  dispatchedWorker = loadPipeline('weekly-sage-refresh-background.js');
  const watchdog = loadPipeline('recover-weekly-sage.js');
  const tick = () => watchdog.handler(event);
  const old = { generatedAt: 'old-good-evidence', schedule: { processedGames: 0 } };
  seed(defense.store, cacheKey(defense), old);
  await Promise.all(Array.from({ length: 8 }, tick));
  assert.equal(builds, 1, 'Concurrent watchdog deliveries execute only one provider build');
  assert.equal(status().statusCode, 422);
  assert.equal(status().failure.category, 'provider_incomplete');
  assert.deepEqual(status().failure.gameIDs, [game.gameID]);
  assert.equal(status().failure.counts.affected, 1);
  assert.deepEqual(read(defense.store, cacheKey(defense)), old, 'Failed builds preserve the prior cache byte for byte');
  assert.equal(status().retryAfter - clock, 30 * 60000);
  clock += 30 * 60000 - 1; await tick(); assert.equal(builds, 1);
  clock++; await tick(); assert.equal(builds, 2);
  assert.equal(status().retryAfter - clock, 60 * 60000);
  assert.deepEqual(read(defense.store, cacheKey(defense)), old);
  clock += 60 * 60000; await tick();
  assert.equal(builds, 3); assert.equal(status().status, 'ready'); assert.equal(status().attempts, 3);
  assert.equal(status().lastFailure.failure.category, 'provider_incomplete', 'Success retains bounded last-failure evidence');
  assert.equal(read(defense.store, cacheKey(defense)).schedule.processedGames, 1);
  assert.equal(providerCalls, 6); assert.equal(read('tank01-daily-budget', 'day:2026-11-03').reserved, 51);

  // The real watchdog and signed worker loop progressed through frozen positional workers.
  assert.deepEqual(progressed, ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
  const readyReport = JSON.parse((await tick()).body);
  assert.equal(readyReport.core.status, 'READY');
  assert.equal((await loadPipeline('weekly-sage-status.js').handler({ ...event, httpMethod: 'GET' })).statusCode, 200);
  const rankingRows = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map(position => ({ name: `Fixture ${position}`, position, rank: 1, recommendation: 'START', team: 'DAL' }));
  const decisionInput = { season: 2026, week: 9, scoring: 'half',
    rankings: { positions: Object.fromEntries(rankingRows.map(row => [row.position, [row]])) },
    candidates: rankingRows.map(row => ({ name: row.name, position: row.position, row })),
    slots: rankingRows.map(row => ({ slotLabel: row.position, eligiblePositions: [row.position], count: 1 })) };
  const before = decideLineup(decisionInput), after = decideLineup(decisionInput);
  assert.equal(after.slots.length, 6); assert(after.slots.every(s => s.starter)); assert.deepEqual(after, before);

  // Invoke the existing registered customer tools against the recovered synthetic week.
  customerRankings = { season: 2026, week: 9, positions: decisionInput.rankings.positions, metadata: { complete: true } };
  const { _test: mcp } = require('../netlify/functions/chatgpt-mcp');
  const snapshot = { provider: 'cbs', league: { season: 2026, teamCount: 12, currentWeek: 9 }, scoringFormat: 'half-ppr',
    roster: rankingRows.map(row => ({ name: row.name, position: row.position, status: 'A' })),
    settings: { lineupSlots: rankingRows.map(row => ({ slot: row.position, count: 1 })) } };
  const server = mcp.buildServer(new Request('https://fixture.invalid/.netlify/functions/chatgpt-mcp'), { snapshot });
  for (const [name, args] of [
    ['get_weekly_rankings', { season: 2026, week: 9, position: 'QB', scoring: 'half' }],
    ['get_player_profile', { player: 'Fixture RB', season: 2026, week: 9, scoring: 'half' }],
    ['compare_players', { players: ['Fixture RB', 'Fixture WR'], season: 2026, week: 9, scoring: 'half' }],
    ['get_lineup_recommendation', { season: 2026, week: 9, scoring: 'half' }]
  ]) {
    const response = await server._registeredTools[name].handler(args);
    assert(!response.isError, name + ': ' + JSON.stringify(response));
    assert(response.structuredContent || response.content?.length, name + ' returns a customer response');
    const data = response.structuredContent;
    if (name === 'get_weekly_rankings') assert.equal(data.returned, 1);
    if (name === 'get_player_profile') assert.equal(data.found, true);
    if (name === 'compare_players') { assert(data.players.every(player => player.found)); assert.equal(data.comparison.final, false); }
    if (name === 'get_lineup_recommendation') {
      assert.equal(data.starters.length, 6); assert.equal(data.unfilledSlots.length, 0);
      assert.equal(data.superSage.authority, 'super-sage-lineup-decision');
      assert.equal(data.context.week, 9);
    }
  }
  customerRankings = null;
  clock += 86400000;
  await attempt(); assert.equal(builds, 3, 'Complete defensive evidence never rebuilds, including after UTC rollover');

  reset('missing-numeric'); clock = RealDate.parse('2026-11-03T06:00:00Z');
  for (let i = 1; i <= 4; i++) {
    await attempt(); assert.equal(status().attempts, i); assert.equal(status().attemptLimit, 4);
    if (i < 4) { assert.equal(status().retryAfter - clock, [30, 60, 120][i - 1] * 60000); clock = status().retryAfter; }
  }
  const exhaustedCalls = providerCalls; clock += 2 * 86400000;
  await attempt(); assert.equal(providerCalls, exhaustedCalls, 'UTC reset does not replenish the four-build defensive allowance');
  assert.equal(status().blockedReason, 'defense_attempt_limit');
  assert.equal(read(defense.store, cacheKey(defense)), undefined);

  for (const [scenario, category, retryable] of [
    ['request-error', 'provider_request', true], ['invalid-json', 'provider_incomplete', true],
    ['schedule-http', 'provider_request', true], ['not-final', 'schedule_incomplete', true],
    ['missing-score', 'provider_incomplete', true], ['bad-pair', 'provider_incomplete', true],
    ['duplicate', 'identity', false], ['wrong-week', 'identity', false], ['wrong-team', 'identity', false],
    ['provider-403', 'validation', false]
  ]) {
    reset(scenario); await attempt();
    assert.equal(status().failure.category, category, scenario); assert.equal(status().failure.retryable, retryable);
    const count = providerCalls; clock += 86400000;
    if (!retryable) { await attempt(); assert.equal(providerCalls, count); assert.equal(status().blockedReason, `defense_${category}`); }
    assert(!JSON.stringify(status()).includes('SECRET_URL'));
  }
  reset();
  await runJob(defense, event, { getStore, now: clock, build: async () => { throw Error('secret synthetic exception'); } });
  assert.equal(status().failure.category, 'processing'); assert.equal(canRetry(status(), clock + 86400000), false);
  assert(!JSON.stringify(status()).includes('secret synthetic exception'));

  reset();
  seed('tank01-daily-budget', `day:${new Clock().toISOString().slice(0, 10)}`, { reserved: 700, normalReserved: 600, jobs: {} });
  await attempt(); assert.equal(status().statusCode, 429); assert.equal(providerCalls, 0); assert.equal(status().failure.category, 'budget');
  assert.equal(canRetry(status(), clock + 3600000), false); assert.equal(canRetry(status(), clock + 86400000), true);

  reset();
  const lease = { retryPolicy: DEFENSE_POLICY, day: '2026-11-03', attempts: 2, attemptLimit: 4, leaseUntil: clock + 60000 };
  seed('weekly-sage-refresh-status', stateKey(defense), lease);
  await attempt(); assert.equal(providerCalls, 0); clock += 60000;
  await attempt(); assert.equal(builds, 1); assert.equal(status().attempts, 3, 'Expired leases resume without resetting attempts');
  // Legacy incomplete states do not get four more attempts on adoption.
  reset(); seed('weekly-sage-refresh-status', stateKey(defense), { status: 'failed', day: '2026-10-27', attempts: 2, attemptLimit: 2, leaseUntil: 0 });
  const viewed = (await inspectJobs(getStore, 2026, 9, clock)).find(j => j.week === 8 && j.store === defense.store);
  assert.equal(viewed.status.attemptLimit, 4); assert.equal(viewed.status.attempts, 2);

  assert.equal(_test.numberValue(null), null); assert.equal(_test.numberValue(''), null); assert.equal(_test.numberValue('x'), null); assert.equal(_test.numberValue('0'), 0);
  assert.equal(_test.requiredStatsPresent(box()), true); const missing = box(); delete missing.teamStats.home.rushTD; assert.equal(_test.requiredStatsPresent(missing), false);
  const sanitized = failure('not-a-category', ['https://secret.invalid/path?token=x', ...Array.from({ length: 30 }, (_, i) => `game_${i}`)], { affected: 99999 });
  assert.equal(sanitized.category, 'validation'); assert.equal(sanitized.gameIDs.length, 16); assert.equal(sanitized.counts.affected, 100);
  assert(!JSON.stringify(sanitized).includes('secret'));
  assert.equal(summarize(null, ['bad']).category, 'validation');
  const diag = await refreshDiagnostics(getStore, [{ ...defense, ready: false, status: { ...viewed.status, failure: failure('identity'), blockedReason: 'defense_identity' } }], clock);
  assert.equal(diag.jobs[0].failure.category, 'identity'); assert.equal(diag.jobs[0].blockedReason, 'defense_identity');
  console.log(`PASS: defensive same-day recovery, six positional contracts, core READY, unchanged lineup authority, CAS exclusion, budget denial, backoff/limit, diagnostics and missing-vs-zero (${process.env.DEFENSE_WRITER_BUNDLE ? 'NETLIFY BUNDLE' : 'SOURCE'}).`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  global.fetch = realFetch; global.Date = RealDate;
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});
