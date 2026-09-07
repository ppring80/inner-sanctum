'use strict';

// netlify/functions/waiver-candidates.js
//
// PROVIDER-NEUTRAL WAIVER CANDIDATE INTELLIGENCE
// ------------------------------------------------
// PURPOSE
// Join a connected league's provider-reported available-player pool to
// intelligence Inner Sanctum already produces:
//
//   provider availability -> Weekly SAGE -> Risers & Fallers -> roster context
//
// This function DOES NOT:
// - create a new SAGE score
// - alter Weekly SAGE rankings or recommendations
// - invent player availability
// - submit adds/drops/waiver claims
// - calculate FAAB bids
// - guess through conflicting player identity evidence
//
// The provider's availablePlayers array is the gate. A player who is not
// present there can never appear as a waiver candidate from this service.
//
// MATCHING POLICY
// ----------------
// Provider player IDs are retained as metadata but are NOT treated as the
// universal Inner Sanctum player identity. V1 matching uses normalized name
// plus corroborating NFL team and position when those fields are available.
// Conflicting team/position evidence returns an unmatched candidate rather
// than silently joining the wrong player.

const { connectLambda, getStore } = require('@netlify/blobs');

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
  : ['https://theinnersanctum.xyz'];

const SUPPORTED_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

const CORS_BASE = {
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  Vary: 'Origin'
};

function isOriginAllowed(origin) {
  return !origin || ALLOWED_ORIGINS.includes(origin);
}

