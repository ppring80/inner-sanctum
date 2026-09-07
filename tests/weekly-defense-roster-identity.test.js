'use strict';

const assert = require('assert');
const path = require('path');

const rankingsPath = path.join(
  __dirname,
  '..',
  'netlify',
  'functions',
  'weekly-sage-rankings.js'
);

async function run() {
  const originalFetch = global.fetch;

  try {
    global.fetch = async function (url) {
      assert.ok(
        String(url).includes('/.netlify/functions/weekly-sage-week1-rankings'),
        'Week 1 must continue through the dedicated Week 1 rankings endpoint.'
      );

      return {
        ok: true,
        status: 200,
        json: async function () {
          return {
            positions: {
              QB: [{ name: 'Joe Burrow', position: 'QB', team: 'CIN' }],
              RB: [],
              WR: [],
              TE: [],
              K: [],
              DEF: [
                {
                  name: 'Houston Texans',
                  position: 'DEF',
                  team: 'HOU',
                  overallRank: 160,
                  positionRank: 5,
                  recommendation: 'START'
                }
              ]
            },
            failures: {},
            metadata: { source: 'week1-test' }
          };
        }
      };
    };

    delete require.cache[require.resolve(rankingsPath)];
    const { handler } = require(rankingsPath);

    const response = await handler({
      httpMethod: 'GET',
      headers: { host: 'example.test', 'x-forwarded-proto': 'https' },
      queryStringParameters: {
        season: '2026',
        week: '1',
        seasonType: 'reg',
        scoring: 'half-ppr',
        teams: '10'
      }
    });

    assert.strictEqual(response.statusCode, 200);

    const body = JSON.parse(response.body);
    const hou = body.positions.DEF[0];

    // ESPN's roster normalization stores Houston D/ST as canonical HOU.
    // Weekly My Roster uses exact-name identity, so Week 1 must expose the
    // same canonical name even though Tank01 calls the row Houston Texans.
    assert.strictEqual(hou.name, 'HOU');
    assert.strictEqual(hou.team, 'HOU');
    assert.strictEqual(hou.position, 'DEF');
    assert.strictEqual(hou.displayName, 'Houston Texans');

    // Identity normalization must not alter the football recommendation.
    assert.strictEqual(hou.overallRank, 160);
    assert.strictEqual(hou.positionRank, 5);
    assert.strictEqual(hou.recommendation, 'START');

    assert.strictEqual(body.scoring, 'half-ppr');
    assert.strictEqual(body.teams, 10);
    assert.strictEqual(body.metadata.defenseIdentity, 'canonical-nfl-team-code');

    console.log('PASS weekly defense roster identity: ESPN HOU D/ST matches Week 1 HOU DEF');
  } finally {
    global.fetch = originalFetch;
  }
}

run().catch(function (error) {
  console.error(error);
  process.exit(1);
});
