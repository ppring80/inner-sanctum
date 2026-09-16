'use strict';

// netlify/functions/waiver-candidates.js
//
// PROVIDER-NEUTRAL WAIVER CANDIDATE INTELLIGENCE
// ------------------------------------------------
// Provider availability is authoritative. This service joins only players
// explicitly reported as FREE_AGENT / FREEAGENT / WAIVERS to intelligence
// Inner Sanctum already produces:
//
//   provider availability -> Weekly SAGE -> Risers & Fallers -> roster context
//
// It does not calculate a new SAGE/waiver score, invent availability,
// calculate FAAB, or submit transactions.

const { connectLambda, getStore } = require('@netlify/blobs');
const PlayerIdentity = require('../../player-identity.js');

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean)
  : ['https://theinnersanctum.xyz'];

const SUPPORTED_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

function isOriginAllowed(origin) {
  return !origin || ALLOWED_ORIGINS.includes(origin);
}

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    Vary: 'Origin'
  };

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

function firstDefined() {
  for (let i = 0; i < arguments.length; i += 1) {
    if (arguments[i] !== undefined && arguments[i] !== null) {
      return arguments[i];
    }
  }
  return undefined;
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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
  const position = String(value || '').trim().toUpperCase();
  if (['DST', 'D/ST', 'D-ST', 'DEFENSE'].includes(position)) {
    return 'DEF';
  }
  if (position === 'PK') {
    return 'K';
  }
  return position;
}

function getPlayerName(player) {
  if (getPlayerPosition(player) === 'DEF') {
    const teamCode = getPlayerTeam(player);
    if (teamCode) return teamCode;
  }

  return firstDefined(
    player?.name,
    player?.longName,
    player?.fullName,
    player?.playerName
  ) || '';
}

function getPlayerTeam(player) {
  return normalizeTeam(
    firstDefined(
      player?.team,
      player?.nflTeam,
      player?.teamAbv,
      player?.teamAbbreviation,
      player?.proTeam
    )
  );
}

function getPlayerPosition(player) {
  return normalizePosition(
    firstDefined(
      player?.position,
      player?.pos,
      player?.defaultPosition
    )
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
  const candidateName = getPlayerName(candidate);

  if (!normalizeName(candidateName)) {
    return { match: null, reason: 'missing_name' };
  }

  const rows = Array.isArray(evidenceRows) ? evidenceRows : [];
  const identityCandidate = {
    name: candidateName,
    position: getPlayerPosition(candidate)
  };
  const identityRows = rows.map((row) => ({
    name: getPlayerName(row),
    position: getPlayerPosition(row),
    __sourceRow: row
  }));

  const resolvedIdentityRow = PlayerIdentity.resolveRosterPlayer(
    identityCandidate,
    identityRows
  );

  if (!resolvedIdentityRow) {
    const exactNameMatches = identityRows.filter(
      (row) => normalizeName(row.name) === normalizeName(candidateName)
    );

    if (!exactNameMatches.length) {
      return { match: null, reason: 'name_not_found' };
    }

    if (exactNameMatches.length > 1) {
      const anyCompatible = exactNameMatches.some(
        (row) => compatibleIdentity(candidate, row.__sourceRow).ok
      );
      if (anyCompatible) {
        return { match: null, reason: 'ambiguous_name' };
      }
    }

    const conflicts = new Set();
    exactNameMatches.forEach((row) => {
      const result = compatibleIdentity(candidate, row.__sourceRow);
      if (!result.ok && result.reason) conflicts.add(result.reason);
    });

    if (conflicts.has('team_mismatch')) {
      return { match: null, reason: 'team_mismatch' };
    }
    if (conflicts.has('position_mismatch')) {
      return { match: null, reason: 'position_mismatch' };
    }

    return { match: null, reason: 'identity_conflict' };
  }

  const match = resolvedIdentityRow.__sourceRow;
  const compatibility = compatibleIdentity(candidate, match);
  if (!compatibility.ok) {
    return { match: null, reason: compatibility.reason };
  }

  return { match, reason: null };
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
        _sagePositionRank:
          numberOrNull(
            firstDefined(row?.positionRank, row?.rank, row?.weeklyRank)
          ) ||
          index + 1
      });
    });
  });

  return rows;
}

