'use strict';

// Regression: Tank01 game IDs use the YYYYMMDD_AWAY@HOME format
// (e.g. 20260909_NE@SEA, as in this repo's schedule fixtures and in
// _super-sage-role-establishment.js). The schedule identity guard and the
// persisted failure sanitizer must accept that format, while still refusing
// URLs, messages and other unsafe identifiers. Synthetic provider responses
// only; no network, no Blobs, no Tank01.

const assert = require('assert');
require('./test-runtime-bootstrap.js');

const { buildWeeklyDefense } = require('../netlify/functions/weekly-sage-defense-week.js');
const { validateCompleteDefense } = require('../netlify/functions/refresh-weekly-sage-defense.js');
const { failure } = require('../netlify/functions/_weekly-defense-failure.js');

const TANK01_HOST = 'tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com';
const games = [
  { gameID: '20261101_NYG@DAL', away: 'NYG', home: 'DAL', gameStatus: 'Completed', gameWeek: '8', season: '2026' },
  { gameID: '20261101_SF@LAR', away: 'SF', home: 'LAR', gameStatus: 'Final', gameWeek: '8', season: '2026' }
];

function stats(team, yards) {
  return { teamAbv: team, passCompletionsAndAttempts: '20-30', sacksAndYardsLost: '2-10', rushingAttempts: '25',
    rushingYards: String(yards), rushTD: '1', passingYards: '220', passTD: '2', interceptionsThrown: '1',
    totalYards: String(220 + yards), totalPlays: '57' };
}

let providerCalls = [];
const realFetch = global.fetch;
global.fetch = async input => {
  const url = new URL(String(input));
  assert.equal(url.hostname, TANK01_HOST, 'Only the existing Tank01 endpoints are called');
  providerCalls.push(url.pathname.slice(1));
  if (url.pathname === '/getNFLGamesForWeek') return Response.json({ body: games });
  assert.equal(url.pathname, '/getNFLBoxScore');
  const game = games.find(g => g.gameID === url.searchParams.get('gameID'));
  assert(game, 'Box score requested only for a scheduled game, with its exact Tank01 ID');
  return Response.json({ body: { homePts: '17', awayPts: '24', teamStats: { home: stats(game.home, 90), away: stats(game.away, 120) }, playerStats: {}, scoringPlays: [] } });
};

async function main() {
  process.env.TANK01_API_KEY = 'synthetic-test-key';

  // 1. A real-format week builds completely and passes the unchanged
  //    completeness validation used before any cache write.
  const evidence = await buildWeeklyDefense({ season: '2026', week: 8, seasonType: 'reg' });
  assert.deepEqual(providerCalls, ['getNFLGamesForWeek', 'getNFLBoxScore', 'getNFLBoxScore'],
    'Provider cost stays 1 schedule call + 1 box score per completed game');
  assert.equal(evidence.schedule.processedGames, 2);
  assert(evidence.gameResults.every(g => g.status === 'processed'));
  assert.deepEqual(validateCompleteDefense(evidence, { season: '2026', week: 8, seasonType: 'reg' }), []);
  assert.deepEqual(Object.keys(evidence.defenses), ['DAL', 'LAR', 'NYG', 'SF']);
  // Measured values only: DAL faced NYG's 120 rushing yards; SF faced LAR's 90.
  assert.equal(evidence.defenses.DAL.runDefense.yardsAllowed, 120);
  assert.equal(evidence.defenses.SF.runDefense.yardsAllowed, 90);
  assert.equal(evidence.defenses.DAL.pointsAllowed.total, 24);
  assert.equal(evidence.defenses.NYG.gamesUsed[0].gameID, '20261101_NYG@DAL');

  // 2. Schedule identity protection is unchanged for genuinely bad IDs.
  for (const bad of ['', 'https://x.invalid/a?b=c', 'game id with spaces', 'a'.repeat(81), '20261101_NYG@DAL/../x']) {
    games.splice(0, games.length, { gameID: bad, away: 'NYG', home: 'DAL', gameStatus: 'Final', gameWeek: '8', season: '2026' });
    providerCalls = [];
    await assert.rejects(buildWeeklyDefense({ season: '2026', week: 8, seasonType: 'reg' }),
      error => error.defenseCategory === 'identity', `Rejected unsafe gameID: ${JSON.stringify(bad)}`);
    assert.deepEqual(providerCalls, ['getNFLGamesForWeek'], 'Identity failure stops before any box-score call');
  }

  // 3. Persisted diagnostics retain real Tank01 IDs and still drop unsafe text.
  const persisted = failure('identity', ['20261101_NYG@DAL', 'https://secret.invalid/?token=x', 'two words']);
  assert.deepEqual(persisted.gameIDs, ['20261101_NYG@DAL']);
  assert(!JSON.stringify(persisted).includes('secret'));

  console.log('PASS: Tank01 YYYYMMDD_AWAY@HOME game IDs build complete defensive evidence; unsafe IDs remain rejected.');
}

main().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => { global.fetch = realFetch; });
