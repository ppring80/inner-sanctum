'use strict';

// tests/waiver-candidates.test.js
//
// Regression coverage for provider-neutral waiver candidate intelligence.
// Built-in Node only; no test framework dependency.

const assert = require('assert');
const {
  _test: {
    normalizeName,
    normalizeTeam,
    normalizePosition,
    findIdentityMatch,
    flattenWeeklyRankings,
    buildTrendRows,
    compareCandidateToRoster,
    isProviderAvailableStatus,
    enrichCandidates
  }
} = require('../netlify/functions/waiver-candidates.js');

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

const weeklyData = {
  positions: {
    QB: [
      {
        name: 'Lamar Jackson',
        team: 'BAL',
        position: 'QB',
        sageScore: 92,
        recommendation: 'START'
      }
    ],
    RB: [
      {
        name: 'Bijan Robinson',
        team: 'ATL',
        position: 'RB',
        sageScore: 96,
        recommendation: 'START'
      },
      {
        name: 'Example Runner',
        team: 'CAR',
        position: 'RB',
        sageScore: 61,
        recommendation: 'FLEX'
      }
    ],
    WR: [
      {
        name: 'Amon-Ra St. Brown',
        team: 'DET',
        position: 'WR',
        sageScore: 94,
        recommendation: 'START'
      },
      {
        name: 'Available Receiver',
        team: 'GB',
        position: 'WR',
        sageScore: 82,
        recommendation: 'START'
      },
      {
        name: 'Roster Receiver',
        team: 'NYJ',
        position: 'WR',
        sageScore: 67,
        recommendation: 'FLEX'
      }
    ],
    TE: [],
    K: [],
    DEF: [
      {
        name: 'Baltimore Ravens',
        team: 'BAL',
        position: 'DEF',
        sageScore: 80,
        recommendation: 'START'
      }
    ]
  }
};

const trendData = {
  risers: [
    {
      longName: 'Available Receiver',
      team: 'GB',
      pos: 'WR',
      targetShareDelta: 0.12,
      snapShareDelta: 0.08,
      current: {
        targets: 9,
        targetSharePct: 0.29,
        offSnapPct: 0.88
      },
      previous: {
        targets: 5,
        targetSharePct: 0.17,
        offSnapPct: 0.80
      }
    }
  ],
  fallers: [
    {
      longName: 'Example Runner',
      team: 'CAR',
      pos: 'RB',
      targetShareDelta: -0.11,
      snapShareDelta: -0.04,
      current: {
        targets: 3,
        targetSharePct: 0.10,
        offSnapPct: 0.52
      },
      previous: {
        targets: 7,
        targetSharePct: 0.21,
        offSnapPct: 0.56
      }
    }
  ]
};

test('normalizes punctuation, suffixes, and accents in player names', () => {
  assert.strictEqual(normalizeName('Amon-Ra St. Brown Jr.'), 'amonrastbrown');
  assert.strictEqual(normalizeName('José Núñez III'), 'josenunez');
});

test('normalizes provider team and defense-position aliases', () => {
  assert.strictEqual(normalizeTeam('JAC'), 'JAX');
  assert.strictEqual(normalizeTeam('WSH'), 'WAS');
  assert.strictEqual(normalizePosition('D/ST'), 'DEF');
  assert.strictEqual(normalizePosition('DST'), 'DEF');
});

test('exact compatible identity match succeeds', () => {
  const rows = flattenWeeklyRankings(weeklyData);
  const result = findIdentityMatch(
    { name: 'Available Receiver', nflTeam: 'GB', position: 'WR' },
    rows
  );

  assert.ok(result.match);
  assert.strictEqual(result.reason, null);
  assert.strictEqual(result.match.name, 'Available Receiver');
});

test('team conflict rejects a same-name match rather than guessing', () => {
  const result = findIdentityMatch(
    { name: 'Same Name', nflTeam: 'DET', position: 'WR' },
    [{ name: 'Same Name', team: 'GB', position: 'WR' }]
  );

  assert.strictEqual(result.match, null);
  assert.strictEqual(result.reason, 'team_mismatch');
});

test('position conflict rejects a same-name match rather than guessing', () => {
  const result = findIdentityMatch(
    { name: 'Same Name', nflTeam: 'DET', position: 'RB' },
    [{ name: 'Same Name', team: 'DET', position: 'WR' }]
  );

  assert.strictEqual(result.match, null);
  assert.strictEqual(result.reason, 'position_mismatch');
});

test('ambiguous compatible duplicate names are rejected', () => {
  const result = findIdentityMatch(
    { name: 'Duplicate Player', position: 'WR' },
    [
      { name: 'Duplicate Player', position: 'WR' },
      { name: 'Duplicate Player', position: 'WR' }
    ]
  );

  assert.strictEqual(result.match, null);
  assert.strictEqual(result.reason, 'ambiguous_name');
});