function corsHeaders(origin) {
  const headers = { ...CORS_BASE };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function jsonResponse(statusCode, body, origin) {
  return {
    statusCode,
    headers: corsHeaders(origin),
    body: JSON.stringify(body)
  };
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function normalizeTeam(value) {
  const team = String(value || '').trim().toUpperCase();
  const aliases = {
    JAC: 'JAX',
    WSH: 'WAS',
    WFT: 'WAS',
    LA: 'LAR'
  };
  return aliases[team] || team;
}

function normalizePosition(value) {
  const pos = String(value || '').trim().toUpperCase();
  if (['DST', 'D/ST', 'D-ST', 'DEFENSE'].includes(pos)) {
    return 'DEF';
  }
  return pos;
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstDefined() {
  for (let i = 0; i < arguments.length; i += 1) {
    if (arguments[i] !== undefined && arguments[i] !== null) {
      return arguments[i];
    }
  }
  return undefined;
}

function getPlayerName(player) {
  return firstDefined(player?.name, player?.longName, player?.fullName, player?.playerName) || '';
}

function getPlayerTeam(player) {
  return normalizeTeam(
    firstDefined(player?.team, player?.nflTeam, player?.teamAbv, player?.proTeam)
  );
}

function getPlayerPosition(player) {
  return normalizePosition(
    firstDefined(player?.position, player?.pos, player?.defaultPosition)
  );
}

function compatibleIdentity(candidate, evidence) {
  const candidateTeam = getPlayerTeam(candidate);
  const evidenceTeam = getPlayerTeam(evidence);
  const candidatePosition = getPlayerPosition(candidate);
  const evidencePosition = getPlayerPosition(evidence);

  if (candidateTeam && evidenceTeam && candidateTeam !== evidenceTeam) {
    return { ok: false, reason: 'team_mismatch' };
  }

  if (
    candidatePosition &&
    evidencePosition &&
    candidatePosition !== evidencePosition
  ) {
    return { ok: false, reason: 'position_mismatch' };
  }

  return { ok: true, reason: null };
}

function findIdentityMatch(candidate, evidenceRows) {
  const normalizedCandidateName = normalizeName(getPlayerName(candidate));
  if (!normalizedCandidateName) {
    return { match: null, reason: 'missing_name' };
  }

  const nameMatches = (Array.isArray(evidenceRows) ? evidenceRows : []).filter(
    (row) => normalizeName(getPlayerName(row)) === normalizedCandidateName
  );

  if (!nameMatches.length) {
    return { match: null, reason: 'name_not_found' };
  }

  const compatible = [];
  const conflictReasons = new Set();

  nameMatches.forEach((row) => {
    const result = compatibleIdentity(candidate, row);
    if (result.ok) {
      compatible.push(row);
    } else if (result.reason) {
      conflictReasons.add(result.reason);
    }
  });

  if (compatible.length === 1) {
    return { match: compatible[0], reason: null };
  }

  if (compatible.length > 1) {
    return { match: null, reason: 'ambiguous_name' };
  }

  if (conflictReasons.has('team_mismatch')) {
    return { match: null, reason: 'team_mismatch' };
  }

  if (conflictReasons.has('position_mismatch')) {
    return { match: null, reason: 'position_mismatch' };
  }

  return { match: null, reason: 'identity_conflict' };
}

function flattenWeeklyRankings(weeklyData) {
  const positions = weeklyData?.positions || {};
  const rows = [];

  SUPPORTED_POSITIONS.forEach((position) => {
    const leaderboard = Array.isArray(positions[position])
      ? positions[position]
      : [];

    leaderboard.forEach((row, index) => {
      rows.push({
        ...row,
        _sagePosition: position,
        _sagePositionRank: numberOrNull(
          firstDefined(row?.rank, row?.positionRank, row?.weeklyRank)
        ) || index + 1
      });
    });
  });

  return rows;
}

function buildTrendRows(risersFallersData) {
  const rows = [];

  (Array.isArray(risersFallersData?.risers) ? risersFallersData.risers : []).forEach(
    (row) => rows.push({ ...row, _trendDirection: 'RISER' })
  );

  (Array.isArray(risersFallersData?.fallers) ? risersFallersData.fallers : []).forEach(
    (row) => rows.push({ ...row, _trendDirection: 'FALLER' })
  );

  return rows;
}

function extractSageEvidence(row) {
  if (!row) {
    return null;
  }

  return {
    position: row._sagePosition || getPlayerPosition(row) || null,
    positionRank: row._sagePositionRank || null,
    sageScore: numberOrNull(
      firstDefined(row?.sageScore, row?.score, row?.SAGE)
    ),
    recommendation:
      firstDefined(row?.recommendation, row?.verdict, row?.label) || null,
    confidence: firstDefined(row?.confidence, row?.confidenceBand) || null,
    sageTake: row?.sageTake || null,
    opponent: firstDefined(row?.opponent, row?.opp) || null
  };
}

function extractTrendEvidence(row) {
  if (!row) {
    return null;
  }

  return {
    direction: row._trendDirection || null,
    targetShareDelta: numberOrNull(row?.targetShareDelta),
    snapShareDelta: numberOrNull(row?.snapShareDelta),
    currentTargets: numberOrNull(row?.current?.targets),
    previousTargets: numberOrNull(row?.previous?.targets),
    currentTargetShare: numberOrNull(row?.current?.targetSharePct),
    previousTargetShare: numberOrNull(row?.previous?.targetSharePct),
    currentSnapShare: numberOrNull(row?.current?.offSnapPct),
    previousSnapShare: numberOrNull(row?.previous?.offSnapPct)
  };
}

function rankRosterAtPosition(roster, sageRows, position) {
  const relevantRoster = (Array.isArray(roster) ? roster : []).filter(
    (player) => getPlayerPosition(player) === position
  );

  return relevantRoster.map((player) => {
    const sageMatch = findIdentityMatch(player, sageRows);
    const sage = extractSageEvidence(sageMatch.match);

    return {
      player,
      sage,
      matchReason: sageMatch.reason
    };
  });
}

function compareCandidateToRoster(candidateSage, rosterEvidence) {
  if (!candidateSage || !candidateSage.positionRank) {
    return {
      classification: 'UNKNOWN',
      weakestComparable: null,
      reason: 'candidate_missing_sage_rank'
    };
  }

  const comparable = rosterEvidence
    .filter((entry) => entry.sage && entry.sage.positionRank)
    .sort((a, b) => b.sage.positionRank - a.sage.positionRank);

  if (!comparable.length) {
    return {
      classification: 'UNKNOWN',
      weakestComparable: null,
      reason: 'no_comparable_roster_sage_rank'
    };
  }

  const weakest = comparable[0];
  const candidateRank = Number(candidateSage.positionRank);
  const rosterRank = Number(weakest.sage.positionRank);

  let classification = 'SIMILAR';
  if (candidateRank < rosterRank) {
    classification = 'UPGRADE';
  } else if (candidateRank > rosterRank) {
    classification = 'DOWNGRADE';
  }

  return {
    classification,
    weakestComparable: {
      name: getPlayerName(weakest.player),
      position: getPlayerPosition(weakest.player) || null,
      team: getPlayerTeam(weakest.player) || null,
      sage: weakest.sage
    },
    reason: null
  };
}

function isProviderAvailableStatus(player) {
  const status = String(
    firstDefined(player?.availabilityStatus, player?.status) || ''
  )
    .trim()
    .toUpperCase();

  return ['FREE_AGENT', 'FREEAGENT', 'WAIVERS'].includes(status);
}

function enrichCandidates({ availablePlayers, roster, weeklyData, risersFallersData }) {
  const sageRows = flattenWeeklyRankings(weeklyData);
  const trendRows = buildTrendRows(risersFallersData);

  return (Array.isArray(availablePlayers) ? availablePlayers : [])
    .filter(isProviderAvailableStatus)
    .map((candidate) => {
      const sageMatch = findIdentityMatch(candidate, sageRows);
      const trendMatch = findIdentityMatch(candidate, trendRows);
      const sage = extractSageEvidence(sageMatch.match);
      const trend = extractTrendEvidence(trendMatch.match);
      const position = getPlayerPosition(candidate) || sage?.position || null;
      const rosterEvidence = position
        ? rankRosterAtPosition(roster, sageRows, position)
        : [];
      const rosterImpact = compareCandidateToRoster(sage, rosterEvidence);

      return {
        providerPlayerId:
          firstDefined(candidate?.providerPlayerId, candidate?.playerId, candidate?.id) || null,
        name: getPlayerName(candidate),
        position,
        team: getPlayerTeam(candidate) || null,
        availabilityStatus:
          firstDefined(candidate?.availabilityStatus, candidate?.status) || null,
        percentOwned: numberOrNull(candidate?.percentOwned),
        percentStarted: numberOrNull(candidate?.percentStarted),
        providerProjectedPoints: numberOrNull(candidate?.projectedPoints),
        identity: {
          sageMatched: Boolean(sageMatch.match),
          sageMatchReason: sageMatch.reason,
          trendMatched: Boolean(trendMatch.match),
          trendMatchReason: trendMatch.reason
        },
        sage,
        trend,
        rosterImpact
      };
    });
}

function getBaseUrl(event) {
  const headers = event.headers || {};
  const proto = headers['x-forwarded-proto'] || headers['X-Forwarded-Proto'] || 'https';
  const host = headers.host || headers.Host;
  if (!host) {
    throw new Error('Could not determine host.');
  }
  return `${proto}://${host}`;
}

async function fetchWeeklyData(event, season, week, scoring, teams) {
  const baseUrl = getBaseUrl(event);
  const query = new URLSearchParams({
    season: String(season),
    week: String(week),
    seasonType: 'reg',
    scoring: String(scoring || 'ppr'),
    teams: String(teams || 12)
  });

  const response = await fetch(
    `${baseUrl}/.netlify/functions/weekly-sage-rankings?${query.toString()}`,
    { method: 'GET', headers: { Accept: 'application/json' } }
  );

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }

  if (!response.ok || !data) {
    throw new Error(
      (data && (data.error || data.detail)) ||
        `Weekly SAGE unavailable (HTTP ${response.status}).`
    );
  }

  return data;
}

async function readRisersFallers(event) {
  try {
    connectLambda(event);
    const store = getStore({ name: 'risers-fallers' });
    return (await store.get('latest', { type: 'json' })) || null;
  } catch (error) {
    // Trend data is supporting evidence, never a prerequisite for waiver
    // candidate enrichment. Weekly SAGE + provider availability can still
    // produce useful output when Risers & Fallers is unavailable.
    return null;
  }
}

exports.handler = async function (event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';

  if (!isOriginAllowed(origin)) {
    return jsonResponse(403, { error: 'Forbidden' }, origin);
  }

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders(origin),
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed.' }, origin);
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (error) {
    return jsonResponse(400, { error: 'Invalid JSON body.' }, origin);
  }

  const provider = String(body.provider || '').trim().toLowerCase();
  const availablePlayers = Array.isArray(body.availablePlayers)
    ? body.availablePlayers
    : [];
  const roster = Array.isArray(body.roster) ? body.roster : [];
  const season = Number(body.season || new Date().getFullYear());
  const week = Number(body.week);
  const scoring = body.scoring || body.scoringFormat || 'ppr';
  const teams = Number(body.teams || body.teamCount || 12);

  if (!provider) {
    return jsonResponse(400, { error: 'provider is required.' }, origin);
  }

  if (!Number.isInteger(week) || week < 1 || week > 18) {
    return jsonResponse(400, { error: 'week must be an integer from 1 through 18.' }, origin);
  }

  if (!availablePlayers.length) {
    return jsonResponse(
      200,
      {
        evidenceType: 'waiver-candidates',
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        provider,
        season,
        week,
        candidates: [],
        metadata: {
          availablePlayersReceived: 0,
          candidatesReturned: 0,
          note:
            'No provider-reported available players were supplied. This service never invents league availability.'
        }
      },
      origin
    );
  }

  try {
    const [weeklyData, risersFallersData] = await Promise.all([
      fetchWeeklyData(event, season, week, scoring, teams),
      readRisersFallers(event)
    ]);

    const candidates = enrichCandidates({
      availablePlayers,
      roster,
      weeklyData,
      risersFallersData
    });

    return jsonResponse(
      200,
      {
        evidenceType: 'waiver-candidates',
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        provider,
        season,
        week,
        candidates,
        metadata: {
          availablePlayersReceived: availablePlayers.length,
          candidatesReturned: candidates.length,
          sageMatched: candidates.filter((candidate) => candidate.identity.sageMatched).length,
          trendMatched: candidates.filter((candidate) => candidate.identity.trendMatched).length,
          trendDataAvailable: Boolean(risersFallersData),
          methodology:
            'Provider availability is authoritative. Weekly SAGE and Risers & Fallers are joined as existing evidence; no new waiver score is calculated.'
        }
      },
      origin
    );
  } catch (error) {
    return jsonResponse(
      502,
      {
        error: 'Waiver candidates could not be produced.',
        detail: error && error.message ? error.message : 'Unknown error.'
      },
      origin
    );
  }
};

// Pure helpers are exported only for regression tests. The Netlify handler
// remains the production entry point.
exports._test = {
  normalizeName,
  normalizeTeam,
  normalizePosition,
  findIdentityMatch,
  flattenWeeklyRankings,
  buildTrendRows,
  compareCandidateToRoster,
  isProviderAvailableStatus,
  enrichCandidates
};
