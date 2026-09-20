// netlify/functions/weekly-sage-rankings.js
//
// WEEKLY SAGE — UNIFIED WEEKLY RANKINGS ENDPOINT
//
// Customer-facing entry point for Weekly Rankings. It combines the
// position-specific leaderboards without recalculating their scores,
// order, or recommendations.

const { connectLambda, getStore } = require("@netlify/blobs");

const DEFAULT_SEASON_TYPE = "reg";

const {
  buildWeek2PlusSageTake
} = require(
  "./sage-take.js"
);

const {
  POLICY: RANKING_GUARDRAIL_POLICY
} = require(
  "./weekly-sage-ranking-guardrails.js"
);

const CACHE_CONTROL =
  "public, max-age=60, s-maxage=300, stale-while-revalidate=600";

const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];
const PLAYER_AVAILABILITY_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K"]);
const HARD_UNAVAILABLE = new Set([
  "OUT", "IR", "INACTIVE", "INJURED RESERVE", "RESERVE/INJURED",
  "SUSPENDED", "COMMISSIONER EXEMPT", "COMMISSIONER'S EXEMPT LIST",
  "COMMISSIONER EXEMPT NO PLAY", "PUP", "RESERVE/PUP", "NFI", "RESERVE/NFI"
]);

const LEADERBOARD_FUNCTION_BY_POSITION = {
  QB: "weekly-sage-qb-leaderboard",
  RB: "weekly-sage-rb-leaderboard",
  WR: "weekly-sage-wr-leaderboard",
  TE: "weekly-sage-te-leaderboard",
  K: "weekly-sage-k-leaderboard",
  DEF: "weekly-sage-def-leaderboard"
};

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": CACHE_CONTROL
    },
    body: JSON.stringify(body, null, 2)
  };
}

function getBaseUrl(event) {
  const headers = event.headers || {};
  const proto =
    headers["x-forwarded-proto"] ||
    headers["X-Forwarded-Proto"] ||
    "https";
  const host = headers.host || headers.Host;
  if (!host) {
    throw new Error("Could not determine host.");
  }
  return `${proto}://${host}`;
}

/*
  Connected-roster identity contract for team defenses
  ----------------------------------------------------
  ESPN's roster payload identifies a defense by its NFL team abbreviation
  (for example HOU), while the Week 1 ADP source names that same entry
  "Houston Texans". Weekly's My Roster pipeline intentionally matches by
  exact name, and Weeks 2-18 DEF leaderboards already use the team code as
  both `name` and `team`.

  Normalize ONLY the Week 1 DEF rows at the unified Weekly boundary so the
  customer-facing identity is stable across all 18 weeks:

      ESPN HOU D/ST -> connected roster name HOU -> Weekly DEF name HOU

  Keep the source's full team name as displayName for any future UI that
  wants it. This does not change ADP, rank, recommendation, score, or order,
  and it leaves the Draft Command ADP endpoint untouched.
*/
function normalizeWeek1DefenseIdentity(positions) {
  const normalized = {
    ...(positions || {})
  };

  normalized.DEF = Array.isArray(normalized.DEF)
    ? normalized.DEF.map(function (row) {
        if (!row || !row.team) {
          return row;
        }

        const team = String(row.team).trim().toUpperCase();
        if (!team) {
          return row;
        }

        return {
          ...row,
          displayName: row.displayName || row.name || null,
          name: team,
          team
        };
      })
    : [];

  return normalized;
}

function normalizeInactiveRows(data, position) {
  return Array.isArray(data && data.inactive)
    ? data.inactive.map(function (row) {
        return {
          ...row,
          position: row.position || position,
          eligibleForWeeklyRanking: false,
          recommendation: "INELIGIBLE",
          sageTake: row.reason || "Unavailable for this week's lineup."
        };
      })
    : [];
}

function normalizePlayerName(value) {
  return String(value || "").trim().toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeAvailabilityStatus(value) {
  return String(value || "").trim().replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ").toUpperCase();
}

function easternClockParts(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now instanceof Date ? now : new Date(now));
  const values = {};
  parts.forEach(part => {
    if (part.type !== "literal") values[part.type] = part.value;
  });
  return {
    date: `${values.year}${values.month}${values.day}`,
    minuteOfDay: Number(values.hour) * 60 + Number(values.minute)
  };
}

function normalizeGameDate(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length >= 8) return digits.slice(0, 8);
  return null;
}

