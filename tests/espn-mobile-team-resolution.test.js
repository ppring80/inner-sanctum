'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const espnPath = path.join(
  __dirname,
  '..',
  'netlify',
  'functions',
  'espn-league.js'
);

const teamContextPath = path.join(
  __dirname,
  '..',
  'team-context.js'
);

async function run() {
  const originalFetch = global.fetch;
  let fetchCount = 0;

  try {
    global.fetch = async function () {
      fetchCount += 1;

      if (fetchCount === 1) {
        return {
          ok: true,
          status: 200,
          json: async function () {
            return {
              id: 934410067,
              name: 'Los Angeles Pro H2H Points PPR League',
              scoringPeriodId: 1,
              teams: [
                {
                  id: 3,
                  primaryOwner: '{someone-else}',
                  roster: { entries: [] }
                },
                {
                  id: 7,
                  primaryOwner: 'ABC-123',
                  owners: ['{ABC-123}'],
                  roster: { entries: [] }
                }
              ]
            };
          }
        };
      }

      return {
        ok: true,
        status: 200,
        json: async function () {
          return { players: [] };
        }
      };
    };

    delete require.cache[require.resolve(espnPath)];
    const { handler } = require(espnPath);

    const response = await handler({
      httpMethod: 'POST',
      headers: { origin: 'https://theinnersanctum.xyz' },
      body: JSON.stringify({
        leagueId: '934410067',
        season: 2026,
        espn_s2: 'request-only-secret',
        swid: '{ABC-123}'
      })
    });

    assert.strictEqual(response.statusCode, 200);

    const body = JSON.parse(response.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.league.resolvedTeamId, '7');
    assert.strictEqual(body.league.teams.length, 2);
    assert.ok(!response.body.includes('request-only-secret'));

    const teamContextSource = fs.readFileSync(teamContextPath, 'utf8');
    assert.ok(
      teamContextSource.includes('connection?.league?.resolvedTeamId'),
      'team-context must prefer the server-derived ESPN team identity hint.'
    );

    console.log('PASS ESPN mobile team resolution: request-only SWID resolves safe teamId hint');
  } finally {
    global.fetch = originalFetch;
  }
}

run().catch(function (error) {
  console.error(error);
  process.exit(1);
});