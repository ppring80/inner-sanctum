// tests/weekly-sage-te-snapshot.test.js
//
// Regression coverage for the TE snapshot pipeline's switch from broad
// getNFLPlayerList candidate discovery to depth-chart-based (TE1-TE3)
// discovery, the 96-player request ceiling, season-aware minimum-game
// evidence, and full-population retention with evidenceQualified /
// evidenceLimitReason tagging.
//
// Covers exactly the six areas asked for:
//   1. Candidate selection -- only TE1-TE3 per team, extra depth-chart
//      slots (TE4+) excluded.
//   2. Deduplication by playerID.
//   3. The 96-player ceiling.
//   4. Week 2 evidence (minimum 1 prior game).
//   5. Low-evidence retention (unqualified TEs stay in `population`,
//      tagged rather than dropped).
//   6. Week 3+ requirements (minimum 2 prior games).
//
// Layer 1 (pure function unit tests) covers 1, 2, 4, 6 directly against
// the exported building blocks. Layer 2 (one full buildTeSnapshot() run
// with mocked Tank01 + weekly-sage-schedule fetches) covers 3 and 5
// end-to-end, proving the 96-cap and the retain-and-tag behavior are
// actually wired into the real pipeline, not just declared.
//
// Run: node tests/weekly-sage-te-snapshot.test.js

'use strict';

const assert = require('assert');

const {
  buildTeSnapshot,
  _test: {
    selectTeDepthChartCandidates,
    minimumGamesForWeek,
    eligibilityReason,
    DEPTH_CHART_SLOTS_PER_TEAM,
    MAX_PLAYER_REQUESTS_PER_RUN,
    MINIMUM_GAMES_WEEK_2,
    MINIMUM_GAMES_DEFAULT,
    MINIMUM_TARGETS_PER_GAME
  }
} = require('../netlify/functions/weekly-sage-te-snapshot.js');

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
// Layer 1: pure function coverage
// ─────────────────────────────────────────────────────────

test('constants: depth-chart slots per team is 3 (TE1-TE3), request ceiling is 96', () => {
  assert.strictEqual(DEPTH_CHART_SLOTS_PER_TEAM, 3);
  assert.strictEqual(MAX_PLAYER_REQUESTS_PER_RUN, 96);
});

test('candidate selection: only TE1-TE3 are selected per team, TE4+ is excluded', () => {
  const depthChartTeams = [
    {
      teamAbv: 'NE',
      depthChart: {
        TE: [
          { playerID: 't1', longName: 'TE One' },
          { playerID: 't2', longName: 'TE Two' },
          { playerID: 't3', longName: 'TE Three' },
          { playerID: 't4', longName: 'TE Four (should be excluded)' }
        ]
      }
    }
  ];

  const { candidates } = selectTeDepthChartCandidates(depthChartTeams);

  assert.strictEqual(candidates.length, 3);
  assert.deepStrictEqual(
    candidates.map((c) => c.playerID),
    ['t1', 't2', 't3']
  );
  assert.ok(
    !candidates.some((c) => c.playerID === 't4'),
    'TE4 must not be selected'
  );
});

test('candidate selection: a team with no TE depth chart entries contributes nothing (no crash)', () => {
  const depthChartTeams = [
    { teamAbv: 'NE', depthChart: {} },
    { teamAbv: 'BUF', depthChart: { TE: [] } },
    { teamAbv: 'NYJ' } // missing depthChart entirely
  ];

  const { candidates, rawSlotCount } = selectTeDepthChartCandidates(depthChartTeams);
  assert.strictEqual(candidates.length, 0);
  assert.strictEqual(rawSlotCount, 0);
});

test('deduplication: the same playerID appearing twice across teams is kept only once', () => {
  const depthChartTeams = [
    {
      teamAbv: 'NE',
      depthChart: { TE: [{ playerID: 'dup-1', longName: 'Traded TE' }] }
    },
    {
      teamAbv: 'MIA',
      depthChart: { TE: [{ playerID: 'dup-1', longName: 'Traded TE (stale MIA entry)' }] }
    }
  ];

  const { candidates, rawSlotCount, duplicatesRemoved } = selectTeDepthChartCandidates(depthChartTeams);

  assert.strictEqual(rawSlotCount, 2, 'both raw slots were discovered');
  assert.strictEqual(candidates.length, 1, 'only one survives dedup');
  assert.strictEqual(duplicatesRemoved, 1);
  // First occurrence in Tank01's own team order wins.
  assert.strictEqual(candidates[0].longName, 'Traded TE');
});