function buildTeamOpponentMap(sageRows) {
  const opponentsByTeam = new Map();

  (Array.isArray(sageRows) ? sageRows : []).forEach((row) => {
    const team = getPlayerTeam(row);
    const rawOpponent = firstDefined(row?.opponent, row?.opp);
    const opponent = String(rawOpponent || '').trim().toUpperCase() === 'BYE'
      ? 'BYE'
      : normalizeTeam(rawOpponent);

    if (!team || !opponent) return;

    if (!opponentsByTeam.has(team)) {
      opponentsByTeam.set(team, opponent);
      return;
    }

    // Conflicting schedule evidence is less trustworthy than an explicit
    // blank. This keeps matchup resolution conservative across leaderboard
    // sources while allowing any player on a known NFL team to use the same
    // weekly opponent, independent of a player-level SAGE identity match.
    if (opponentsByTeam.get(team) !== opponent) {
      opponentsByTeam.set(team, null);
    }
  });

  return opponentsByTeam;
}

function buildScheduleOpponentMap(scheduleData) {
  const opponentsByTeam = new Map();
  const games = Array.isArray(scheduleData?.games) ? scheduleData.games : [];

  games.forEach((game) => {
    const away = normalizeTeam(game?.away);
    const home = normalizeTeam(game?.home);
    if (!away || !home) return;
    opponentsByTeam.set(away, home);
    opponentsByTeam.set(home, away);
  });

  const byeTeams = Array.isArray(scheduleData?.byeTeams)
    ? scheduleData.byeTeams
    : [];
  byeTeams.forEach((team) => {
    const normalized = normalizeTeam(team);
    if (normalized) opponentsByTeam.set(normalized, 'BYE');
  });

  return opponentsByTeam;
}

function buildTrendRows(risersFallersData) {
  const rows = [];

  (Array.isArray(risersFallersData?.risers) ? risersFallersData.risers : [])
    .forEach((row) => rows.push({ ...row, _trendDirection: 'RISER' }));

  (Array.isArray(risersFallersData?.fallers) ? risersFallersData.fallers : [])
    .forEach((row) => rows.push({ ...row, _trendDirection: 'FALLER' }));

  return rows;
}

