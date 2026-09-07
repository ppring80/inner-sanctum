'use strict';

const assert = require('assert');
const {
  _test: {
    normalizeName,
    normalizeTeam,
    normalizePosition,
    findIdentityMatch,
    flattenWeeklyRankings,
    buildTrendRows,
    extractSageEvidence,
    compareCandidateToRoster,
    isProviderAvailableStatus,
    resolveConnectionInput,
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

// Mirrors the real Weeks 2-18 leaderboard record shape produced by the
// positional Weekly SAGE leaderboard files: nested sage.score / label /
// confidence / confidenceLabel, with recommendation at the row level.
const weeklyData = {
  positions: {
    QB: [
      {
        playerID: 'qb-1',
        name: 'Lamar Jackson',
        team: 'BAL',
        position: 'QB',
        opponent: 'BUF',
        sage: {
          score: 92,
          label: 'ELITE',
          confidence: 0.89,
          confidenceLabel: 'High'
        },
        recommendation: 'START'
      }
    ],
    RB: [
      {
        playerID: 'rb-1',
        name: 'Bijan Robinson',
        team: 'ATL',
        position: 'RB',
        sage: {
          score: 96,
          label: 'ELITE',
          confidence: 0.91,
          confidenceLabel: 'High'
        },
        recommendation: 'START'
      },
      {
        playerID: 'rb-2',
        name: 'Example Runner',
        team: 'CAR',
        position: 'RB',
        sage: {
          score: 61,
          label: 'VIABLE',
          confidence: 0.63,
          confidenceLabel: 'Medium'
        },
        recommendation: 'FLEX'
      }
    ],
    WR: [
      {
        playerID: 'wr-1',
        name: 'Amon-Ra St. Brown',
        team: 'DET',
        position: 'WR',
        sage: {
          score: 94,
          label: 'ELITE',
          confidence: 0.9,
          confidenceLabel: 'High'
        },
        recommendation: 'START'
      },
      {
        playerID: 'wr-2',
        name: 'Available Receiver',
        team: 'GB',
        position: 'WR',
        opponent: 'CHI',
        sageTake: 'Strong weekly role with favorable supporting evidence.',
        sage: {
          score: 82,
          label: 'STARTABLE',
          confidence: 0.81,
          confidenceLabel: 'High'
        },
        recommendation: 'START'
      },
      {
        playerID: 'wr-3',
        name: 'Roster Receiver',
        team: 'NYJ',
        position: 'WR',
        sage: {
          score: 67,
          label: 'FLEX',
          confidence: 0.68,
          confidenceLabel: 'Medium'
        },
        recommendation: 'FLEX'
      }
    ],
    TE: [],
    K: [],
    DEF: []
  }
};

const trendData = {
  risers: [
    {
      playerID: 'tank-wr-2',
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
        offSnapPct: 0.8
      }
    }
  ],
  fallers: [
    {
      playerID: 'tank-rb-2',
      longName: 'Example Runner',
      team: 'CAR',
      pos: 'RB',
      targetShareDelta: -0.11,
      snapShareDelta: -0.04,
      current: {
        targets: 3,
        targetSharePct: 0.1,
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

test('normalizes provider team and defense aliases', () => {
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
});

test('team conflict rejects a same-name match', () => {
  const result = findIdentityMatch(
    { name: 'Same Name', nflTeam: 'DET', position: 'WR' },
    [{ name: 'Same Name', team: 'GB', position: 'WR' }]
  );

  assert.strictEqual(result.match, null);
  assert.strictEqual(result.reason, 'team_mismatch');
});

test('position conflict rejects a same-name match', () => {
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

test('Weekly SAGE ordering becomes position rank without cross-position ranking', () => {
  const rows = flattenWeeklyRankings(weeklyData);
  const available = rows.find((row) => row.name === 'Available Receiver');
  const roster = rows.find((row) => row.name === 'Roster Receiver');

  assert.strictEqual(available._sagePositionRank, 2);
  assert.strictEqual(roster._sagePositionRank, 3);
});

test('production nested Weekly SAGE fields are extracted correctly', () => {
  const rows = flattenWeeklyRankings(weeklyData);
  const row = rows.find((item) => item.name === 'Available Receiver');
  const sage = extractSageEvidence(row);

  assert.strictEqual(sage.position, 'WR');
  assert.strictEqual(sage.positionRank, 2);
  assert.strictEqual(sage.sageScore, 82);
  assert.strictEqual(sage.sageLabel, 'STARTABLE');
  assert.strictEqual(sage.recommendation, 'START');
  assert.strictEqual(sage.confidence, 0.81);
  assert.strictEqual(sage.confidenceLabel, 'High');
  assert.strictEqual(sage.opponent, 'CHI');
  assert.ok(sage.sageTake);
});

test('Week 1 baseline remains rankable without fabricating a SAGE score', () => {
  const row = {
    _sagePosition: 'WR',
    _sagePositionRank: 14,
    name: 'Week One Receiver',
    team: 'SEA',
    position: 'WR',
    positionRank: 14,
    rankingScore: 87,
    adp: 46.2,
    sageScore: null,
    baselineEvidenceType: 'week1-adp-baseline',
    recommendation: 'START'
  };

  const sage = extractSageEvidence(row);
  assert.strictEqual(sage.positionRank, 14);
  assert.strictEqual(sage.sageScore, null);
  assert.strictEqual(sage.rankingScore, 87);
  assert.strictEqual(sage.adp, 46.2);
  assert.strictEqual(sage.baselineEvidenceType, 'week1-adp-baseline');
});

test('Risers & Fallers rows retain direction and metrics', () => {
  const rows = buildTrendRows(trendData);
  const riser = rows.find((row) => row.longName === 'Available Receiver');
  assert.strictEqual(riser._trendDirection, 'RISER');
  assert.strictEqual(riser.targetShareDelta, 0.12);
});

test('only explicit provider availability statuses are accepted', () => {
  assert.strictEqual(isProviderAvailableStatus({ availabilityStatus: 'FREE_AGENT' }), true);
  assert.strictEqual(isProviderAvailableStatus({ availabilityStatus: 'FREEAGENT' }), true);
  assert.strictEqual(isProviderAvailableStatus({ availabilityStatus: 'WAIVERS' }), true);
  assert.strictEqual(isProviderAvailableStatus({ availabilityStatus: 'ROSTERED' }), false);
  assert.strictEqual(isProviderAvailableStatus({}), false);
});

test('ESPN connection shape feeds nested league.availablePlayers directly', () => {
  const resolved = resolveConnectionInput({
    provider: 'espn',
    week: 2,
    connection: {
      season: 2026,
      teamCount: 12,
      roster: [
        { name: 'Roster Receiver', nflTeam: 'NYJ', position: 'WR' }
      ],
      league: {
        season: 2026,
        availablePlayers: [
          {
            providerPlayerId: 'espn-101',
            name: 'Available Receiver',
            nflTeam: 'GB',
            position: 'WR',
            availabilityStatus: 'FREE_AGENT'
          }
        ],
        availabilityMeta: {
          available: true,
          count: 1,
          source: 'espn-kona_player_info'
        }
      }
    }
  });

  assert.strictEqual(resolved.provider, 'espn');
  assert.strictEqual(resolved.availablePlayers.length, 1);
  assert.strictEqual(resolved.availablePlayers[0].providerPlayerId, 'espn-101');
  assert.strictEqual(resolved.roster.length, 1);
  assert.strictEqual(resolved.availabilityMeta.source, 'espn-kona_player_info');
});

test('top-level availablePlayers still works for future providers', () => {
  const resolved = resolveConnectionInput({
    provider: 'cbs',
    season: 2026,
    week: 3,
    availablePlayers: [
      { name: 'Candidate', position: 'RB', availabilityStatus: 'WAIVERS' }
    ],
    roster: []
  });

  assert.strictEqual(resolved.availablePlayers.length, 1);
  assert.strictEqual(resolved.provider, 'cbs');
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
  assert.strictEqual(candidates[0].sage.sageScore, 82);
  assert.strictEqual(candidates[0].trend.direction, 'RISER');
  assert.strictEqual(candidates[0].rosterImpact.classification, 'UPGRADE');
  assert.strictEqual(candidates[0].rosterImpact.weakestComparable.name, 'Roster Receiver');
});

test('player absent from provider availability can never be emitted', () => {
  const candidates = enrichCandidates({
    availablePlayers: [],
    roster: [],
    weeklyData,
    risersFallersData: trendData
  });
  assert.deepStrictEqual(candidates, []);
});

test('provider player marked rostered is never emitted', () => {
  const candidates = enrichCandidates({
    availablePlayers: [
      {
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

test('missing SAGE data remains unmatched rather than fabricated', () => {
  const candidates = enrichCandidates({
    availablePlayers: [
      {
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

test('missing trend data does not block SAGE enrichment', () => {
  const candidates = enrichCandidates({
    availablePlayers: [
      {
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

test('candidate comparison reports downgrade when rank is worse', () => {
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