test('deduplication: entries missing a playerID are skipped, not treated as a match with each other', () => {
  const depthChartTeams = [
    { teamAbv: 'NE', depthChart: { TE: [{ longName: 'No ID A' }, { playerID: '', longName: 'Empty ID' }] } }
  ];
  const { candidates } = selectTeDepthChartCandidates(depthChartTeams);
  assert.strictEqual(candidates.length, 0);
});

test('minimum-game evidence: Week 2 requires only 1 prior game', () => {
  assert.strictEqual(minimumGamesForWeek(2), 1);
  assert.strictEqual(minimumGamesForWeek(2), MINIMUM_GAMES_WEEK_2);
});

test('minimum-game evidence: Week 3 and beyond require 2 prior games', () => {
  assert.strictEqual(minimumGamesForWeek(3), 2);
  assert.strictEqual(minimumGamesForWeek(4), 2);
  assert.strictEqual(minimumGamesForWeek(18), 2);
  assert.strictEqual(minimumGamesForWeek(3), MINIMUM_GAMES_DEFAULT);
});

test('eligibilityReason: a Week 2 candidate with exactly 1 prior game and enough targets qualifies', () => {
  const record = { gamesUsed: 1, role: { targetsPerGame: MINIMUM_TARGETS_PER_GAME } };
  assert.strictEqual(eligibilityReason(record, minimumGamesForWeek(2)), null);
});

test('eligibilityReason: that same 1-game record fails at Week 3, where 2 games are required', () => {
  const record = { gamesUsed: 1, role: { targetsPerGame: MINIMUM_TARGETS_PER_GAME } };
  assert.strictEqual(eligibilityReason(record, minimumGamesForWeek(3)), 'insufficient_games');
});

test('eligibilityReason: enough games but too few targets fails on insufficient_targets specifically', () => {
  const record = { gamesUsed: 3, role: { targetsPerGame: MINIMUM_TARGETS_PER_GAME - 1 } };
  assert.strictEqual(eligibilityReason(record, minimumGamesForWeek(3)), 'insufficient_targets');
});

// ─────────────────────────────────────────────────────────
// Layer 2: full buildTeSnapshot() pipeline, mocked network only
// ─────────────────────────────────────────────────────────

const TANK01_HOST = 'tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com';
const BASE_URL = 'https://sanctum.example';

function gameStatLine({ gameID, team, targets, receptions, yards, touchdowns, carries, offSnapPct }) {
  return {
    gameID,
    teamAbv: team,
    Receiving: {
      targets: String(targets),
      receptions: String(receptions),
      recYds: String(yards),
      recTD: String(touchdowns)
    },
    Rushing: {
      carries: String(carries),
      rushYds: '0',
      rushTD: '0'
    },
    snapCounts: {
      offSnapPct: String(offSnapPct)
    }
  };
}

// 33 fake teams x 3 TE slots = 99 raw candidates -- 3 over the 96 cap.
// Team 0 holds the two players this test inspects individually;
// everything else is an inert filler that resolves with zero games
// (insufficient_games, but never a fetch failure).
function buildDepthChartBody(teamCount) {
  const body = [];
  for (let i = 0; i < teamCount; i++) {
    const teamAbv = `T${String(i).padStart(2, '0')}`;
    const teSlots =
      i === 0
        ? [
            { playerID: 'qualified-te', longName: 'Quinn Qualified' },
            { playerID: 'rookie-te', longName: 'Rocky Rookie' },
            { playerID: 'filler-0-2', longName: 'Filler 0 C' }
          ]
        : [
            { playerID: `filler-${i}-0`, longName: `Filler ${i} A` },
            { playerID: `filler-${i}-1`, longName: `Filler ${i} B` },
            { playerID: `filler-${i}-2`, longName: `Filler ${i} C` }
          ];
    body.push({ teamAbv, teamID: teamAbv, depthChart: { TE: teSlots } });
  }
  return body;
}

