// tests/refresh-risers-fallers-scheduled.test.js
//
// Regression coverage for refresh-risers-fallers.js's scheduled-mode week
// derivation, covering the fix to getCurrentNFLWeek()'s season anchor.
//
// PRIOR DEFECT (now fixed): seasonStart was anchored to 2026-09-09, a
// Wednesday -- the same day this function's own cron fires every week.
// Every 7-day block boundary from a Wednesday anchor lands back on a
// Wednesday, so the calculator always advanced to the next week's number
// one full day before that week's real Thursday-night opener, and the
// Wednesday cron could never find completed games for the week it had
// just named. It would have aborted, unwritten, forever.
//
// THE FIX: seasonStart is now anchored to the season's real Thursday
// opener (2026-09-10). The week boundary now turns over on Thursday,
// matching the real NFL calendar, so the Wednesday cron always asks
// about a week that ended two days earlier -- exactly the intent of the
// original "every game in the week's slate ... is final by the time
// this runs" comment.
//
// This file proves, with the REAL exports.handler (mocked @netlify/blobs
// + global.fetch standing in for Tank01, same technique already proven
// in refresh-opportunity-intel-scheduled.test.js and
// redeem-giveaway-code.test.js -- not a reimplementation of the module's
// own logic):
//
//   1. getCurrentNFLWeek() resolves all four dates specified for this
//      fix: Wed 9/16 -> Week 1, Thu 9/17 -> Week 2, Wed 9/23 -> Week 2,
//      Thu 9/24 -> Week 3.
//   2. The Wednesday cron now behaves correctly across three consecutive
//      real firings:
//        - Sept 16: safely skips (only Week 1 exists -- no Week 0 to
//          compare against).
//        - Sept 23: compares completed Weeks 1->2, writes season 2026.
//        - Sept 30: compares completed Weeks 2->3, writes season 2026.
//   3. Fail-closed behavior survives the fix: incomplete games still
//      abort without touching the last valid cache, and a stale 2025
//      cache is never left in place once real 2026 data is available
//      (it is overwritten, not merged with or read alongside).
//
// Run: node tests/refresh-risers-fallers-scheduled.test.js

'use strict';

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
// Mock @netlify/blobs BEFORE the first require of the module under test.
// ─────────────────────────────────────────────────────────
const blobStores = {};
let lastSetJSONCalls = [];

function installBlobsMock() {
  const fakeModulePath = path.join(__dirname, '__fake_netlify_blobs_risers_fallers__.js');
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
const refreshModule = require('../netlify/functions/refresh-risers-fallers.js');
Module._resolveFilename = originalResolve;

function resetStores() {
  Object.keys(blobStores).forEach((k) => delete blobStores[k]);
  lastSetJSONCalls = [];
}

// ─────────────────────────────────────────────────────────
// Fetch mock -- stands in for getNFLGamesForWeek / getNFLBoxScore.
// ─────────────────────────────────────────────────────────
let fetchScenario = null;
const originalFetch = global.fetch;

function installFetchMock() {
  global.fetch = async (url) => {
    const u = new URL(url);
    if (u.pathname.includes('getNFLGamesForWeek')) {
      const week = u.searchParams.get('week');
      const games = (fetchScenario.gamesByWeek && fetchScenario.gamesByWeek[week]) || [];
      return { ok: true, json: async () => ({ body: games }) };
    }
    if (u.pathname.includes('getNFLBoxScore')) {
      const gameID = u.searchParams.get('gameID');
      const boxScore = (fetchScenario.boxScoresByGameID && fetchScenario.boxScoresByGameID[gameID]) || {};
      return { ok: true, json: async () => ({ body: { playerStats: boxScore } }) };
    }
    throw new Error('Unexpected fetch URL in test: ' + url);
  };
}
function uninstallFetchMock() {
  global.fetch = originalFetch;
}

function completedGame(gameID) {
  return { gameID, gameStatusCode: '2' };
}

function statLine(playerID, longName, team, gameID, targets) {
  return {
    [playerID]: {
      playerID,
      longName,
      teamAbv: team,
      teamID: team,
      gameID,
      Receiving: { targets: String(targets) },
      snapCounts: { offSnapPct: '0.5' }
    }
  };
}

// ─────────────────────────────────────────────────────────
// Date mocking -- getCurrentNFLWeek() calls `new Date()` internally
// with no injectable parameter, so the global constructor is swapped
// for the duration of each test needing a fixed "now".
// ─────────────────────────────────────────────────────────
const RealDate = Date;
function withMockedNow(isoString, fn) {
  global.Date = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        return new RealDate(isoString);
      }
      return new RealDate(...args);
    }
    static now() {
      return new RealDate(isoString).getTime();
    }
  };
  try {
    return fn();
  } finally {
    global.Date = RealDate;
  }
}

