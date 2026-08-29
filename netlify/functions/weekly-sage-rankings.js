// netlify/functions/weekly-sage-rankings.js
//
// WEEKLY SAGE — UNIFIED WEEKLY RANKINGS ENDPOINT
//
// PURPOSE
// -------
// The ONE customer-facing entry point for Weekly Rankings. Fetches
// the four existing, already-validated positional leaderboards
// (weekly-sage-qb-leaderboard, -rb-leaderboard, -wr-leaderboard,
// -te-leaderboard) and returns them combined under one normalized
// response shape.
//
// This function does NOT:
// - recalculate any score
// - alter ranking/order within a position
// - change any recommendation (START/FLEX/SIT)
// - merge positions into one cross-position rank
// - call Tank01 directly
// - rebuild any snapshot
//
// Each position's leaderboard array is passed through EXACTLY as that
// leaderboard already produced it -- this file only fans out to the
// four existing endpoints and reshapes the four responses into one
// envelope. The only addition made here is a new sageTake field per
// player (see sage-take.js) -- a deterministic, read-only explanation
// string built from fields the leaderboard already returned. It never
// alters score, order, recommendation, confidence, matchup, role, or
// production, and any failure producing it yields null rather than
// blocking the response.
//
// FAILURE PHILOSOPHY
// -------------------
// If a given position's leaderboard cannot be produced (its own
// cache is missing/stale, etc.), that position's `positions.<POS>`
// array is empty and the specific error is reported under
// `failures.<POS>` -- it is NEVER silently replaced with an empty
// array that looks like "zero eligible players this week." The
// overall HTTP response still returns 200 as long as AT LEAST ONE
// position succeeded, since a partial Weekly Rankings page (e.g. "QB
// data is temporarily unavailable, but RB/WR/TE are ready") is more
// useful to a customer than an all-or-nothing failure. If ALL FOUR
// positions fail, the response is a clear 502 -- never a fabricated
// "empty rankings" 200.
//
// Example:
// /.netlify/functions/weekly-sage-rankings?season=2025&week=8
//
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_SEASON_TYPE = "reg";

const {
  buildWeek2PlusSageTake
} = require(
  "./sage-take.js"
);

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

const POSITIONS = ["QB", "RB", "WR", "TE"];

const LEADERBOARD_FUNCTION_BY_POSITION = {
  QB: "weekly-sage-qb-leaderboard",
  RB: "weekly-sage-rb-leaderboard",
  WR: "weekly-sage-wr-leaderboard",
  TE: "weekly-sage-te-leaderboard"
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
        positions: data.positions,
        failures: data.failures,
        metadata: {
          ...data.metadata,
          route: "week1-adp-baseline"
        }
      });
    } catch (error) {
      return jsonResponse(502, {
        error: "Week 1 rankings could not be produced.",
        detail: error && error.message
      });
    }
  }

  // Fetch all four positional leaderboards in parallel. Each is
  // completely independent -- one position's failure never blocks or
  // alters another's result.
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
      // Passed through EXACTLY as the positional leaderboard produced
      // it -- this file never touches score, order, or recommendation
      // fields within a position's own leaderboard array.
      const leaderboard = Array.isArray(result.data.leaderboard)
        ? result.data.leaderboard
        : [];

      // Deterministic explanation layer -- see sage-take.js. This
      // .map() only ADDS a new sageTake field to each existing
      // element, in place, at its existing index. It never filters,
      // sorts, splices, or otherwise changes array length or order,
      // and it never touches sageScore, recommendation, confidence,
      // matchup, role, or production. Any failure inside
      // buildWeek2PlusSageTake() is caught internally and yields
      // null -- it can never throw here.
      positions[position] = leaderboard.map((row) => ({
        ...row,
        sageTake: buildWeek2PlusSageTake(row)
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