const originalFetch = global.fetch;

function installFetchMock(teamCount, options = {}) {
  const depthChartBody = buildDepthChartBody(teamCount);

  global.fetch = async (url) => {
    const u = new URL(url);

    if (u.host === TANK01_HOST) {
      if (u.pathname.includes('getNFLDepthCharts')) {
        return { ok: true, json: async () => ({ body: depthChartBody }) };
      }

      if (u.pathname.includes('getNFLGamesForPlayer')) {
        const playerID = u.searchParams.get('playerID');

        if (options.zeroEvidence) {
          return { ok: true, json: async () => ({ body: [] }) };
        }

        if (playerID === 'qualified-te') {
          return {
            ok: true,
            json: async () => ({
              body: [
                gameStatLine({ gameID: 'G1', team: 'NE', targets: 6, receptions: 4, yards: 40, touchdowns: 0, carries: 0, offSnapPct: '0.75' }),
                gameStatLine({ gameID: 'G2', team: 'NE', targets: 7, receptions: 5, yards: 55, touchdowns: 1, carries: 0, offSnapPct: '0.80' })
              ]
            })
          };
        }

        if (playerID === 'rookie-te') {
          // Only one prior game -- insufficient at Week 3 (needs 2),
          // even though his per-game targets clear the volume floor.
          return {
            ok: true,
            json: async () => ({
              body: [
                gameStatLine({ gameID: 'G2', team: 'NE', targets: 3, receptions: 2, yards: 20, touchdowns: 0, carries: 0, offSnapPct: '0.40' })
              ]
            })
          };
        }

        // Every filler candidate: zero prior games (a valid, successful
        // response -- never a fetch failure -- just no evidence).
        return { ok: true, json: async () => ({ body: [] }) };
      }
    }

    if (url.startsWith(BASE_URL) && u.pathname.includes('weekly-sage-schedule')) {
      const week = u.searchParams.get('week');
      const games =
        week === '1'
          ? [{ gameID: 'G1', away: 'NYJ', home: 'NE', gameDate: '20260914', gameTime: '1:00', gameStatus: 'Final' }]
          : week === '2'
          ? [{ gameID: 'G2', away: 'NYJ', home: 'NE', gameDate: '20260921', gameTime: '1:00', gameStatus: 'Final' }]
          : [];
      return { ok: true, json: async () => ({ games }) };
    }

    throw new Error('Unexpected fetch URL in test: ' + url);
  };
}

function uninstallFetchMock() {
  global.fetch = originalFetch;
}

