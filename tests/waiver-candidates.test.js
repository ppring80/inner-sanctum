'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  _test: {
    normalizeName,
    normalizeTeam,
    normalizePosition,
    findIdentityMatch,
    flattenWeeklyRankings,
    buildTeamOpponentMap,
    buildScheduleOpponentMap,
    buildTrendRows,
    buildOpportunityRows,
    extractSageEvidence,
    extractOpportunityEvidence,
    compareCandidateToRoster,
    deriveEspnLineupConstruction,
    deriveEspnScoringFormat,
    deriveEspnLineupFromRoster,
    isProviderAvailableStatus,
    resolveConnectionInput,
    enrichCandidates
  }
} = require('../netlify/functions/waiver-candidates.js');
const { buildWaiverDecisions } = require('../netlify/functions/waiver-decision.js');
const {
  _test: { buildCustomerRecommendations }
} = require('../netlify/functions/waiver-recommendations.js');

const waiverCandidatesSource = fs.readFileSync(
  path.join(__dirname, '..', 'netlify', 'functions', 'waiver-candidates.js'),
  'utf8'
);

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

const weekOneFallbackData = {
  positions: {
    QB: [], RB: [], TE: [], K: [], DEF: [],
    WR: [
      {
        name: 'Roster Receiver', team: 'NYJ', position: 'WR', adp: 35,
        sageScore: null, baselineEvidenceType: 'week1-adp-baseline',
        recommendation: 'START'
      },
      {
        name: 'Fallback Candidate', team: 'SF', position: 'WR', adp: 80,
        sageScore: null, baselineEvidenceType: 'week1-adp-baseline',
        recommendation: 'SIT'
      }
    ]
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

const opportunityData = {
  records: {
    'available receiver|WR': {
      playerID: 'tank-wr-2',
      longName: 'Available Receiver',
      team: 'GB',
      pos: 'WR',
      opportunities: { lastGame: 10, gamesSampled: 1 },
      rushing: { lastGame: 1 },
      receiving: { lastGame: 9 },
      signals: [
        { type: 'sampleSize', value: 'limited' },
        { type: 'volumeTier', value: 'high-volume', detail: { basisValue: 10 } }
      ]
    }
  }
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

test('Opportunity Intelligence supplies an honest one-game workload baseline', () => {
  const rows = buildOpportunityRows(opportunityData);
  const evidence = extractOpportunityEvidence(rows[0]);
  assert.strictEqual(evidence.volumeTier, 'high-volume');
  assert.strictEqual(evidence.lastGameOpportunities, 10);
  assert.strictEqual(evidence.lastGameCarries, 1);
  assert.strictEqual(evidence.lastGameTargets, 9);
  assert.strictEqual(evidence.gamesSampled, 1);
  assert.strictEqual(evidence.direction, null, 'one game must not fabricate a trend');
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

test('connection lineup construction is preserved for roster impact', () => {
  const resolved = resolveConnectionInput({
    provider: 'espn',
    week: 2,
    connection: {
      lineupConstruction: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2 },
      league: { availablePlayers: [] }
    }
  });

  assert.deepStrictEqual(resolved.lineupConstruction, {
    QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2
  });
  assert.strictEqual(resolved.lineupDiagnostics.source, 'saved-lineup-construction');
});

test('ESPN lineup construction is recovered from the top-level captured settings', () => {
  const resolved = resolveConnectionInput({
    provider: 'espn',
    week: 2,
    connection: {
      lineupConstruction: {},
      league: { availablePlayers: [] },
      settings: {
        rosterSettings: {
          lineupSlotCounts: { 0: 1, 2: 2, 4: 2, 6: 1, 23: 2, 17: 1, 16: 1, 20: 4 }
        }
      }
    }
  });

  assert.deepStrictEqual(resolved.lineupConstruction, {
    QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, SUPERFLEX: 0,
    K: 1, DEF: 1, BENCH: 4, IR: 0
  });
  assert.strictEqual(resolved.lineupDiagnostics.source, 'espn-settings');
  assert.strictEqual(resolved.lineupDiagnostics.settingsPresent, true);
  assert.deepStrictEqual(
    deriveEspnLineupConstruction({ rosterSettings: { lineupSlotCounts: {} } }),
    null
  );
});

test('real ESPN settings shape supplies scoring format and league size', () => {
  const resolved = resolveConnectionInput({
    connection: {
      provider: 'espn',
      league: { season: 2026, teamCount: 12, availablePlayers: [] },
      settings: {
        size: 12,
        scoringSettings: {
          scoringItems: [{ statId: 53, points: 0.5 }]
        }
      }
    }
  });

  assert.strictEqual(deriveEspnScoringFormat({
    scoringSettings: { scoringItems: [{ statId: 53, points: 0.5 }] }
  }), 'half-ppr');
  assert.strictEqual(resolved.scoring, 'half-ppr');
  assert.strictEqual(resolved.teams, 12);
});

test('older ESPN connections recover lineup construction from roster slot assignments', () => {
  const roster = [
    { name: 'QB One', position: 'QB', lineupSlotId: 0 },
    { name: 'RB One', position: 'RB', lineupSlotId: 2 },
    { name: 'RB Two', position: 'RB', lineupSlotId: 2 },
    { name: 'WR One', position: 'WR', lineupSlotId: 4 },
    { name: 'WR Two', position: 'WR', lineupSlotId: 4 },
    { name: 'TE One', position: 'TE', lineupSlotId: 6 },
    { name: 'Flex One', position: 'WR', lineupSlotId: 23 },
    { name: 'Flex Two', position: 'RB', lineupSlotId: 23 },
    { name: 'K One', position: 'K', lineupSlotId: 17 },
    { name: 'Defense One', position: 'DEF', lineupSlotId: 16 },
    { name: 'Bench One', position: 'WR', lineupSlotId: 20 }
  ];

  assert.deepStrictEqual(deriveEspnLineupFromRoster(roster), {
    QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, SUPERFLEX: 0,
    K: 1, DEF: 1, BENCH: 1, IR: 0
  });

  const resolved = resolveConnectionInput({
    provider: 'espn', week: 2,
    connection: { roster, lineupConstruction: null, league: { availablePlayers: [] } }
  });
  assert.strictEqual(resolved.lineupConstruction.FLEX, 2);
});

test('populated candidate responses expose lineup diagnostics in metadata', () => {
  const mainResponse = waiverCandidatesSource.match(
    /candidatesReturned: candidates\.length,[\s\S]*?methodology:/
  );
  assert.ok(mainResponse, 'main populated-candidates response metadata must exist');
  assert.ok(
    mainResponse[0].includes('lineupDiagnostics: input.lineupDiagnostics'),
    'main populated-candidates response must expose resolved lineup diagnostics'
  );
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

test('explicitly inactive provider players are removed while unknown activity is preserved', () => {
  const candidates = enrichCandidates({
    availablePlayers: [
      {
        name: 'Historical Quarterback', nflTeam: 'IND', position: 'QB',
        availabilityStatus: 'WAIVERS', active: false
      },
      {
        name: 'Unknown Receiver', nflTeam: 'SEA', position: 'WR',
        availabilityStatus: 'WAIVERS'
      }
    ],
    roster: [],
    weeklyData,
    risersFallersData: null
  });

  assert.deepStrictEqual(candidates.map((player) => player.name), ['Unknown Receiver']);
  assert.strictEqual(candidates[0].active, null);
});

test('unmatched player still receives matchup from team schedule evidence', () => {
  const candidates = enrichCandidates({
    availablePlayers: [
      {
        name: 'Unknown Baltimore Quarterback',
        nflTeam: 'BAL',
        position: 'QB',
        availabilityStatus: 'WAIVERS'
      }
    ],
    roster: [],
    weeklyData,
    risersFallersData: null
  });

  assert.strictEqual(buildTeamOpponentMap(flattenWeeklyRankings(weeklyData)).get('BAL'), 'BUF');
  assert.strictEqual(candidates[0].identity.sageMatched, false);
  assert.strictEqual(candidates[0].sage, null);
  assert.strictEqual(candidates[0].opponent, 'BUF');
});

test('canonical weekly schedule resolves matchup when SAGE rows have no opponent', () => {
  const scheduleData = {
    games: [{ away: 'SEA', home: 'SF' }],
    byeTeams: ['LAR']
  };
  const candidates = enrichCandidates({
    availablePlayers: [
      {
        name: 'Unknown Seattle Receiver',
        nflTeam: 'SEA',
        position: 'WR',
        availabilityStatus: 'WAIVERS'
      }
    ],
    roster: [],
    weeklyData: { positions: {} },
    risersFallersData: null,
    opportunityData: null,
    scheduleData
  });

  assert.strictEqual(buildScheduleOpponentMap(scheduleData).get('SEA'), 'SF');
  assert.strictEqual(buildScheduleOpponentMap(scheduleData).get('LAR'), 'BYE');
  assert.strictEqual(candidates[0].identity.sageMatched, false);
  assert.strictEqual(candidates[0].opponent, 'SF');
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

test('one-game opportunity baseline enriches a candidate without fabricating a riser', () => {
  const candidates = enrichCandidates({
    availablePlayers: [{
      name: 'Available Receiver', nflTeam: 'GB', position: 'WR',
      availabilityStatus: 'WAIVERS'
    }],
    roster: [],
    weeklyData,
    risersFallersData: null,
    opportunityData
  });

  assert.strictEqual(candidates[0].trend, null);
  assert.strictEqual(candidates[0].identity.opportunityMatched, true);
  assert.strictEqual(candidates[0].opportunity.volumeTier, 'high-volume');
  assert.strictEqual(candidates[0].opportunity.lastGameTargets, 9);
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

test('Week 1 fallback rank cannot veto a stronger current provider projection', () => {
  const candidates = enrichCandidates({
    availablePlayers: [{
      name: 'Fallback Candidate', nflTeam: 'SF', position: 'WR',
      availabilityStatus: 'WAIVERS', projectedPoints: 14
    }],
    roster: [{
      name: 'Roster Receiver', nflTeam: 'NYJ', position: 'WR',
      projectedPoints: 9
    }],
    lineupConstruction: { WR: 1 },
    weeklyData: weekOneFallbackData,
    risersFallersData: null
  });

  const impact = candidates[0].rosterImpact;
  assert.strictEqual(candidates[0].sage.positionRank, 2, 'fallback rank is intentionally worse');
  assert.strictEqual(impact.classification, 'UPGRADE');
  assert.strictEqual(impact.candidateStarts, true);
  assert.strictEqual(impact.displacedStarter.name, 'Roster Receiver');
  assert.strictEqual(impact.projectionDelta, 5);
  assert.strictEqual(impact.depthComparison.classification, 'UPGRADE');

  const decisions = buildWaiverDecisions(candidates);
  const recommendations = buildCustomerRecommendations(decisions, { teams: 10 });
  assert.strictEqual(decisions[0].decision.action, 'ADD');
  assert.strictEqual(recommendations[0].verdict, 'ADD_NOW');
  assert.ok(recommendations[0].faab, 'actionable fallback candidate receives FAAB guidance');
});

test('Week 1 fallback candidate remains behind when current projection is weaker', () => {
  const candidates = enrichCandidates({
    availablePlayers: [{
      name: 'Fallback Candidate', nflTeam: 'SF', position: 'WR',
      availabilityStatus: 'WAIVERS', projectedPoints: 8
    }],
    roster: [{
      name: 'Roster Receiver', nflTeam: 'NYJ', position: 'WR',
      projectedPoints: 9
    }],
    lineupConstruction: { WR: 1 },
    weeklyData: weekOneFallbackData,
    risersFallersData: null
  });

  const impact = candidates[0].rosterImpact;
  assert.strictEqual(impact.classification, 'SIMILAR');
  assert.strictEqual(impact.candidateStarts, false);
  assert.strictEqual(impact.depthComparison.classification, 'DOWNGRADE');

  const decisions = buildWaiverDecisions(candidates);
  const recommendations = buildCustomerRecommendations(decisions, { teams: 10 });
  assert.strictEqual(decisions[0].decision.action, 'PASS');
  assert.strictEqual(recommendations[0].verdict, 'PASS');
  assert.strictEqual(recommendations[0].faab, null);
});

test('Week 1 projection-backed bench upgrade becomes STASH with FAAB', () => {
  const candidates = enrichCandidates({
    availablePlayers: [{
      name: 'Fallback Candidate', nflTeam: 'SF', position: 'WR',
      availabilityStatus: 'WAIVERS', projectedPoints: 14
    }],
    roster: [
      { name: 'Elite Starter', nflTeam: 'DET', position: 'WR', projectedPoints: 18 },
      { name: 'Roster Receiver', nflTeam: 'NYJ', position: 'WR', projectedPoints: 9 }
    ],
    lineupConstruction: { WR: 1 },
    weeklyData: {
      positions: {
        ...weekOneFallbackData.positions,
        WR: [
          {
            name: 'Elite Starter', team: 'DET', position: 'WR', adp: 8,
            sageScore: null, baselineEvidenceType: 'week1-adp-baseline',
            recommendation: 'START'
          },
          ...weekOneFallbackData.positions.WR
        ]
      }
    },
    risersFallersData: null
  });

  assert.strictEqual(candidates[0].rosterImpact.candidateStarts, false);
  assert.strictEqual(candidates[0].rosterImpact.depthComparison.classification, 'UPGRADE');
  assert.strictEqual(
    candidates[0].rosterImpact.depthComparison.weakestComparable.projectedPoints,
    9
  );

  const decisions = buildWaiverDecisions(candidates);
  const recommendations = buildCustomerRecommendations(decisions, { teams: 10 });
  assert.strictEqual(decisions[0].decision.action, 'WATCH');
  assert.strictEqual(recommendations[0].verdict, 'STASH');
  assert.ok(recommendations[0].faab, 'projection-backed stash receives FAAB guidance');
});

test('lineup impact recognizes a receiver upgrading the FLEX slot', () => {
  const candidates = enrichCandidates({
    availablePlayers: [{
      name: 'Available Receiver', nflTeam: 'GB', position: 'WR',
      availabilityStatus: 'FREE_AGENT', projectedPoints: 14.5
    }],
    roster: [
      { name: 'Amon-Ra St. Brown', nflTeam: 'DET', position: 'WR', projectedPoints: 18 },
      { name: 'Roster Receiver', nflTeam: 'NYJ', position: 'WR', projectedPoints: 9 },
      { name: 'Example Runner', nflTeam: 'CAR', position: 'RB', projectedPoints: 10 }
    ],
    lineupConstruction: { WR: 1, FLEX: 1 },
    weeklyData,
    risersFallersData: trendData
  });

  const impact = candidates[0].rosterImpact;
  assert.strictEqual(impact.comparisonType, 'starting-lineup');
  assert.strictEqual(impact.classification, 'UPGRADE');
  assert.strictEqual(impact.candidateStarts, true);
  assert.strictEqual(impact.targetSlot, 'FLEX');
  assert.strictEqual(impact.displacedStarter.name, 'Roster Receiver');
  assert.strictEqual(impact.projectionDelta, 5.5);
});

test('lineup impact labels a candidate who remains on the bench as depth only', () => {
  const candidates = enrichCandidates({
    availablePlayers: [{
      name: 'Roster Receiver', nflTeam: 'NYJ', position: 'WR',
      availabilityStatus: 'WAIVERS'
    }],
    roster: [
      { name: 'Amon-Ra St. Brown', nflTeam: 'DET', position: 'WR' },
      { name: 'Available Receiver', nflTeam: 'GB', position: 'WR' }
    ],
    lineupConstruction: { WR: 1, FLEX: 1 },
    weeklyData,
    risersFallersData: null
  });

  assert.strictEqual(candidates[0].rosterImpact.comparisonType, 'starting-lineup');
  assert.strictEqual(candidates[0].rosterImpact.candidateStarts, false);
  assert.strictEqual(candidates[0].rosterImpact.reason, 'candidate_does_not_enter_starting_lineup');
});

console.log(`\n${passed} waiver-candidate tests passed.`);