function gameMinuteOfDay(value) {
  const raw = String(value || "").trim().toLowerCase();
  const match = raw.match(/^(\d{1,2}):(\d{2})\s*([ap](?:m)?)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  const meridiem = match[3] && match[3][0];
  if (meridiem) {
    hour %= 12;
    if (meridiem === "p") hour += 12;
  }
  return hour * 60 + minute;
}

function hasGameStarted(row, now) {
  const gameDate = normalizeGameDate(row && row.gameDate);
  if (!gameDate) return false;
  const easternNow = easternClockParts(now || new Date());
  if (gameDate < easternNow.date) return true;
  if (gameDate > easternNow.date) return false;
  const kickoffMinute = gameMinuteOfDay(row && row.gameTime);
  return kickoffMinute !== null && easternNow.minuteOfDay >= kickoffMinute;
}

function removeStartedGames(positions, now) {
  const removed = [];
  const startedTeams = new Set();
  POSITIONS.forEach(position => {
    const rows = Array.isArray(positions[position]) ? positions[position] : [];
    rows.forEach(row => {
      if (!hasGameStarted(row, now)) return;
      const team = String(row.team || (position === "DEF" ? row.name : ""))
        .trim().toUpperCase();
      const opponent = String(row.opponent || "").trim().toUpperCase();
      if (team) startedTeams.add(team);
      if (opponent) startedTeams.add(opponent);
    });
  });
  POSITIONS.forEach(position => {
    const rows = Array.isArray(positions[position]) ? positions[position] : [];
    positions[position] = rows
      .filter(row => {
        const team = String(row.team || (position === "DEF" ? row.name : ""))
          .trim().toUpperCase();
        if (!hasGameStarted(row, now) && (!team || !startedTeams.has(team))) return true;
        removed.push({
          playerID: row.playerID || null,
          name: row.name || null,
          position,
          gameID: row.gameID || null,
          gameDate: row.gameDate || null,
          gameTime: row.gameTime || null
        });
        return false;
      })
      .map((row, index) => ({ ...row, rank: index + 1 }));
  });
  return removed;
}

function weeklyRecommendation(position, rank) {
  const positionRank = Number(rank);
  if (!Number.isFinite(positionRank) || positionRank < 1) return null;
  if (position === "QB" || position === "K" || position === "DEF") {
    return positionRank <= 12 ? "START" : "SIT";
  }
  if (position === "TE") {
    if (positionRank <= 12) return "START";
    return positionRank <= 24 ? "FLEX" : "SIT";
  }
  if (position === "RB" || position === "WR") {
    if (positionRank <= 24) return "START";
    return positionRank <= 48 ? "FLEX" : "SIT";
  }
  return null;
}

function scoringLabel(scoring) {
  const key = String(scoring || "").toLowerCase();
  if (key === "half" || key === "half-ppr" || key === "halfppr") return "Half-PPR";
  if (key === "ppr") return "PPR";
  if (key === "standard" || key === "std") return "Standard";
  return key ? key.toUpperCase() : "Selected-scoring";
}

function reconcileRankedRecommendations(positions, scoring) {
  POSITIONS.forEach(position => {
    const usesOwnSageTake = position === "K" || position === "DEF";
    positions[position] = (Array.isArray(positions[position]) ? positions[position] : [])
      .map((row, index) => {
        const rank = index + 1;
        const recommendation = weeklyRecommendation(position, rank);
        const reconciled = { ...row, rank, recommendation };
        if (usesOwnSageTake) return reconciled;
        const baseline = (row.sage && row.sage.baseline) || row.baseline || null;
        const baselineText = baseline && baseline.applied
          ? ` Early-season ${scoringLabel(scoring)} baseline weight: ${Math.round(baseline.weight * 100)}%; current-season evidence weight: ${Math.round((1 - baseline.weight) * 100)}%.`
          : "";
        return {
          ...reconciled,
          sageTake: `${buildWeek2PlusSageTake(reconciled) || row.sageTake || ""}${baselineText}`.trim()
        };
      });
  });
}

async function loadCentralAvailability() {
  try {
    const store = getStore({ name: "player-data" });
    const cached = await store.get("playerData", { type: "json" });
    const players = cached && cached.players && typeof cached.players === "object"
      ? cached.players
      : {};
    const byName = new Map();
    Object.entries(players).forEach(([playerID, player]) => {
      const key = normalizePlayerName(player && player.longName);
      if (key && !byName.has(key)) byName.set(key, { ...player, playerID });
    });
    const updatedAt = cached && cached.updatedAt ? cached.updatedAt : null;
    const ageHours = updatedAt && Number.isFinite(Date.parse(updatedAt))
      ? Math.max(0, (Date.now() - Date.parse(updatedAt)) / 3600000)
      : null;
    return {
      available: Object.keys(players).length > 0,
      updatedAt,
      ageHours,
      fresh: ageHours !== null && ageHours <= 8,
      playerCount: Object.keys(players).length,
      players,
      byName
    };
  } catch (error) {
    return {
      available: false, updatedAt: null, ageHours: null, fresh: false,
      playerCount: 0, players: {}, byName: new Map(), error: error.message
    };
  }
}

function applyCentralAvailability(positions, inactive, availability) {
  const applied = [];
  if (!availability || !availability.available) return applied;

  PLAYER_AVAILABILITY_POSITIONS.forEach(position => {
    const activeRows = Array.isArray(positions[position]) ? positions[position] : [];
    const inactiveRows = Array.isArray(inactive[position]) ? inactive[position] : [];
    const kept = [];

    activeRows.forEach(row => {
      const player = (row.playerID && availability.players[String(row.playerID)]) ||
        availability.byName.get(normalizePlayerName(row.name));
      const injury = player && player.injury && typeof player.injury === "object"
        ? player.injury
        : null;
      const status = normalizeAvailabilityStatus(injury && injury.designation);
      const description = injury && injury.description ? String(injury.description) : null;

      if (!status) {
        kept.push(row);
        return;
      }

      if (!HARD_UNAVAILABLE.has(status)) {
        kept.push({
          ...row,
          injuryStatus: status,
          injuryDescription: description,
          availabilitySource: "player-data"
        });
        return;
      }

      const alreadyInactive = inactiveRows.some(item =>
        (row.playerID && item.playerID && String(item.playerID) === String(row.playerID)) ||
        normalizePlayerName(item.name) === normalizePlayerName(row.name)
      );
      if (!alreadyInactive) {
        const reason = description
          ? `Current injury report: ${status} — ${description}.`
          : `Current injury report: ${status}.`;
        inactiveRows.push({
          ...row,
          status,
          eligibleForWeeklyRanking: false,
          recommendation: "INELIGIBLE",
          source: "player-data",
          reason,
          sageTake: reason
        });
      }
      applied.push({ playerID: row.playerID || null, name: row.name, position, status });
    });

    positions[position] = kept;
    inactive[position] = inactiveRows;
  });

  return applied;
}

async function fetchPositionLeaderboard({ baseUrl, position, season, week, seasonType, scoring }) {
  const functionName = LEADERBOARD_FUNCTION_BY_POSITION[position];
  const url =
    `${baseUrl}/.netlify/functions/${functionName}` +
    `?${new URLSearchParams({
      season,
      week: String(week),
      seasonType,
      scoring
    }).toString()}`;

  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" }
    });
  } catch (error) {
    return {
      ok: false,
      error: `${position} leaderboard request failed: ${error && error.message}`
    };
  }

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }

  if (!response.ok || !data) {
    const detail =
      (data && (data.detail || data.error)) || `HTTP ${response.status}`;
    return {
      ok: false,
      error: `${position} leaderboard unavailable: ${detail}`
    };
  }

  return { ok: true, data };
}