test('weekly rankings preserve per-position ordering as position rank', () => {
  const rows = flattenWeeklyRankings(weeklyData);
  const available = rows.find((row) => row.name === 'Available Receiver');
  const roster = rows.find((row) => row.name === 'Roster Receiver');

  assert.strictEqual(available._sagePositionRank, 2);
  assert.strictEqual(roster._sagePositionRank, 3);
});

test('Risers & Fallers rows retain direction without altering metrics', () => {
  const rows = buildTrendRows(trendData);
  const riser = rows.find((row) => row.longName === 'Available Receiver');
  const faller = rows.find((row) => row.longName === 'Example Runner');

  assert.strictEqual(riser._trendDirection, 'RISER');
  assert.strictEqual(riser.targetShareDelta, 0.12);
  assert.strictEqual(faller._trendDirection, 'FALLER');
});

test('only explicit provider free-agent or waiver statuses are accepted', () => {
  assert.strictEqual(isProviderAvailableStatus({ availabilityStatus: 'FREE_AGENT' }), true);
  assert.strictEqual(isProviderAvailableStatus({ availabilityStatus: 'FREEAGENT' }), true);
  assert.strictEqual(isProviderAvailableStatus({ availabilityStatus: 'WAIVERS' }), true);
  assert.strictEqual(isProviderAvailableStatus({ availabilityStatus: 'ROSTERED' }), false);
  assert.strictEqual(isProviderAvailableStatus({}), false);
});

test('available player is enriched with SAGE, trend, and roster upgrade evidence', () => {
  const candidates = enrichCandidates({
    availablePlayers: [
      {
        providerPlayerId: 'espn-101',
        name: 'Available Receiver',
        nflTeam: 'GB',
        position: 'WR',
        availabilityStatus: 'FREE_AGENT',
        percentOwned: 38.4
      }
    ],
    roster: [
      {
        name: 'Roster Receiver',
        nflTeam: 'NYJ',
        position: 'WR'
      }
    ],
    weeklyData,
    risersFallersData: trendData
  });

  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].identity.sageMatched, true);
  assert.strictEqual(candidates[0].sage.positionRank, 2);
  assert.strictEqual(candidates[0].trend.direction, 'RISER');
  assert.strictEqual(candidates[0].rosterImpact.classification, 'UPGRADE');
  assert.strictEqual(candidates[0].rosterImpact.weakestComparable.name, 'Roster Receiver');
});

test('player absent from provider availablePlayers can never be emitted', () => {
  const candidates = enrichCandidates({
    availablePlayers: [],
    roster: [],
    weeklyData,
    risersFallersData: trendData
  });

  assert.deepStrictEqual(candidates, []);
});

test('provider player marked rostered is never emitted even if SAGE likes him', () => {
  const candidates = enrichCandidates({
    availablePlayers: [
      {
        providerPlayerId: 'espn-102',
        name: 'Amon-Ra St. Brown',
        nflTeam: 'DET',
        position: 'WR',
        availabilityStatus: 'ROSTERED'
      }
    ],
    roster: [],
    weeklyData,
    risersFallersData: trendData
  });

  assert.deepStrictEqual(candidates, []);
});

test('missing SAGE data remains unmatched instead of fabricating a score', () => {
  const candidates = enrichCandidates({
    availablePlayers: [
      {
        providerPlayerId: 'espn-103',
        name: 'Unknown Receiver',
        nflTeam: 'SEA',
        position: 'WR',
        availabilityStatus: 'WAIVERS'
      }
    ],
    roster: [],
    weeklyData,
    risersFallersData: trendData
  });

  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].identity.sageMatched, false);
  assert.strictEqual(candidates[0].sage, null);
  assert.strictEqual(candidates[0].rosterImpact.classification, 'UNKNOWN');
});

test('missing trend data does not block otherwise valid SAGE enrichment', () => {
  const candidates = enrichCandidates({
    availablePlayers: [
      {
        providerPlayerId: 'espn-104',
        name: 'Available Receiver',
        nflTeam: 'GB',
        position: 'WR',
        availabilityStatus: 'FREE_AGENT'
      }
    ],
    roster: [
      {
        name: 'Roster Receiver',
        nflTeam: 'NYJ',
        position: 'WR'
      }
    ],
    weeklyData,
    risersFallersData: null
  });

  assert.strictEqual(candidates.length, 1);
  assert.ok(candidates[0].sage);
  assert.strictEqual(candidates[0].trend, null);
  assert.strictEqual(candidates[0].rosterImpact.classification, 'UPGRADE');
});

test('candidate comparison reports downgrade when rank is worse than roster alternative', () => {
  const result = compareCandidateToRoster(
    { positionRank: 10 },
    [
      {
        player: { name: 'Better Player', position: 'WR', team: 'DET' },
        sage: { positionRank: 4 }
      }
    ]
  );

  assert.strictEqual(result.classification, 'DOWNGRADE');
});

console.log(`\n${passed} waiver-candidate tests passed.`);
