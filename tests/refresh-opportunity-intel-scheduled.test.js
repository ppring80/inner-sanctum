// tests/refresh-opportunity-intel-scheduled.test.js
//
// Regression coverage for the Aug 17 2026 refresh-hardening pass to
// netlify/functions/refresh-opportunity-intel.js. Covers:
//   - the new pure scheduled-mode helpers directly
//   - manual mode being completely unaffected (same output shape as
//     before, still triggered by any explicit weeks/season param)
//   - true end-to-end scheduled-mode handler runs, with @netlify/blobs
//     mocked (same Module._resolveFilename technique already proven in
//     opportunity-intel-sample.test.js) and global.fetch mocked to
//     stand in for Tank01, exercising the REAL exports.handler and
//     REAL runScheduledRefresh() -- not a reimplementation of the
//     merge/safety-gate logic.
//
// Run: node tests/refresh-opportunity-intel-scheduled.test.js

const assert = require('assert');
const path = require('path');
const Module = require('module');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; failures.push(name + ' :: ' + e.message); }
}
async function testAsync(name, fn) {
  try { await fn(); passed++; }
  catch (e) { failed++; failures.push(name + ' :: ' + e.message); }
}

// ─────────────────────────────────────────────────────────
// MOCK @netlify/blobs BEFORE the first require of the module under
// test (requiring the real module first and mocking only on a second
// require silently fails on this Node version due to an internal
// per-parent module-resolution cache -- see opportunity-intel-sample
// .test.js's own note on this).
// ─────────────────────────────────────────────────────────
const blobStores = {}; // storeName -> { key -> value }
let lastSetJSONCalls = [];

function installBlobsMock() {
  const fakeModulePath = path.join(__dirname, '__fake_netlify_blobs_refresh__.js');
  require.cache[fakeModulePath] = {
    id: fakeModulePath,
    filename: fakeModulePath,
    loaded: true,
    exports: {
      connectLambda: () => {},
      getStore: ({ name }) => {
        if (!blobStores[name]) blobStores[name] = {};
        const store = blobStores[name];
        return {
          get: async (key) => (key in store ? store[key] : null),
          setJSON: async (key, value) => {
            store[key] = JSON.parse(JSON.stringify(value));
            lastSetJSONCalls.push({ store: name, key });
          },
        };
      },
    },
  };
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === '@netlify/blobs') return fakeModulePath;
    return originalResolve.call(this, request, ...rest);
  };
  return originalResolve;
}

const originalResolve = installBlobsMock();
const refreshModule = require('../netlify/functions/refresh-opportunity-intel.js');
Module._resolveFilename = originalResolve; // safe to restore now -- module is already loaded/cached

// ─────────────────────────────────────────────────────────
// Fetch mock -- stands in for both getNFLGamesForWeek and
// getNFLBoxScore. Controlled per-test via a mutable scenario object so
// each test can simulate a clean week, a partial failure, etc.
// ─────────────────────────────────────────────────────────
let fetchScenario = null;
const originalFetch = global.fetch;