function extractSageEvidence(row) {
  if (!row) {
    return null;
  }

  // Weeks 2-18 positional leaderboards use nested row.sage.* fields.
  // Week 1 uses explicit baseline fields such as positionRank,
  // recommendation, sageScore:null, and rankingScore. Support both shapes
  // without pretending Week 1 baseline evidence is a SAGE score.
  const nestedSage =
    row?.sage && typeof row.sage === 'object'
      ? row.sage
      : null;

  return {
    position: row._sagePosition || getPlayerPosition(row) || null,
    positionRank: row._sagePositionRank || null,
    sageScore: numberOrNull(
      firstDefined(
        nestedSage?.score,
        row?.sageScore,
        row?.score,
        row?.SAGE
      )
    ),
    sageLabel: firstDefined(nestedSage?.label, row?.sageLabel, row?.label) || null,
    recommendation: firstDefined(row?.recommendation, row?.verdict) || null,
    confidence: numberOrNull(
      firstDefined(
        nestedSage?.confidence,
        row?.confidence,
        row?.confidenceBand
      )
    ),
    confidenceLabel:
      firstDefined(nestedSage?.confidenceLabel, row?.confidenceLabel) || null,
    sageTake: row?.sageTake || null,
    opponent: firstDefined(row?.opponent, row?.opp) || null,
    baselineEvidenceType: row?.baselineEvidenceType || null,
    rankingScore: numberOrNull(row?.rankingScore),
    adp: numberOrNull(row?.adp)
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

function buildOpportunityRows(opportunityData) {
  const records = opportunityData?.records && typeof opportunityData.records === 'object'
    ? opportunityData.records
    : {};
  return Object.values(records);
}

function signalValue(row, type) {
  const signal = Array.isArray(row?.signals)
    ? row.signals.find((entry) => entry?.type === type)
    : null;
  return signal || null;
}

function extractOpportunityEvidence(row) {
  if (!row) return null;

  const volume = signalValue(row, 'volumeTier');
  const trend = signalValue(row, 'trendClassification');
  const lastGame = numberOrNull(row?.opportunities?.lastGame);
  const carries = numberOrNull(row?.rushing?.lastGame);
  const targets = numberOrNull(row?.receiving?.lastGame);

  if (!volume && !trend && lastGame === null && carries === null && targets === null) {
    return null;
  }

  return {
    volumeTier: volume?.value || null,
    volumeBasis: numberOrNull(volume?.detail?.basisValue),
    direction: trend?.value || null,
    lastGameOpportunities: lastGame,
    lastGameCarries: carries,
    lastGameTargets: targets,
    gamesSampled: numberOrNull(row?.opportunities?.gamesSampled)
  };
}

function rankRosterAtPosition(roster, sageRows, position) {
  return (Array.isArray(roster) ? roster : [])
    .filter((player) => getPlayerPosition(player) === position)
    .map((player) => {
      const sageMatch = findIdentityMatch(player, sageRows);
      return {
        player,
        sage: extractSageEvidence(sageMatch.match),
        matchReason: sageMatch.reason
      };
    });
}

function isWeekOneBaseline(sage) {
  return sage?.baselineEvidenceType === 'week1-adp-baseline';
}

function compareCandidateToRoster(candidateSage, rosterEvidence, candidate = null) {
  if (!candidateSage || !candidateSage.positionRank) {
    return {
      classification: 'UNKNOWN',
      weakestComparable: null,
      reason: 'candidate_missing_sage_rank'
    };
  }

  const comparable = (Array.isArray(rosterEvidence) ? rosterEvidence : [])
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

  if (isWeekOneBaseline(candidateSage)) {
    const candidateProjection = numberOrNull(candidate?.projectedPoints);
    const projectedComparable = comparable
      .filter((entry) => numberOrNull(entry.player?.projectedPoints) !== null)
      .sort((a, b) =>
        numberOrNull(a.player?.projectedPoints) - numberOrNull(b.player?.projectedPoints)
      );

    // Week 1 ADP is supporting context, not current-week evidence. It may not
    // veto a candidate by itself; compare current provider projections when
    // both sides have them, otherwise leave the depth result unresolved.
    if (candidateProjection === null || !projectedComparable.length) {
      return {
        classification: 'UNKNOWN',
        weakestComparable: null,
        reason: 'week1_baseline_requires_current_projection'
      };
    }

    const projectedWeakest = projectedComparable[0];
    const rosterProjection = numberOrNull(projectedWeakest.player?.projectedPoints);
    return {
      classification: candidateProjection > rosterProjection
        ? 'UPGRADE'
        : candidateProjection < rosterProjection ? 'DOWNGRADE' : 'SIMILAR',
      weakestComparable: {
        name: getPlayerName(projectedWeakest.player),
        position: getPlayerPosition(projectedWeakest.player) || null,
        team: getPlayerTeam(projectedWeakest.player) || null,
        projectedPoints: rosterProjection,
        sage: projectedWeakest.sage
      },
      reason: null
    };
  }

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

const FLEX_ELIGIBLE = ['RB', 'WR', 'TE'];
const SUPERFLEX_ELIGIBLE = ['QB', 'RB', 'WR', 'TE'];
const FIXED_LINEUP_SLOTS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

function lineupRankingValue(sage, projectedPoints = null, preferProjection = false) {
  if (preferProjection && numberOrNull(projectedPoints) !== null) {
    return numberOrNull(projectedPoints);
  }
  if (sage?.sageScore !== null && sage?.sageScore !== undefined && Number.isFinite(Number(sage.sageScore))) {
    return Number(sage.sageScore);
  }
  if (Number.isFinite(Number(sage?.adp)) && Number(sage.adp) > 0) {
    return -Number(sage.adp);
  }
  return null;
}

function hasStartingLineupSlots(lineup) {
  return lineup && typeof lineup === 'object' &&
    [...FIXED_LINEUP_SLOTS, 'FLEX', 'SUPERFLEX']
      .some((slot) => Number(lineup[slot]) > 0);
}

function deriveEspnLineupConstruction(settings) {
  const counts = settings?.rosterSettings?.lineupSlotCounts;
  if (!counts || typeof counts !== 'object') return null;
  const get = (id) => Number(counts[id] ?? counts[String(id)] ?? 0) || 0;
  const lineup = {
    QB: get(0), RB: get(2), WR: get(4), TE: get(6),
    FLEX: get(23), SUPERFLEX: get(7), K: get(17), DEF: get(16),
    BENCH: get(20), IR: get(21)
  };
  return hasStartingLineupSlots(lineup) ? lineup : null;
}

function deriveEspnScoringFormat(settings) {
  const items = Array.isArray(settings?.scoringSettings?.scoringItems)
    ? settings.scoringSettings.scoringItems
    : [];
  const reception = items.find((item) => Number(item?.statId) === 53);
  const points = numberOrNull(reception?.points);
  if (points === 1) return 'ppr';
  if (points === 0.5) return 'half-ppr';
  if (points === 0) return 'standard';
  return null;
}

function deriveEspnLineupFromRoster(roster) {
  const slotMap = {
    0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 7: 'SUPERFLEX',
    16: 'DEF', 17: 'K', 20: 'BENCH', 21: 'IR', 23: 'FLEX'
  };
  const lineup = {
    QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0,
    K: 0, DEF: 0, BENCH: 0, IR: 0
  };
  (Array.isArray(roster) ? roster : []).forEach((player) => {
    const slot = slotMap[Number(player?.lineupSlotId)];
    if (slot) lineup[slot] += 1;
  });
  return hasStartingLineupSlots(lineup) ? lineup : null;
}

function buildLineupPlayer(player, sageRows, id, preferProjection = false) {
  const sageMatch = findIdentityMatch(player, sageRows);
  const sage = extractSageEvidence(sageMatch.match);
  return {
    id,
    player,
    name: getPlayerName(player),
    position: getPlayerPosition(player) || sage?.position || null,
    sage,
    rankingValue: lineupRankingValue(sage, player?.projectedPoints, preferProjection),
    projectedPoints: numberOrNull(player?.projectedPoints)
  };
}

function assignOptimalLineup(players, lineupConstruction) {
  const available = (Array.isArray(players) ? players : [])
    .filter((entry) => entry.position && entry.rankingValue !== null)
    .slice()
    .sort((a, b) => b.rankingValue - a.rankingValue);
  const assignments = [];

  function fillSlots(slot, count, eligiblePositions) {
    for (let index = 0; index < count; index += 1) {
      const bestIndex = available.findIndex((entry) =>
        eligiblePositions.includes(entry.position)
      );
      if (bestIndex === -1) break;
      assignments.push({ ...available.splice(bestIndex, 1)[0], slot });
    }
  }

  FIXED_LINEUP_SLOTS.forEach((position) => {
    fillSlots(position, Number(lineupConstruction?.[position]) || 0, [position]);
  });
  fillSlots('FLEX', Number(lineupConstruction?.FLEX) || 0, FLEX_ELIGIBLE);
  fillSlots(
    'SUPERFLEX',
    Number(lineupConstruction?.SUPERFLEX) || 0,
    SUPERFLEX_ELIGIBLE
  );

  return assignments;
}

function compareCandidateToLineup(candidate, candidateSage, roster, sageRows, lineupConstruction) {
  const hasStartingSlots = [...FIXED_LINEUP_SLOTS, 'FLEX', 'SUPERFLEX']
    .some((slot) => Number(lineupConstruction?.[slot]) > 0);
  const candidatePosition = getPlayerPosition(candidate) || candidateSage?.position || null;
  const rosterList = Array.isArray(roster) ? roster : [];
  const candidateProjection = numberOrNull(candidate?.projectedPoints);
  const preferProjection = isWeekOneBaseline(candidateSage) &&
    candidateProjection !== null &&
    rosterList.every((player) => numberOrNull(player?.projectedPoints) !== null);
  const candidateValue = lineupRankingValue(
    candidateSage,
    candidateProjection,
    preferProjection
  );

  if (!hasStartingSlots || !candidatePosition || candidateValue === null) {
    return null;
  }

  const rosterPlayers = rosterList.map((player, index) =>
    buildLineupPlayer(player, sageRows, `roster-${index}`, preferProjection)
  );
  const candidatePlayer = {
    id: 'candidate',
    player: candidate,
    name: getPlayerName(candidate),
    position: candidatePosition,
    sage: candidateSage,
    rankingValue: candidateValue,
    projectedPoints: numberOrNull(candidate?.projectedPoints)
  };
  const before = assignOptimalLineup(rosterPlayers, lineupConstruction);
  const after = assignOptimalLineup([...rosterPlayers, candidatePlayer], lineupConstruction);
  const candidateAssignment = after.find((entry) => entry.id === 'candidate');

  if (!candidateAssignment) {
    return {
      classification: 'SIMILAR',
      comparisonType: 'starting-lineup',
      candidateStarts: false,
      targetSlot: null,
      displacedStarter: null,
      lineupValueDelta: 0,
      projectionDelta: null,
      weakestComparable: null,
      reason: 'candidate_does_not_enter_starting_lineup'
    };
  }

  const afterRosterIds = new Set(after.filter((entry) => entry.id !== 'candidate').map((entry) => entry.id));
  const displaced = before.find((entry) => !afterRosterIds.has(entry.id)) || null;
  const beforeValue = before.reduce((sum, entry) => sum + entry.rankingValue, 0);
  const afterValue = after.reduce((sum, entry) => sum + entry.rankingValue, 0);
  const lineupValueDelta = afterValue - beforeValue;
  const projectionDelta = displaced && candidatePlayer.projectedPoints !== null && displaced.projectedPoints !== null
    ? candidatePlayer.projectedPoints - displaced.projectedPoints
    : null;

  return {
    classification: !displaced || lineupValueDelta > 0 ? 'UPGRADE' : 'SIMILAR',
    comparisonType: 'starting-lineup',
    candidateStarts: true,
    targetSlot: candidateAssignment.slot,
    displacedStarter: displaced ? {
      name: displaced.name,
      position: displaced.position,
      team: getPlayerTeam(displaced.player) || null,
      slot: displaced.slot,
      sage: displaced.sage
    } : null,
    lineupValueDelta,
    projectionDelta,
    weakestComparable: displaced ? {
      name: displaced.name,
      position: displaced.position,
      team: getPlayerTeam(displaced.player) || null,
      sage: displaced.sage
    } : null,
    reason: displaced ? null : 'candidate_fills_open_starting_slot'
  };
}

function isProviderAvailableStatus(player) {
  const status = String(
    firstDefined(player?.availabilityStatus, player?.status) || ''
  ).trim().toUpperCase();

  return ['FREE_AGENT', 'FREEAGENT', 'WAIVERS'].includes(status);
}

function resolveConnectionInput(body) {
  const connection =
    body?.connection && typeof body.connection === 'object'
      ? body.connection
      : null;

  const provider = String(
    firstDefined(body?.provider, connection?.provider) || ''
  ).trim().toLowerCase();

  // ESPN currently persists the espn-league response as connection.league.
  // The ESPN function adds availablePlayers inside that object. Also accept
  // top-level availability so future providers can use the same endpoint.
  const availablePlayers = firstDefined(
    body?.availablePlayers,
    connection?.availablePlayers,
    connection?.league?.availablePlayers
  );

  const roster = firstDefined(body?.roster, connection?.roster);
  const savedLineupConstruction = firstDefined(
    body?.lineupConstruction,
    connection?.lineupConstruction
  );

  const league =
    connection?.league && typeof connection.league === 'object'
      ? connection.league
      : {};
  const settingsLineup = provider === 'espn'
    ? deriveEspnLineupConstruction(connection?.settings)
    : null;
  const rosterLineup = provider === 'espn'
    ? deriveEspnLineupFromRoster(roster)
    : null;
  const lineupSource = hasStartingLineupSlots(savedLineupConstruction)
    ? 'saved-lineup-construction'
    : settingsLineup
      ? 'espn-settings'
      : rosterLineup
        ? 'espn-roster-slots'
        : 'none';
  const lineupConstruction = lineupSource === 'saved-lineup-construction'
    ? savedLineupConstruction
    : settingsLineup || rosterLineup;

  return {
    provider,
    availablePlayers: Array.isArray(availablePlayers) ? availablePlayers : [],
    roster: Array.isArray(roster) ? roster : [],
    lineupConstruction:
      lineupConstruction,
    lineupDiagnostics: {
      source: lineupSource,
      resolved: lineupConstruction || null,
      settingsPresent: Boolean(connection?.settings?.rosterSettings?.lineupSlotCounts),
      rosterPlayersReceived: Array.isArray(roster) ? roster.length : 0,
      rosterPlayersWithSlotIds: Array.isArray(roster)
        ? roster.filter((player) => player?.lineupSlotId !== null && player?.lineupSlotId !== undefined).length
        : 0
    },
    season: Number(
      firstDefined(body?.season, connection?.season, league?.season) ||
      new Date().getFullYear()
    ),
    week: Number(firstDefined(body?.week, league?.scoringPeriodId)),
    scoring:
      firstDefined(
        body?.scoring,
        body?.scoringFormat,
        connection?.scoringFormat,
        provider === 'espn' ? deriveEspnScoringFormat(connection?.settings) : null
      ) || 'ppr',
    teams: Number(
      firstDefined(
        body?.teams,
        body?.teamCount,
        connection?.teamCount,
        league?.teamCount,
        connection?.settings?.size,
        league?.size
      ) || 12
    ),
    availabilityMeta: firstDefined(
      body?.availabilityMeta,
      connection?.availabilityMeta,
      connection?.league?.availabilityMeta
    ) || null
  };
}

function enrichCandidates({ availablePlayers, roster, lineupConstruction, weeklyData, risersFallersData, opportunityData, scheduleData }) {
  const sageRows = flattenWeeklyRankings(weeklyData);
  const scheduleOpponents = buildScheduleOpponentMap(scheduleData);
  const sageOpponents = buildTeamOpponentMap(sageRows);
  const trendRows = buildTrendRows(risersFallersData);
  const opportunityRows = buildOpportunityRows(opportunityData);

  return (Array.isArray(availablePlayers) ? availablePlayers : [])
    .filter(isProviderAvailableStatus)
    // ESPN's player catalog contains historical players that can still carry
    // an available status. Only exclude an explicit provider inactive flag;
    // missing activity data remains eligible so legitimate deep-league and
    // fringe players are preserved.
    .filter((candidate) => candidate?.active !== false)
    .map((candidate) => {
      const sageMatch = findIdentityMatch(candidate, sageRows);
      const trendMatch = findIdentityMatch(candidate, trendRows);
      const opportunityMatch = findIdentityMatch(candidate, opportunityRows);
      const sage = extractSageEvidence(sageMatch.match);
      const trend = extractTrendEvidence(trendMatch.match);
      const opportunity = extractOpportunityEvidence(opportunityMatch.match);
      const position = getPlayerPosition(candidate) || sage?.position || null;
      const team = getPlayerTeam(candidate) || null;
      const directOpponent = firstDefined(candidate?.opponent, candidate?.opp);
      const opponent = directOpponent
        ? (String(directOpponent).trim().toUpperCase() === 'BYE'
            ? 'BYE'
            : normalizeTeam(directOpponent))
        : scheduleOpponents.get(team) || sage?.opponent || sageOpponents.get(team) || null;
      const rosterEvidence = position
        ? rankRosterAtPosition(roster, sageRows, position)
        : [];

      const lineupImpact = compareCandidateToLineup(
        candidate,
        sage,
        roster,
        sageRows,
        lineupConstruction
      );
      const depthComparison = compareCandidateToRoster(sage, rosterEvidence, candidate);

      return {
        providerPlayerId:
          firstDefined(candidate?.providerPlayerId, candidate?.playerId, candidate?.id) || null,
        active: typeof candidate?.active === 'boolean' ? candidate.active : null,
        proTeamId: numberOrNull(candidate?.proTeamId),
        name: getPlayerName(candidate),
        position,
        team,
        opponent,
        homeAway: firstDefined(candidate?.homeAway, candidate?.matchup?.homeAway) || null,
        gameTime: firstDefined(candidate?.gameTime, candidate?.matchup?.gameTime) || null,
        matchup: candidate?.matchup && typeof candidate.matchup === 'object'
          ? { ...candidate.matchup, opponent }
          : opponent ? { opponent } : null,
        availabilityStatus:
          firstDefined(candidate?.availabilityStatus, candidate?.status) || null,
        percentOwned: numberOrNull(candidate?.percentOwned),
        percentStarted: numberOrNull(candidate?.percentStarted),
        providerProjectedPoints: numberOrNull(candidate?.projectedPoints),
        identity: {
          sageMatched: Boolean(sageMatch.match),
          sageMatchReason: sageMatch.reason,
          trendMatched: Boolean(trendMatch.match),
          trendMatchReason: trendMatch.reason,
          opportunityMatched: Boolean(opportunityMatch.match),
          opportunityMatchReason: opportunityMatch.reason
        },
        sage,
        trend,
        opportunity,
        rosterImpact: lineupImpact ? {
          ...lineupImpact,
          depthComparison
        } : {
          ...depthComparison,
          comparisonType: 'same-position-fallback'
        }
      };
    });
}

function getBaseUrl(event) {
  const headers = event.headers || {};
  const proto =
    headers['x-forwarded-proto'] ||
    headers['X-Forwarded-Proto'] ||
    'https';
  const host = headers.host || headers.Host;

  if (!host) {
    throw new Error('Could not determine host.');
  }

  return `${proto}://${host}`;
}

async function requestWeeklyData(event, season, week, scoring, teams) {
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
    return {
      ok: false,
      error:
        (data && (data.error || data.detail)) ||
        `Weekly SAGE unavailable (HTTP ${response.status}).`
    };
  }

  return { ok: true, data };
}

function weeklyFallbackWeeks(week) {
  const requested = Number(week);
  const weeks = [requested];
  if (requested > 2) weeks.push(requested - 1);
  if (requested > 1) weeks.push(1);
  return [...new Set(weeks)];
}

async function fetchWeeklyData(event, season, week, scoring, teams) {
  const attempts = [];

  for (const sourceWeek of weeklyFallbackWeeks(week)) {
    const result = await requestWeeklyData(
      event,
      season,
      sourceWeek,
      scoring,
      teams
    );
    if (result.ok) {
      return {
        ...result.data,
        metadata: {
          ...(result.data.metadata || {}),
          requestedWeek: Number(week),
          sourceWeek,
          fallbackUsed: sourceWeek !== Number(week),
          fallbackAttempts: attempts
        }
      };
    }
    attempts.push({ week: sourceWeek, error: result.error });
  }

  throw new Error(
    attempts[0]?.error || 'Weekly SAGE is unavailable for the requested and fallback weeks.'
  );
}

async function fetchWeeklySchedule(event, season, week) {
  try {
    const baseUrl = getBaseUrl(event);
    const query = new URLSearchParams({
      season: String(season),
      week: String(week),
      seasonType: 'reg'
    });
    const response = await fetch(
      `${baseUrl}/.netlify/functions/weekly-sage-schedule?${query.toString()}`,
      { method: 'GET', headers: { Accept: 'application/json' } }
    );
    if (!response.ok) return null;
    const data = await response.json();
    return data && Array.isArray(data.games) ? data : null;
  } catch (error) {
    return null;
  }
}

async function readRisersFallers(event) {
  try {
    connectLambda(event);
    const store = getStore({ name: 'risers-fallers' });
    return (await store.get('latest', { type: 'json' })) || null;
  } catch (error) {
    return null;
  }
}

async function readOpportunityIntel(event) {
  try {
    connectLambda(event);
    const store = getStore({ name: 'opportunity-intel' });
    return (await store.get('latest', { type: 'json' })) || null;
  } catch (error) {
    return null;
  }
}

exports.handler = async function (event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';

  if (!isOriginAllowed(origin)) {
    return jsonResponse(403, { error: 'Forbidden' }, origin);
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(origin), body: '' };
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

  const input = resolveConnectionInput(body);

  if (!input.provider) {
    return jsonResponse(400, { error: 'provider is required.' }, origin);
  }

  if (!Number.isInteger(input.week) || input.week < 1 || input.week > 18) {
    return jsonResponse(
      400,
      { error: 'week must be an integer from 1 through 18.' },
      origin
    );
  }

  if (!input.availablePlayers.length) {
    return jsonResponse(
      200,
      {
        evidenceType: 'waiver-candidates',
        schemaVersion: 2,
        generatedAt: new Date().toISOString(),
        provider: input.provider,
        season: input.season,
        week: input.week,
        scoring: input.scoring,
        teams: input.teams,
        candidates: [],
        metadata: {
          availablePlayersReceived: 0,
          candidatesReturned: 0,
          availabilityMeta: input.availabilityMeta,
          lineupDiagnostics: input.lineupDiagnostics,
          note:
            'No provider-reported available players were supplied. This service never invents league availability.'
        }
      },
      origin
    );
  }

  try {
    const [weeklyData, risersFallersData, opportunityData, scheduleData] = await Promise.all([
      fetchWeeklyData(
        event,
        input.season,
        input.week,
        input.scoring,
        input.teams
      ),
      readRisersFallers(event),
      readOpportunityIntel(event),
      fetchWeeklySchedule(event, input.season, input.week)
    ]);

    const candidates = enrichCandidates({
      availablePlayers: input.availablePlayers,
      roster: input.roster,
      lineupConstruction: input.lineupConstruction,
      weeklyData,
      risersFallersData,
      opportunityData,
      scheduleData
    });

    return jsonResponse(
      200,
      {
        evidenceType: 'waiver-candidates',
        schemaVersion: 2,
        generatedAt: new Date().toISOString(),
        provider: input.provider,
        season: input.season,
        week: input.week,
        scoring: input.scoring,
        teams: input.teams,
        candidates,
        metadata: {
          availablePlayersReceived: input.availablePlayers.length,
          candidatesReturned: candidates.length,
          sageMatched:
            candidates.filter((candidate) => candidate.identity.sageMatched).length,
          trendMatched:
            candidates.filter((candidate) => candidate.identity.trendMatched).length,
          trendDataAvailable: Boolean(risersFallersData),
          opportunityDataAvailable: Boolean(opportunityData),
          scheduleDataAvailable: Boolean(scheduleData),
          sageRequestedWeek: input.week,
          sageSourceWeek:
            Number(weeklyData?.metadata?.sourceWeek) ||
            Number(weeklyData?.targetWeek) ||
            input.week,
          sageFallbackUsed: weeklyData?.metadata?.fallbackUsed === true,
          sageFallbackAttempts: weeklyData?.metadata?.fallbackAttempts || [],
          opportunityMatched:
            candidates.filter((candidate) => candidate.identity.opportunityMatched).length,
          availabilityMeta: input.availabilityMeta,
          lineupDiagnostics: input.lineupDiagnostics,
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

exports._test = {
  normalizeName,
  normalizeTeam,
  normalizePosition,
  getPlayerName,
  getPlayerTeam,
  getPlayerPosition,
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
  assignOptimalLineup,
  compareCandidateToLineup,
  isProviderAvailableStatus,
  resolveConnectionInput,
  enrichCandidates,
  weeklyFallbackWeeks,
  requestWeeklyData,
  fetchWeeklyData
};
