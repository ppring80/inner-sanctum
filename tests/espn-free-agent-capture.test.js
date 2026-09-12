'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'cbs-extension', 'espn-main-bridge.js'),
  'utf8'
);

function leaguePayload() {
  return {
    id: 1094040685,
    scoringPeriodId: 2,
    settings: { name: 'Los Angeles Pro H2H Points PPR League', size: 10 },
    status: { currentScoringPeriod: 2, currentMatchupPeriod: 2 },
    teams: [{
      id: 10,
      name: 'Old School',
      record: { overall: { wins: 0, losses: 0, ties: 0 } },
      roster: {
        entries: [{
          lineupSlotId: 0,
          playerPoolEntry: {
            player: {
              id: 1,
              fullName: 'Joe Burrow',
              defaultPositionId: 1,
              proTeamId: 4
            }
          }
        }]
      }
    }],
    schedule: []
  };
}

function availabilityPayload() {
  return {
    players: [
      {
        status: 'FREEAGENT',
        percentOwned: 42.5,
        player: {
          id: 100,
          fullName: 'Kirk Cousins',
          defaultPositionId: 1,
          proTeamId: 1,
          stats: [{ scoringPeriodId: 2, statSourceId: 1, appliedTotal: 17.4 }]
        }
      },
      {
        status: 'WAIVERS',
        percentOwned: 18,
        player: {
          id: 200,
          fullName: 'Jason Myers',
          defaultPositionId: 5,
          proTeamId: 26
        }
      },
      {
        status: 'FREEAGENT',
        percentOwned: 35,
        player: {
          id: 300,
          fullName: 'Seattle Seahawks',
          defaultPositionId: 16,
          proTeamId: 26
        }
      }
    ]
  };
}

async function runCapture({ availabilityOk = true } = {}) {
  let listener = null;
  let posted = null;
  const calls = [];

  const window = {
    location: {
      href: 'https://fantasy.espn.com/football/team?leagueId=1094040685&teamId=10&seasonId=2026'
    },
    addEventListener(type, fn) {
      if (type === 'message') listener = fn;
    },
    postMessage(message) {
      posted = message;
    }
  };

  const context = {
    window,
    document: { cookie: '' },
    URL,
    Date,
    console,
    encodeURIComponent,
    fetch: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (calls.length === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => leaguePayload()
        };
      }
      return availabilityOk
        ? { ok: true, status: 200, json: async () => availabilityPayload() }
        : { ok: false, status: 503, json: async () => ({}) };
    }
  };

  vm.runInNewContext(source, context, { filename: 'espn-main-bridge.js' });
  assert.strictEqual(typeof listener, 'function', 'ESPN bridge should install message listener');

  await listener({
    source: window,
    data: { type: 'INNER_SANCTUM_ESPN_MAIN_CAPTURE_REQUEST', requestId: 'test-1' }
  });

  return { posted, calls };
}

(async function run() {
  const success = await runCapture();
  assert(success.posted, 'bridge should post a response');
  assert.strictEqual(success.posted.success, true);
  assert.strictEqual(success.calls.length, 2, 'league capture should make league + availability requests');

  const availabilityCall = success.calls[1];
  assert.match(availabilityCall.url, /view=kona_player_info/);
  assert.match(availabilityCall.url, /scoringPeriodId=2/);
  assert.strictEqual(availabilityCall.options.credentials, 'include');
  assert.strictEqual(availabilityCall.options.method, 'GET');
  assert.strictEqual(availabilityCall.options.cache, 'no-store');

  const filter = JSON.parse(availabilityCall.options.headers['x-fantasy-filter']);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(filter.players.filterStatus.value)),
    ['FREEAGENT', 'WAIVERS']
  );
  assert.strictEqual(filter.players.limit, 1000);

  const data = success.posted.data;
  assert.strictEqual(data.team.name, 'Old School');
  assert.strictEqual(data.roster[0].name, 'Joe Burrow');
  assert.strictEqual(data.availablePlayers.length, 3);
  assert.strictEqual(data.league.availablePlayers.length, 3);
  assert.strictEqual(data.availabilityMeta.complete, true);
  assert.strictEqual(data.meta.dataQuality.availablePlayerCount, 3);

  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(data.availablePlayers.map((p) => [p.name, p.position, p.nflTeam, p.availabilityStatus]))),
    [
      ['Kirk Cousins', 'QB', 'ATL', 'FREE_AGENT'],
      ['Jason Myers', 'K', 'SEA', 'WAIVERS'],
      ['Seattle Seahawks', 'D/ST', 'SEA', 'FREE_AGENT']
    ]
  );
  assert.strictEqual(data.availablePlayers[0].projectedPoints, 17.4);

  const degraded = await runCapture({ availabilityOk: false });
  assert.strictEqual(degraded.posted.success, true, 'availability failure must not break ESPN league connection');
  assert.strictEqual(degraded.posted.data.availablePlayers.length, 0);
  assert.strictEqual(degraded.posted.data.availabilityMeta.complete, false);
  assert.strictEqual(degraded.posted.data.availabilityMeta.status, 503);
  assert.strictEqual(degraded.posted.data.team.name, 'Old School');
  assert.strictEqual(degraded.posted.data.roster.length, 1);

  assert.doesNotMatch(source, /chrome\.cookies|Authorization\s*:/);
  assert.match(source, /credentials:\s*"include"/);

  console.log('ESPN free-agent capture regression tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
