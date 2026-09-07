// netlify/functions/weekly-sage-rankings.js
//
// WEEKLY SAGE — UNIFIED WEEKLY RANKINGS ENDPOINT
//
// Customer-facing entry point for Weekly Rankings. It combines the
// position-specific leaderboards without recalculating their scores,
// order, or recommendations.

const DEFAULT_SEASON_TYPE = "reg";

const {
  buildWeek2PlusSageTake
} = require(
  "./sage-take.js"
);

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];

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

async function fetchPositionLeaderboard({ baseUrl, position, season, week, seasonType }) {
  const functionName = LEADERBOARD_FUNCTION_BY_POSITION[position];
  const url =
    `${baseUrl}/.netlify/functions/${functionName}` +
    `?${new URLSearchParams({ season, week: String(week), seasonType }).toString()}`;

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

  const query = event.queryStringParameters || {};
  const season = String(query.season || new Date().getFullYear());
  const targetWeek = Number(query.week);
  const seasonType = String(query.seasonType || DEFAULT_SEASON_TYPE);

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
      fetchPositionLeaderboard({ baseUrl, position, season, week: targetWeek, seasonType })
    )
  );

  const positions = {};
  const failures = {};
  let successCount = 0;

  POSITIONS.forEach((position, index) => {
    const result = results[index];
    if (result.ok) {
      const leaderboard = Array.isArray(result.data.leaderboard)
        ? result.data.leaderboard
        : [];

      const usesOwnSageTake = position === "K" || position === "DEF";
      positions[position] = leaderboard.map((row) => ({
        ...row,
        sageTake: usesOwnSageTake ? row.sageTake : buildWeek2PlusSageTake(row)
      }));

      failures[position] = [];
      successCount++;
    } else {
      positions[position] = [];
      failures[position] = [result.error];
    }
  });

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

    positions,

    failures,

    metadata: {
      positionsRequested: POSITIONS,
      positionsSucceeded: POSITIONS.filter((_, i) => results[i].ok),
      positionsFailed: POSITIONS.filter((_, i) => !results[i].ok),
      note:
        "Each position's leaderboard array is unmodified from its own weekly-sage-<pos>-leaderboard output -- scores, order, and recommendations are not recalculated here. Positions are not merged into one cross-position rank."
    }
  });
};
