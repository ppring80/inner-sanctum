'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const fallback = require('../weekly-provider-fallback.js');

function test(name, fn) {
  try {
    fn();
    console.log('✓ ' + name);
  } catch (error) {
    console.error('✗ ' + name);
    throw error;
  }
}

test('builds position rankings from provider available players and roster', function () {
  const result = fallback.build({
    provider: 'espn',
    availablePlayers: [
      { id: '1', name: 'Quarterback Two', position: 'QB', team: 'BBB', projectedPoints: 17.2 },
      { id: '2', name: 'Quarterback One', position: 'QB', team: 'AAA', projectedPoints: 21.4 },
      { id: '3', name: 'Defense One', position: 'DST', team: 'CCC', projectedPoints: 7.1 }
    ],
    roster: [
      { id: '4', name: 'Roster Runner', position: 'RB', nflTeam: 'DDD', projectedPoints: 13.6 }
    ]
  }, { season: 2026, week: 2, scoring: 'half' });

  assert.ok(result);
  assert.strictEqual(result.metadata.providerProjectionFallbackUsed, true);
  assert.strictEqual(result.metadata.playerCount, 4);
  assert.deepStrictEqual(result.positions.QB.map((row) => row.name), [
    'Quarterback One',
    'Quarterback Two'
  ]);
  assert.strictEqual(result.positions.QB[0].positionRank, 1);
  assert.strictEqual(result.positions.DEF[0].position, 'DEF');
  assert.strictEqual(result.positions.RB[0].projectedPoints, 13.6);
  assert.strictEqual(result.positions.QB[0].sageScore, null);
});

test('reads CBS projection collections and de-duplicates the same player', function () {
  const result = fallback.build({
    provider: 'cbs',
    roster: [
      { cbsPlayerId: '10', name: 'Tight End One', position: 'TE', nflTeam: 'MIN', projectedPoints: 6.2 }
    ],
    projections: {
      playerProjectionsById: [
        { cbsPlayerId: '10', name: 'Tight End One', position: 'TE', nflTeam: 'MIN', projectedPoints: 7.8 }
      ],
      playerProjectionsByName: [
        { name: 'Wide Receiver One', position: 'WR', nflTeam: 'SF', projectedPoints: 12.3 }
      ]
    }
  }, { season: 2026, week: 2, scoring: 'half' });

  assert.ok(result);
  assert.strictEqual(result.positions.TE.length, 1);
  assert.strictEqual(result.positions.TE[0].projectedPoints, 7.8);
  assert.strictEqual(result.positions.WR[0].name, 'Wide Receiver One');
});

test('returns null instead of inventing rankings without provider projections', function () {
  const result = fallback.build({
    provider: 'cbs',
    availablePlayers: [
      { name: 'No Projection', position: 'RB', nflTeam: 'GB' }
    ]
  }, { season: 2026, week: 2, scoring: 'half' });

  assert.strictEqual(result, null);
});

test('keeps roster players with missing projections without converting null to zero', function () {
  const result = fallback.build({
    provider: 'espn',
    roster: [
      { name: 'Missing Projection', position: 'QB', nflTeam: 'KC', projectedPoints: null },
      { name: 'Real Zero Projection', position: 'QB', nflTeam: 'BUF', projectedPoints: 0 },
      { name: 'Projected Starter', position: 'QB', nflTeam: 'MIA', projectedPoints: 18.4 }
    ]
  }, { season: 2026, week: 3, scoring: 'half' });

  assert.ok(result);
  assert.deepStrictEqual(result.positions.QB.map((row) => row.name), [
    'Projected Starter',
    'Real Zero Projection',
    'Missing Projection'
  ]);
  assert.strictEqual(result.positions.QB[2].projectedPoints, null);
  assert.ok(result.positions.QB[2].sageTake.includes('projection is unavailable'));
  assert.ok(!result.positions.QB[2].sageTake.includes('0.0 points'));
});

test('repairs legacy CBS roster zero placeholders but preserves explicit zero projections', function () {
  const result = fallback.build({
    provider: 'cbs',
    roster: [
      { cbsPlayerId: '21', name: 'Legacy Placeholder', position: 'QB', nflTeam: 'KC', projectedPoints: 0 },
      { cbsPlayerId: '22', name: 'Explicit Zero', position: 'QB', nflTeam: 'BUF', projectedPoints: 0 }
    ],
    projections: {
      playerProjectionsById: [
        { cbsPlayerId: '22', name: 'Explicit Zero', position: 'QB', nflTeam: 'BUF', projectedPoints: 0 }
      ]
    }
  }, { season: 2026, week: 3, scoring: 'half' });

  const byName = Object.fromEntries(result.positions.QB.map((row) => [row.name, row]));
  assert.strictEqual(byName['Legacy Placeholder'].projectedPoints, null);
  assert.ok(byName['Legacy Placeholder'].sageTake.includes('projection is unavailable'));
  assert.strictEqual(byName['Explicit Zero'].projectedPoints, 0);
  assert.ok(byName['Explicit Zero'].sageTake.includes('0.0 points'));
});

test('CBS capture initializes unknown roster projections as null', function () {
  const connector = fs.readFileSync(
    path.join(__dirname, '..', 'cbs-extension', 'cbs-browser-connector.js'),
    'utf8'
  );
  assert.ok(connector.includes('projectedPoints:\n            null,'));
  assert.ok(!connector.includes('projectedPoints:\n            0,'));
});

test('uses a joined numeric projection in preference to a roster null', function () {
  const result = fallback.build({
    provider: 'cbs',
    roster: [
      { cbsPlayerId: '12', name: 'Joined Quarterback', position: 'QB', nflTeam: 'KC', projectedPoints: null }
    ],
    projections: {
      playerProjectionsById: [
        { cbsPlayerId: '12', name: 'Joined Quarterback', position: 'QB', nflTeam: 'KC', projectedPoints: 22.7 }
      ]
    }
  }, { season: 2026, week: 3, scoring: 'half' });

  assert.strictEqual(result.positions.QB[0].projectedPoints, 22.7);
  assert.ok(result.positions.QB[0].sageTake.includes('22.7 points'));
});

test('weekly page installs provider fallback for both HTTP and network failures', function () {
  const html = fs.readFileSync(path.join(__dirname, '..', 'weekly.html'), 'utf8');
  assert.ok(html.includes('/weekly-provider-fallback.js'));
  assert.ok(html.includes('buildConnectedProviderFallback(season, week, scoring)'));
  assert.ok(html.includes('providerProjectionFallbackUsed === true'));
  assert.ok(html.includes('Current connected-provider projections are shown without inventing SAGE scores.'));
  assert.ok(html.includes("typeof player.providerProjectedPoints === 'number'"));
});

console.log('weekly provider fallback tests passed');