exports.handler = async function (event) {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  connectLambda(event);

  const query = event.queryStringParameters || {};
  const season = String(query.season || new Date().getFullYear());
  const targetWeek = Number(query.week);
  const seasonType = String(query.seasonType || DEFAULT_SEASON_TYPE);
  const scoring = String(query.scoring || "ppr").toLowerCase();

  if (!Number.isInteger(targetWeek) || targetWeek < 1 || targetWeek > 18) {
    return jsonResponse(400, {
      error: "week must be an integer from 1 through 18."
    });
  }

  if (!["reg", "pre", "post", "all"].includes(seasonType)) {
    return jsonResponse(400, {
      error: "seasonType must be reg, pre, post, or all."
    });
  }

  let baseUrl;
  try {
    baseUrl = getBaseUrl(event);
  } catch (error) {
    return jsonResponse(500, { error: error.message });
  }

  if (targetWeek === 1) {
    const scoring = String(query.scoring || "ppr");
    const teams = String(query.teams || "12");
    const url =
      `${baseUrl}/.netlify/functions/weekly-sage-week1-rankings` +
      `?${new URLSearchParams({
        season,
        week: "1",
        seasonType,
        scoring,
        teams
      }).toString()}`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" }
      });

      const data = await response.json();

      if (!response.ok) {
        return jsonResponse(502, {
          error: "Week 1 rankings could not be produced.",
          detail: data.detail || data.error || `HTTP ${response.status}`
        });
      }

      return jsonResponse(200, {
        evidenceType: "weekly-sage-rankings",
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        season,
        targetWeek,
        seasonType,
        scoring,
        teams: Number(teams),
        positions: normalizeWeek1DefenseIdentity(data.positions),
        failures: data.failures,
        metadata: {
          ...data.metadata,
          route: "week1-adp-baseline",
          defenseIdentity: "canonical-nfl-team-code"
        }
      });
    } catch (error) {
      return jsonResponse(502, {
        error: "Week 1 rankings could not be produced.",
        detail: error && error.message
      });
    }
  }

  const results = await Promise.all(
    POSITIONS.map(position =>
      fetchPositionLeaderboard({
        baseUrl,
        position,
        season,
        week: targetWeek,
        seasonType,
        scoring
      })
    )
  );

  const positions = {};
  const inactive = {};
  const failures = {};
  let successCount = 0;

  POSITIONS.forEach((position, index) => {
    const result = results[index];
    if (result.ok) {
      const leaderboard = Array.isArray(result.data.leaderboard)
        ? result.data.leaderboard
        : [];

      const usesOwnSageTake = position === "K" || position === "DEF";
      positions[position] = leaderboard.map((row) => {
        const earlySeasonBaseline =
          (row.sage && row.sage.baseline) ||
          row.baseline ||
          null;

        return {
          ...row,
          sageTake:
            (position === "RB" || position === "WR") &&
            earlySeasonBaseline &&
            earlySeasonBaseline.applied
              ? `${buildWeek2PlusSageTake(row)} Early-season ${earlySeasonBaseline.scoring.toUpperCase()} baseline weight: ${Math.round(earlySeasonBaseline.weight * 100)}%; current-season evidence weight: ${Math.round((1 - earlySeasonBaseline.weight) * 100)}%.`
              : usesOwnSageTake
                ? row.sageTake
                : buildWeek2PlusSageTake(row)
        };
      });

      inactive[position] = normalizeInactiveRows(result.data, position);

      failures[position] = [];
      successCount++;
    } else {
      positions[position] = [];
      inactive[position] = [];
      failures[position] = [result.error];
    }
  });

  const centralAvailability = await loadCentralAvailability();
  const availabilityExclusions = applyCentralAvailability(
    positions,
    inactive,
    centralAvailability
  );
  const startedGameExclusions = removeStartedGames(positions, new Date());
  reconcileRankedRecommendations(positions, scoring);

  if (successCount === 0) {
    return jsonResponse(502, {
      evidenceType: "weekly-sage-rankings",
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      season,
      targetWeek,
      seasonType,
      error: "No positional leaderboard could be produced for this week.",
      positions,
      failures
    });
  }

  return jsonResponse(200, {
    evidenceType: "weekly-sage-rankings",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    season,
    targetWeek,
    seasonType,
    scoring,

    positions,

    inactive,

    failures,

    metadata: {
      positionsRequested: POSITIONS,
      positionsSucceeded: POSITIONS.filter((_, i) => results[i].ok),
      positionsFailed: POSITIONS.filter((_, i) => !results[i].ok),
      availability: {
        source: "cached Tank01 team rosters",
        available: centralAvailability.available,
        updatedAt: centralAvailability.updatedAt,
        ageHours: centralAvailability.ageHours === null
          ? null
          : Number(centralAvailability.ageHours.toFixed(2)),
        fresh: centralAvailability.fresh,
        freshnessThresholdHours: 8,
        playerCount: centralAvailability.playerCount,
        exclusionsApplied: availabilityExclusions.length,
        positionsCovered: Array.from(PLAYER_AVAILABILITY_POSITIONS),
        note: centralAvailability.fresh
          ? "Current cached injury data enforced across offensive positions and kicker."
          : "Injury cache is stale or unavailable; verify late-breaking game statuses."
      },
      gameEligibility: {
        rule: "Players and team defenses leave actionable rankings at scheduled kickoff.",
        timeZone: "America/New_York",
        exclusionsApplied: startedGameExclusions.length,
        excluded: startedGameExclusions
      },
      rankingGuardrails: {
        ...RANKING_GUARDRAIL_POLICY,
        purpose:
          "Weekly QA benchmark across every position. Competitor rankings do not enter SAGE scores or silently rewrite rankings.",
        enforcement:
          "Outliers require an explicit injury, role, usage, matchup, or freshness explanation before approval."
      },
      note:
        "Each position's leaderboard array is unmodified from its own weekly-sage-<pos>-leaderboard output -- scores, order, and recommendations are not recalculated here. Positions are not merged into one cross-position rank."
    }
  });
};

exports.normalizeInactiveRows = normalizeInactiveRows;
exports.normalizePlayerName = normalizePlayerName;
exports.normalizeAvailabilityStatus = normalizeAvailabilityStatus;
exports.applyCentralAvailability = applyCentralAvailability;
exports.normalizeGameDate = normalizeGameDate;
exports.gameMinuteOfDay = gameMinuteOfDay;
exports.hasGameStarted = hasGameStarted;
exports.removeStartedGames = removeStartedGames;
exports.weeklyRecommendation = weeklyRecommendation;
exports.scoringLabel = scoringLabel;
exports.reconcileRankedRecommendations = reconcileRankedRecommendations;
