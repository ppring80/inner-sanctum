const assert = require('assert');
const fs = require('fs');
const path = require('path');

const readerSource = fs.readFileSync(path.join(__dirname, '../netlify/functions/survivor-odds.js'), 'utf8');
assert.ok(!readerSource.includes('rapidapi.com'), 'public Survivor reader must not know the Tank01 host');
assert.ok(!readerSource.includes('TANK01_API_KEY'), 'public Survivor reader must not access the Tank01 key');
assert.ok(readerSource.includes('getStore'), 'public Survivor endpoint must read the snapshot store');
assert.ok(readerSource.includes('ageMinutes') && readerSource.includes('stale'), 'reader must disclose snapshot freshness');

const refresh = require('../netlify/functions/refresh-survivor-odds.js');
assert.strictEqual(refresh.MAX_TANK01_CALLS_PER_RUN, 8, 'refresh must have a hard request ceiling');

const moneyline = refresh.probabilities({ awayTeamMLOdds: '+180', homeTeamMLOdds: '-210' });
assert.strictEqual(moneyline.method, 'moneyline-devigged');
assert.ok(Math.abs(moneyline.away + moneyline.home - 1) < 0.000001);
assert.ok(moneyline.home > moneyline.away);

const aliases = refresh.probabilities({ awayMoneyline: 150, homeMoneyline: -175 });
assert.strictEqual(aliases.method, 'moneyline-devigged', 'current moneyline aliases must parse');

const spread = refresh.probabilities({ homeTeamSpread: '-5.5' });
assert.strictEqual(spread.method, 'spread-estimate');
assert.ok(spread.home > 0.5, 'negative home spread means home favorite');
assert.ok(Math.abs(spread.away + spread.home - 1) < 0.000001);

const games = refresh.mergeGames(
  [{ gameID: 'A', gameDate: '20260920', gameTime: '1:00p', away: 'NYG', home: 'DAL' }],
  { A: { draftkings: { awayTeamMLOdds: 200, homeTeamMLOdds: -240, homeTeamSpread: -6 } } }
);
assert.strictEqual(games.length, 1);
assert.strictEqual(games[0].sportsbook, 'draftkings');
assert.strictEqual(games[0].oddsFound, true);
assert.ok(games[0].homeWinPct > games[0].awayWinPct);
assert.strictEqual(games[0].probabilityMethod, 'moneyline-devigged');

console.log('survivor-snapshot-safety.test.js passed');