// ─────────────────────────────────────────────────────────
// 1. getCurrentNFLWeek() -- the four dates this fix was specified against
// ─────────────────────────────────────────────────────────

test('getCurrentNFLWeek: before season start returns Week 1', () => {
  withMockedNow('2026-09-01T12:00:00Z', () => {
    assert.strictEqual(refreshModule.getCurrentNFLWeek(), 1);
  });
});

test('getCurrentNFLWeek: Wednesday Sept 16 resolves to Week 1', () => {
  withMockedNow('2026-09-16T12:00:00Z', () => {
    assert.strictEqual(refreshModule.getCurrentNFLWeek(), 1);
  });
});

test('getCurrentNFLWeek: Thursday Sept 17 (Week 2\'s real kickoff) resolves to Week 2', () => {
  withMockedNow('2026-09-17T12:00:00Z', () => {
    assert.strictEqual(refreshModule.getCurrentNFLWeek(), 2);
  });
});

test('getCurrentNFLWeek: Wednesday Sept 23 resolves to Week 2', () => {
  withMockedNow('2026-09-23T12:00:00Z', () => {
    assert.strictEqual(refreshModule.getCurrentNFLWeek(), 2);
  });
});

test('getCurrentNFLWeek: Thursday Sept 24 (Week 3\'s real kickoff) resolves to Week 3', () => {
  withMockedNow('2026-09-24T12:00:00Z', () => {
    assert.strictEqual(refreshModule.getCurrentNFLWeek(), 3);
  });
});

test('getCurrentNFLWeek: Wednesday Sept 30 resolves to Week 3', () => {
  withMockedNow('2026-09-30T12:00:00Z', () => {
    assert.strictEqual(refreshModule.getCurrentNFLWeek(), 3);
  });
});

// ─────────────────────────────────────────────────────────
// 2. Three consecutive real Wednesday cron firings
// ─────────────────────────────────────────────────────────