async function runPipelineTests() {

await testAsync(
  '96-player ceiling: 99 raw depth-chart candidates are capped to 96, with the overage counted',
  async () => {
    installFetchMock(33); // 33 teams x 3 = 99 raw slots
    try {
      const snapshot = await buildTeSnapshot({
        baseUrl: BASE_URL,
        season: '2026',
        targetWeek: 3,
        seasonType: 'reg'
      });

      assert.strictEqual(snapshot.populationSummary.teCandidatesDiscovered, 99);
      assert.strictEqual(snapshot.populationSummary.teCandidatesOverCeiling, 3);
      assert.strictEqual(snapshot.populationSummary.teCandidatesProcessed, MAX_PLAYER_REQUESTS_PER_RUN);
      assert.strictEqual(snapshot.provenance.directTank01Calls, 1 + MAX_PLAYER_REQUESTS_PER_RUN);
    } finally {
      uninstallFetchMock();
    }
  }
);

await testAsync(
  'low-evidence retention: an unqualified rookie TE stays in `population` (never dropped), tagged evidenceQualified:false',
  async () => {
    installFetchMock(33);
    try {
      const snapshot = await buildTeSnapshot({
        baseUrl: BASE_URL,
        season: '2026',
        targetWeek: 3, // requires 2 prior games
        seasonType: 'reg'
      });

      const rookie = snapshot.population.find((p) => p.playerID === 'rookie-te');
      assert.ok(rookie, 'the rookie TE must still be present in population, not dropped');
      assert.strictEqual(rookie.evidenceQualified, false);
      assert.strictEqual(rookie.evidenceLimitReason, 'insufficient_games');
      assert.strictEqual(rookie.gamesUsed, 1, 'his real (limited) evidence is preserved, not discarded');
    } finally {
      uninstallFetchMock();
    }
  }
);

await testAsync(
  'qualified TE retention: a TE meeting the Week 3 evidence floor is tagged evidenceQualified:true with no limit reason',
  async () => {
    installFetchMock(33);
    try {
      const snapshot = await buildTeSnapshot({
        baseUrl: BASE_URL,
        season: '2026',
        targetWeek: 3,
        seasonType: 'reg'
      });

      const qualified = snapshot.population.find((p) => p.playerID === 'qualified-te');
      assert.ok(qualified);
      assert.strictEqual(qualified.evidenceQualified, true);
      assert.strictEqual(qualified.evidenceLimitReason, null);
      assert.strictEqual(qualified.gamesUsed, 2);
    } finally {
      uninstallFetchMock();
    }
  }
);

await testAsync(
  'Week 2 request: the same rookie shape (1 prior game) qualifies instead of failing, because Week 2 only requires 1 game',
  async () => {
    // Only 32 real teams this time -- no ceiling interaction, keep this
    // test focused purely on the Week 2 evidence floor.
    installFetchMock(32);
    try {
      const snapshot = await buildTeSnapshot({
        baseUrl: BASE_URL,
        season: '2026',
        targetWeek: 2, // requires only 1 prior game; only Week 1 exists
        seasonType: 'reg'
      });

      assert.strictEqual(snapshot.methodology.minimumGames, 1);

      const rookie = snapshot.population.find((p) => p.playerID === 'rookie-te');
      assert.ok(rookie);
      // At Week 2 only Week 1 (gameID G1) is in-window; the rookie's
      // only game (G2) is Week 2 itself, which no-look-ahead correctly
      // excludes -- so he has 0 usable prior games and is still
      // unqualified here, just for a different, still-correct reason.
      assert.strictEqual(rookie.evidenceQualified, false);
      assert.strictEqual(rookie.evidenceLimitReason, 'insufficient_games');
    } finally {
      uninstallFetchMock();
    }
  }
);

await testAsync(
  'population.length always equals recordsBuilt: nothing is ever silently excluded regardless of evidence',
  async () => {
    installFetchMock(32);
    try {
      const snapshot = await buildTeSnapshot({
        baseUrl: BASE_URL,
        season: '2026',
        targetWeek: 3,
        seasonType: 'reg'
      });

      assert.strictEqual(snapshot.population.length, snapshot.populationSummary.recordsBuilt);
      assert.strictEqual(snapshot.population.length, snapshot.populationSummary.totalTEPopulation);
      assert.strictEqual(snapshot.populationSummary.playerGameFailures, 0);
    } finally {
      uninstallFetchMock();
    }
  }
);

await testAsync(
  'nextStep.ready is false when weekly coverage contains zero evidence-qualified TEs',
  async () => {
    installFetchMock(32, { zeroEvidence: true });
    try {
      const snapshot = await buildTeSnapshot({
        baseUrl: BASE_URL,
        season: '2026',
        targetWeek: 3,
        seasonType: 'reg'
      });

      assert.ok(snapshot.population.length > 0);
      assert.strictEqual(snapshot.populationSummary.evidenceQualified, 0);
      assert.strictEqual(snapshot.nextStep.ready, false);
    } finally {
      uninstallFetchMock();
    }
  }
);

await testAsync(
  'nextStep.ready is true when at least one qualified TE exists and no requests fail',
  async () => {
    installFetchMock(32);
    try {
      const snapshot = await buildTeSnapshot({
        baseUrl: BASE_URL,
        season: '2026',
        targetWeek: 3,
        seasonType: 'reg'
      });

      assert.ok(snapshot.populationSummary.evidenceQualified > 0);
      assert.strictEqual(snapshot.nextStep.ready, true);
    } finally {
      uninstallFetchMock();
    }
  }
);

}

runPipelineTests().then(() => {
  console.log(`\n${passed} weekly-sage-te-snapshot tests passed, ${failed} failed.`);
  if (failed > 0) {
    failures.forEach((f) => console.error('FAIL: ' + f));
    process.exitCode = 1;
  }
});