function installFetchMock() {
  global.fetch = async (url) => {
    const u = new URL(url);
    if (u.pathname.includes('getNFLGamesForWeek')) {
      const week = u.searchParams.get('week');
      const games = (fetchScenario.gamesByWeek && fetchScenario.gamesByWeek[week]) || [];
      return {
        ok: true,
        json: async () => ({ body: games }),
      };
    }
    if (u.pathname.includes('getNFLBoxScore')) {
      const gameID = u.searchParams.get('gameID');
      const boxScore = fetchScenario.boxScoresByGameID && fetchScenario.boxScoresByGameID[gameID];
      if (boxScore === 'FAIL') {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      if (boxScore === 'EMPTY') {
        return { ok: true, json: async () => ({ body: {} }) }; // no playerStats -> treated as a failure
      }
      return { ok: true, json: async () => ({ body: { playerStats: boxScore || {} } }) };
    }
    throw new Error('Unexpected fetch URL in test: ' + url);
  };
}
function uninstallFetchMock() {
  global.fetch = originalFetch;
}

function makeGameEntry(gameID, week) {
  return { gameID, gameStatusCode: '2' };
}

function makeStatLine(playerID, longName, carries, targets) {
  return {
    playerID,
    longName,
    Rushing: { carries: String(carries) },
    Receiving: { targets: String(targets) },
  };
}

// player-data lookup used by BOTH manual and scheduled mode
function seedPlayerData(players) {
  blobStores['player-data'] = { playerData: { players } };
}

function resetStores() {
  Object.keys(blobStores).forEach((k) => delete blobStores[k]);
  lastSetJSONCalls = [];
}

// ─────────────────────────────────────────────────────────
// 1. PURE HELPERS
// ─────────────────────────────────────────────────────────
test('deriveCurrentSeason: August or later -> current calendar year', () => {
  assert.strictEqual(refreshModule.deriveCurrentSeason(new Date(Date.UTC(2026, 7, 15))), '2026'); // Aug 15
  assert.strictEqual(refreshModule.deriveCurrentSeason(new Date(Date.UTC(2026, 11, 31))), '2026'); // Dec 31
});
test('deriveCurrentSeason: before August -> previous calendar year', () => {
  assert.strictEqual(refreshModule.deriveCurrentSeason(new Date(Date.UTC(2027, 0, 15))), '2026'); // Jan 15 2027
  assert.strictEqual(refreshModule.deriveCurrentSeason(new Date(Date.UTC(2027, 6, 31))), '2026'); // Jul 31 2027
});
test('deriveCurrentSeason: exact rollover boundary (Aug 1)', () => {
  assert.strictEqual(refreshModule.deriveCurrentSeason(new Date(Date.UTC(2026, 7, 1))), '2026');
  assert.strictEqual(refreshModule.deriveCurrentSeason(new Date(Date.UTC(2026, 6, 31))), '2025');
});

test('deriveMaxCachedWeek: 0 for empty/missing records', () => {
  assert.strictEqual(refreshModule.deriveMaxCachedWeek({}), 0);
  assert.strictEqual(refreshModule.deriveMaxCachedWeek(null), 0);
  assert.strictEqual(refreshModule.deriveMaxCachedWeek(undefined), 0);
});
test('deriveMaxCachedWeek: finds the true max across multiple players and games', () => {
  const records = {
    'player a|RB': { _rawGames: [{ week: 1 }, { week: 3 }] },
    'player b|WR': { _rawGames: [{ week: 1 }, { week: 2 }, { week: 5 }] },
  };
  assert.strictEqual(refreshModule.deriveMaxCachedWeek(records), 5);
});
test('deriveMaxCachedWeek: works against a record with no _rawGames at all (defensive)', () => {
  const records = { 'player a|RB': {} };
  assert.strictEqual(refreshModule.deriveMaxCachedWeek(records), 0);
});

test('mergeGamesForPlayer: unions two disjoint game lists, sorted by week', () => {
  const existing = [{ gameID: 'g1', week: 1 }, { gameID: 'g2', week: 2 }];
  const incoming = [{ gameID: 'g3', week: 3 }];
  const merged = refreshModule.mergeGamesForPlayer(existing, incoming);
  assert.deepStrictEqual(merged.map((g) => g.gameID), ['g1', 'g2', 'g3']);
});
test('mergeGamesForPlayer: never drops an existing game, even with no new games', () => {
  const existing = [{ gameID: 'g1', week: 1 }];
  const merged = refreshModule.mergeGamesForPlayer(existing, []);
  assert.deepStrictEqual(merged.map((g) => g.gameID), ['g1']);
});
test('mergeGamesForPlayer: handles a brand-new player with no existing games', () => {
  const merged = refreshModule.mergeGamesForPlayer([], [{ gameID: 'g5', week: 5 }]);
  assert.deepStrictEqual(merged.map((g) => g.gameID), ['g5']);
});
test('mergeGamesForPlayer: does not duplicate an already-present gameID', () => {
  const existing = [{ gameID: 'g1', week: 1, carries: 10 }];
  const incoming = [{ gameID: 'g1', week: 1, carries: 10 }]; // same game re-supplied
  const merged = refreshModule.mergeGamesForPlayer(existing, incoming);
  assert.strictEqual(merged.length, 1);
});

test('REGULAR_SEASON_MAX_WEEK is 18', () => {
  assert.strictEqual(refreshModule.REGULAR_SEASON_MAX_WEEK, 18);
});

// ─────────────────────────────────────────────────────────
// 2. HANDLER-LEVEL: MANUAL MODE UNCHANGED
// ─────────────────────────────────────────────────────────
async function runHandlerTests() {
  await testAsync('manual mode (explicit weeks) still returns mode:"manual" and the same diagnostic shape as before', async () => {
    resetStores();
    installFetchMock();
    fetchScenario = {
      gamesByWeek: { '1': [makeGameEntry('g1', 1)] },
      boxScoresByGameID: { g1: { p1: makeStatLine('p1', 'Test Player', 10, 2) } },
    };
    seedPlayerData({ p1: { pos: 'RB' } });

    const res = await refreshModule.handler({ queryStringParameters: { weeks: '1' } });
    const body = JSON.parse(res.body);
    assert.strictEqual(body.mode, 'manual');
    assert.strictEqual(body.season, '2026'); // still the old hardcoded default -- unchanged, by design
    assert.deepStrictEqual(body.weeksRequested, [1]);
    assert.strictEqual(body.playersRecorded, 1);
    assert.strictEqual(body.writeOccurred, true);
    uninstallFetchMock();
  });

  await testAsync('manual mode with only season param (no weeks) still defaults to [1,2,3] exactly as before', async () => {
    resetStores();
    installFetchMock();
    fetchScenario = {
      gamesByWeek: { '1': [], '2': [], '3': [] }, // no completed games -> should hit the existing "skipped" path
    };
    const res = await refreshModule.handler({ queryStringParameters: { season: '2025' } });
    const body = JSON.parse(res.body);
    assert.strictEqual(body.skipped, true);
    assert.ok(body.reason.includes('[1,2,3]'), 'must still use the original [1,2,3] default for manual mode: ' + body.reason);
    uninstallFetchMock();
  });

  // ─────────────────────────────────────────────────────────
  // 3. HANDLER-LEVEL: SCHEDULED MODE
  // ─────────────────────────────────────────────────────────

  await testAsync('scheduled mode (no params) with no existing cache: starts at week 1, writes on success', async () => {
    resetStores();
    installFetchMock();
    const derivedSeason = refreshModule.deriveCurrentSeason(new Date());
    fetchScenario = {
      gamesByWeek: { '1': [makeGameEntry('g1', 1)] },
      boxScoresByGameID: { g1: { p1: makeStatLine('p1', 'Fresh Player', 12, 3) } },
    };
    seedPlayerData({ p1: { pos: 'RB' } });

    const res = await refreshModule.handler({ queryStringParameters: {} });
    const body = JSON.parse(res.body);
    assert.strictEqual(body.mode, 'scheduled');
    assert.strictEqual(body.derivedSeason, derivedSeason);
    assert.strictEqual(body.seasonRollover, true, 'no existing cache at all counts as a rollover into a fresh start');
    assert.strictEqual(body.targetWeek, 1);
    assert.strictEqual(body.writeOccurred, true);
    assert.strictEqual(body.playersRecordedTotal, 1);

    const written = blobStores['opportunity-intel'].latest;
    assert.strictEqual(written.records['fresh player|RB'].opportunities.gamesSampled, 1);
    uninstallFetchMock();
  });

  await testAsync('scheduled mode: same season, existing week 3 cached -> fetches ONLY week 4 and merges', async () => {
    resetStores();
    installFetchMock();
    const derivedSeason = refreshModule.deriveCurrentSeason(new Date());

    // Seed an existing same-season cache with a player who has 3 prior games.
    blobStores['opportunity-intel'] = {
      latest: {
        season: derivedSeason,
        records: {
          'existing player|RB': {
            playerID: 'p1',
            longName: 'Existing Player',
            pos: 'RB',
            _rawGames: [
              { week: 1, gameID: 'g1', carries: 10, targets: 1, opportunities: 11 },
              { week: 2, gameID: 'g2', carries: 12, targets: 2, opportunities: 14 },
              { week: 3, gameID: 'g3', carries: 14, targets: 3, opportunities: 17 },
            ],
            opportunities: { gamesSampled: 3 },
          },
        },
      },
    };

    fetchScenario = {
      gamesByWeek: { '4': [makeGameEntry('g4', 4)] },
      boxScoresByGameID: { g4: { p1: makeStatLine('p1', 'Existing Player', 16, 4) } },
    };
    seedPlayerData({ p1: { pos: 'RB' } });

    const res = await refreshModule.handler({ queryStringParameters: {} });
    const body = JSON.parse(res.body);
    assert.strictEqual(body.targetWeek, 4, 'must derive week 4 from the existing max-cached week of 3');
    assert.strictEqual(body.seasonRollover, false);
    assert.strictEqual(body.writeOccurred, true);

    const merged = blobStores['opportunity-intel'].latest.records['existing player|RB'];
    assert.strictEqual(merged._rawGames.length, 4, 'all 3 prior games plus the new week 4 game');
    assert.deepStrictEqual(merged._rawGames.map((g) => g.gameID), ['g1', 'g2', 'g3', 'g4']);
    assert.strictEqual(merged.opportunities.gamesSampled, 4, 'rebuilt via the real buildOpportunityIntelligence() over the merged history');
    uninstallFetchMock();
  });

  await testAsync('scheduled mode: a player untouched this week (bye) carries forward unchanged in the merge', async () => {
    resetStores();
    installFetchMock();
    const derivedSeason = refreshModule.deriveCurrentSeason(new Date());

    blobStores['opportunity-intel'] = {
      latest: {
        season: derivedSeason,
        records: {
          'bye player|WR': {
            playerID: 'p2',
            longName: 'Bye Player',
            pos: 'WR',
            _rawGames: [{ week: 1, gameID: 'gB1', carries: 0, targets: 5, opportunities: 5 }],
            opportunities: { gamesSampled: 1, seasonAvg: 5 },
          },
        },
      },
    };

    // Week 2's box scores don't mention "Bye Player" at all -- they're on bye.
    fetchScenario = {
      gamesByWeek: { '2': [makeGameEntry('g2', 2)] },
      boxScoresByGameID: { g2: { p3: makeStatLine('p3', 'Other Player', 8, 1) } },
    };
    seedPlayerData({ p2: { pos: 'WR' }, p3: { pos: 'RB' } });

    const res = await refreshModule.handler({ queryStringParameters: {} });
    const body = JSON.parse(res.body);
    assert.strictEqual(body.writeOccurred, true);

    const merged = blobStores['opportunity-intel'].latest.records;
    assert.strictEqual(merged['bye player|WR']._rawGames.length, 1, 'bye-week player keeps exactly their prior single game, untouched');
    assert.ok(merged['other player|RB'], 'the newly-appearing player this week is also present');
    uninstallFetchMock();
  });

  await testAsync('scheduled mode: box-score fetch failure blocks the write entirely, latest untouched', async () => {
    resetStores();
    installFetchMock();
    const derivedSeason = refreshModule.deriveCurrentSeason(new Date());
    const originalLatest = { season: derivedSeason, records: { 'safe player|RB': { _rawGames: [{ week: 1, gameID: 'gS1' }] } } };
    blobStores['opportunity-intel'] = { latest: JSON.parse(JSON.stringify(originalLatest)) };

    fetchScenario = {
      gamesByWeek: { '2': [makeGameEntry('gOK', 2), makeGameEntry('gFAIL', 2)] },
      boxScoresByGameID: { gOK: { p1: makeStatLine('p1', 'OK Player', 10, 1) }, gFAIL: 'FAIL' },
    };
    seedPlayerData({ p1: { pos: 'RB' } });

    const res = await refreshModule.handler({ queryStringParameters: {} });
    const body = JSON.parse(res.body);
    assert.strictEqual(body.writeOccurred, false);
    assert.ok(body.writeBlockedReason.includes('fetch failure'));
    assert.strictEqual(body.gamesFailed, 1);

    assert.deepStrictEqual(blobStores['opportunity-intel'].latest, originalLatest, 'latest must be byte-for-byte untouched when a write is blocked');
    uninstallFetchMock();
  });

  await testAsync('scheduled mode: a normalization failure also blocks the write (no percentage threshold -- ANY failure blocks)', async () => {
    resetStores();
    installFetchMock();
    const derivedSeason = refreshModule.deriveCurrentSeason(new Date());
    blobStores['opportunity-intel'] = { latest: { season: derivedSeason, records: {} } };

    fetchScenario = {
      gamesByWeek: { '1': [makeGameEntry('g1', 1)] },
      boxScoresByGameID: {
        g1: {
          p1: { playerID: 'p1', longName: 'Bad Data Player', Rushing: { carries: 'NOT_A_NUMBER' } },
        },
      },
    };
    seedPlayerData({ p1: { pos: 'RB' } });

    const res = await refreshModule.handler({ queryStringParameters: {} });
    const body = JSON.parse(res.body);
    assert.strictEqual(body.writeOccurred, false);
    assert.ok(body.writeBlockedReason.includes('normalization failure'));
    uninstallFetchMock();
  });

  await testAsync('scheduled mode: derived next week beyond 18 -> clean no-op, no write attempted at all', async () => {
    resetStores();
    installFetchMock();
    const derivedSeason = refreshModule.deriveCurrentSeason(new Date());
    blobStores['opportunity-intel'] = {
      latest: { season: derivedSeason, records: { 'p|RB': { _rawGames: [{ week: 18 }] } } },
    };
    fetchScenario = { gamesByWeek: {}, boxScoresByGameID: {} }; // should never even be consulted

    const res = await refreshModule.handler({ queryStringParameters: {} });
    const body = JSON.parse(res.body);
    assert.strictEqual(body.noOp, true);
    assert.strictEqual(body.targetWeek, 19);
    assert.strictEqual(body.writeOccurred, false);
    assert.ok(body.noOpReason.toLowerCase().includes('beyond the regular season'));
    assert.strictEqual(lastSetJSONCalls.length, 0, 'no write of any kind should be attempted');
    uninstallFetchMock();
  });

  await testAsync('scheduled mode: no completed games yet for the target week -> clean no-op, no write', async () => {
    resetStores();
    installFetchMock();
    const derivedSeason = refreshModule.deriveCurrentSeason(new Date());
    blobStores['opportunity-intel'] = { latest: { season: derivedSeason, records: {} } };
    fetchScenario = { gamesByWeek: { '1': [] }, boxScoresByGameID: {} };

    const res = await refreshModule.handler({ queryStringParameters: {} });
    const body = JSON.parse(res.body);
    assert.strictEqual(body.noOp, true);
    assert.strictEqual(body.writeOccurred, false);
    assert.ok(body.noOpReason.toLowerCase().includes('no completed games'));
    uninstallFetchMock();
  });

  await testAsync('scheduled mode: season rollover starts fresh at week 1 and does NOT apply a size-comparison gate', async () => {
    resetStores();
    installFetchMock();
    // Existing cache is a full "prior season" with many players/weeks --
    // deliberately much larger than what week 1 of a new season could
    // ever look like, to prove no size-comparison gate blocks this.
    const priorSeasonRecords = {};
    for (let i = 0; i < 50; i++) {
      priorSeasonRecords['player' + i + '|RB'] = { _rawGames: Array.from({ length: 17 }, (_, w) => ({ week: w + 1, gameID: 'g' + i + '_' + w })) };
    }
    blobStores['opportunity-intel'] = { latest: { season: '2025', records: priorSeasonRecords } };

    fetchScenario = {
      gamesByWeek: { '1': [makeGameEntry('g1', 1)] },
      boxScoresByGameID: { g1: { pNew: makeStatLine('pNew', 'New Season Player', 5, 1) } },
    };
    seedPlayerData({ pNew: { pos: 'RB' } });

    const res = await refreshModule.handler({ queryStringParameters: {} });
    const body = JSON.parse(res.body);
    assert.strictEqual(body.seasonRollover, true);
    assert.strictEqual(body.targetWeek, 1);
    assert.strictEqual(body.writeOccurred, true, 'must NOT be blocked just because the new season looks much smaller than the old one');
    assert.strictEqual(body.playersRecordedTotal, 1);

    // Prior season preserved under its own explicit key, untouched.
    assert.deepStrictEqual(
      blobStores['opportunity-intel']['season:2025:final'].records,
      priorSeasonRecords,
      'the completed prior season must be preserved under season:2025:final'
    );
    uninstallFetchMock();
  });

  await testAsync('scheduled mode: player-data cache read failure is non-fatal (matches manual mode behavior)', async () => {
    resetStores();
    installFetchMock();
    const derivedSeason = refreshModule.deriveCurrentSeason(new Date());
    blobStores['opportunity-intel'] = { latest: { season: derivedSeason, records: {} } };
    // Deliberately do NOT seed player-data -- getStore('player-data').get() will return null.
    fetchScenario = {
      gamesByWeek: { '1': [makeGameEntry('g1', 1)] },
      boxScoresByGameID: { g1: { p1: makeStatLine('p1', 'Unmatched Player', 5, 1) } },
    };

    const res = await refreshModule.handler({ queryStringParameters: {} });
    const body = JSON.parse(res.body);
    assert.strictEqual(body.writeOccurred, true, 'a missing player-data cache should not crash the run');
    assert.strictEqual(body.playersRecordedTotal, 0, 'with no position lookup, the player is excluded, not fabricated');
    uninstallFetchMock();
  });
}

runHandlerTests().then(() => {
  console.log('\n' + passed + ' passed, ' + failed + ' failed (' + (passed + failed) + ' total)');
  if (failed) {
    console.log('\nFAILURES:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exitCode = 1;
  }
});