async function runHandlerTests() {

await testAsync(
  'Wednesday Sept 16: safely skips -- only Week 1 exists, no Week 0 to compare against, stale 2025 cache untouched',
  async () => {
    resetStores();
    installFetchMock();
    // Stale season-2025 data already sitting in "latest", exactly as
    // confirmed in production -- this run must leave it alone.
    blobStores['risers-fallers'] = {
      latest: { season: 2025, currentWeek: 2, previousWeek: 1, risers: [], fallers: [] }
    };
    fetchScenario = { gamesByWeek: {}, boxScoresByGameID: {} };

    try {
      const result = await withMockedNow('2026-09-16T12:00:00Z', () =>
        refreshModule.handler({ queryStringParameters: null })
      );
      const body = JSON.parse(result.body);

      assert.strictEqual(body.skipped, true, 'Week 1 alone has no previous week to compare against');
      assert.strictEqual(lastSetJSONCalls.length, 0, 'no blob write of any kind should occur');
      assert.deepStrictEqual(
        blobStores['risers-fallers'].latest,
        { season: 2025, currentWeek: 2, previousWeek: 1, risers: [], fallers: [] },
        'the stale 2025 cache must be left completely untouched'
      );
    } finally {
      uninstallFetchMock();
    }
  }
);

await testAsync(
  'Wednesday Sept 23: compares completed Weeks 1->2 and writes season 2026, overwriting the stale 2025 cache',
  async () => {
    resetStores();
    installFetchMock();
    blobStores['risers-fallers'] = {
      latest: { season: 2025, currentWeek: 2, previousWeek: 1, risers: [], fallers: [] }
    };
    fetchScenario = {
      gamesByWeek: {
        '1': [completedGame('g1a')],
        '2': [completedGame('g2a')]
      },
      boxScoresByGameID: {
        g1a: statLine('p1', 'Steady Guy', 'GB', 'g1a', 4),
        g2a: statLine('p1', 'Steady Guy', 'GB', 'g2a', 9)
      }
    };

    try {
      const result = await withMockedNow('2026-09-23T12:00:00Z', () =>
        refreshModule.handler({ queryStringParameters: null })
      );
      const body = JSON.parse(result.body);

      assert.strictEqual(body.currentWeek, 2);
      assert.strictEqual(body.previousWeek, 1);
      assert.strictEqual(
        lastSetJSONCalls.some((c) => c.store === 'risers-fallers' && c.key === 'latest'),
        true,
        '"latest" must be overwritten now that real 2026 Week 1->2 data exists'
      );
      assert.strictEqual(blobStores['risers-fallers'].latest.season, '2026');
      assert.strictEqual(blobStores['risers-fallers'].latest.currentWeek, 2);
      assert.strictEqual(blobStores['risers-fallers'].latest.previousWeek, 1);
      assert.notStrictEqual(
        blobStores['risers-fallers'].latest.season,
        2025,
        'stale 2025 evidence must never remain reachable once 2026 data is written'
      );
    } finally {
      uninstallFetchMock();
    }
  }
);

await testAsync(
  'Wednesday Sept 30: compares completed Weeks 2->3 and writes season 2026',
  async () => {
    resetStores();
    installFetchMock();
    // Seed exactly what the previous Wednesday's successful run would
    // have left behind, to prove this keeps advancing correctly run
    // over run, not just on a freshly-reset store.
    blobStores['risers-fallers'] = {
      latest: { season: '2026', currentWeek: 2, previousWeek: 1, risers: [], fallers: [] }
    };
    fetchScenario = {
      gamesByWeek: {
        '2': [completedGame('g2a')],
        '3': [completedGame('g3a')]
      },
      boxScoresByGameID: {
        g2a: statLine('p1', 'Steady Guy', 'GB', 'g2a', 9),
        g3a: statLine('p1', 'Steady Guy', 'GB', 'g3a', 11)
      }
    };

    try {
      const result = await withMockedNow('2026-09-30T12:00:00Z', () =>
        refreshModule.handler({ queryStringParameters: null })
      );
      const body = JSON.parse(result.body);

      assert.strictEqual(body.currentWeek, 3);
      assert.strictEqual(body.previousWeek, 2);
      assert.strictEqual(blobStores['risers-fallers'].latest.season, '2026');
      assert.strictEqual(blobStores['risers-fallers'].latest.currentWeek, 3);
      assert.strictEqual(blobStores['risers-fallers'].latest.previousWeek, 2);
    } finally {
      uninstallFetchMock();
    }
  }
);

await testAsync(
  'fail-closed survives the fix: an incomplete week still aborts without touching the last valid 2026 cache',
  async () => {
    resetStores();
    installFetchMock();
    const lastValid = { season: '2026', currentWeek: 2, previousWeek: 1, risers: [], fallers: [] };
    blobStores['risers-fallers'] = { latest: { ...lastValid } };
    fetchScenario = {
      // Week 3's games are not all final yet this run (e.g. a late
      // international/holiday slate) -- simulate zero completed games.
      gamesByWeek: { '2': [completedGame('g2a')], '3': [] },
      boxScoresByGameID: {}
    };

    try {
      const result = await withMockedNow('2026-09-30T12:00:00Z', () =>
        refreshModule.handler({ queryStringParameters: null })
      );
      const body = JSON.parse(result.body);

      assert.strictEqual(body.skipped, true);
      assert.strictEqual(lastSetJSONCalls.length, 0, 'no write on an incomplete week');
      assert.deepStrictEqual(
        blobStores['risers-fallers'].latest,
        lastValid,
        'the last valid 2026 cache must remain exactly as it was'
      );
    } finally {
      uninstallFetchMock();
    }
  }
);

}

runHandlerTests().then(() => {
  console.log(`\n${passed} refresh-risers-fallers scheduled tests passed, ${failed} failed.`);
  if (failed > 0) {
    failures.forEach((f) => console.error('FAIL: ' + f));
    process.exitCode = 1;
  }
});
