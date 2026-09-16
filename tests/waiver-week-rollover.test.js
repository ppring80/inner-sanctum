'use strict';

const assert = require('assert');
const {
  _test: { weeklyFallbackWeeks, fetchWeeklyData }
} = require('../netlify/functions/waiver-candidates.js');

(async function run() {
  assert.deepStrictEqual(weeklyFallbackWeeks(1), [1]);
  assert.deepStrictEqual(weeklyFallbackWeeks(2), [2, 1]);
  assert.deepStrictEqual(weeklyFallbackWeeks(5), [5, 4, 1]);

  const originalFetch = global.fetch;
  const requested = [];
  global.fetch = async function (url) {
    requested.push(String(url));
    const week = Number(new URL(String(url)).searchParams.get('week'));
    if (week === 2) {
      return {
        ok: false,
        status: 502,
        json: async () => ({ error: 'No positional leaderboard could be produced for this week.' })
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        targetWeek: 1,
        positions: { QB: [{ name: 'Jared Goff' }] },
        metadata: { route: 'week1-adp-baseline' }
      })
    };
  };

  try {
    const result = await fetchWeeklyData(
      { headers: { host: 'example.test', 'x-forwarded-proto': 'https' } },
      2026,
      2,
      'ppr',
      10
    );

    assert.strictEqual(requested.length, 2);
    assert.match(requested[0], /week=2/);
    assert.match(requested[1], /week=1/);
    assert.strictEqual(result.targetWeek, 1);
    assert.strictEqual(result.metadata.requestedWeek, 2);
    assert.strictEqual(result.metadata.sourceWeek, 1);
    assert.strictEqual(result.metadata.fallbackUsed, true);
    assert.deepStrictEqual(result.metadata.fallbackAttempts, [{
      week: 2,
      error: 'No positional leaderboard could be produced for this week.'
    }]);

    requested.length = 0;
    global.fetch = async function (url) {
      requested.push(String(url));
      const week = Number(new URL(String(url)).searchParams.get('week'));
      return {
        ok: false,
        status: 502,
        json: async () => ({
          error: week === 2
            ? 'No positional leaderboard could be produced for this week.'
            : 'Week 1 rankings could not be produced.',
          detail: week === 1 ? 'ADP endpoint returned 500: Tank01 API error: 403' : undefined
        })
      };
    };

    const degraded = await fetchWeeklyData(
      { headers: { host: 'example.test', 'x-forwarded-proto': 'https' } },
      2026,
      2,
      'ppr',
      10
    );

    assert.strictEqual(requested.length, 2, 'requested week and Week 1 fallback are both attempted');
    assert.deepStrictEqual(degraded.positions, {});
    assert.strictEqual(degraded.metadata.degradedMode, true);
    assert.strictEqual(degraded.metadata.sourceWeek, null);
    assert.strictEqual(degraded.metadata.fallbackAttempts.length, 2);
    assert.match(degraded.metadata.fallbackAttempts[1].error, /Week 1 rankings/);
  } finally {
    global.fetch = originalFetch;
  }

  console.log('Free Agents week-rollover fallback regression test passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
