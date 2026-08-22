// netlify/functions/weekly-sage-schedule.js
//
// WEEKLY SAGE — WEEKLY SCHEDULE EVIDENCE
//
// PURPOSE
// -------
// Provide one normalized, reusable Weekly SAGE schedule endpoint.
//
// This function wraps Tank01:
//   getNFLGamesForWeek
//
// It returns scheduled, in-progress, and completed games.
// That matters because Weekly SAGE must know NEXT WEEK'S opponent
// before the game has been played.
//
// It does NOT:
// - calculate matchup scores
// - calculate player recommendations
// - modify weekly.html
// - call box scores
//
// Example:
// /.netlify/functions/weekly-sage-schedule?season=2025&week=8
//
// ═══════════════════════════════════════════════════════════════════════

const TANK01_HOST =
  "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";

const DEFAULT_SEASON_TYPE = "reg";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

function tank01Headers() {
  return {
    "Content-Type": "application/json",
    "x-rapidapi-host": TANK01_HOST,
    "x-rapidapi-key": process.env.TANK01_API_KEY
  };
}

function normalizeTeam(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

async function tank01Fetch(
  endpoint,
  params
) {
  const query =
    new URLSearchParams(
      params || {}
    ).toString();

  const url =
    `https://${TANK01_HOST}/${endpoint}` +
    (query ? `?${query}` : "");

  const response =
    await fetch(url, {
      method: "GET",
      headers: tank01Headers()
    });

  let data = null;

  try {
    data =
      await response.json();
  } catch (error) {
    data = null;
  }

  if (!response.ok) {
    let message =
      `Tank01 ${endpoint} failed with HTTP ${response.status}`;

    if (
      data &&
      data.message
    ) {
      message =
        data.message;
    } else if (
      data &&
      data.body &&
      typeof data.body === "string"
    ) {
      message =
        data.body;
    }

    throw new Error(message);
  }

  return data;
}

function normalizeGame(game) {
  return {
    gameID:
      game.gameID || null,

    season:
      game.season || null,

    seasonType:
      game.seasonType || null,

    gameWeek:
      game.gameWeek || null,

    gameDate:
      game.gameDate || null,

    gameTime:
      game.gameTime || null,

    gameTime_epoch:
      game.gameTime_epoch || null,

    gameStatus:
      game.gameStatus || null,

    gameStatusCode:
      game.gameStatusCode || null,

    away:
      normalizeTeam(
        game.away
      ),

    home:
      normalizeTeam(
        game.home
      ),

    teamIDAway:
      game.teamIDAway || null,

    teamIDHome:
      game.teamIDHome || null,

    neutralSite:
      game.neutralSite || null,

    espnID:
      game.espnID || null
  };
}

function jsonResponse(
  statusCode,
  body,
  cacheControl
) {
  return {
    statusCode,

    headers: {
      "Content-Type":
        "application/json",

      "Cache-Control":
        cacheControl || "no-store"
    },

    body:
      JSON.stringify(
        body,
        null,
        2
      )
  };
}

exports.handler =
  async function (event) {
    if (
      event.httpMethod &&
      event.httpMethod !== "GET"
    ) {
      return jsonResponse(
        405,
        {
          error:
            "Method not allowed."
        }
      );
    }

    if (
      !process.env.TANK01_API_KEY
    ) {
      return jsonResponse(
        500,
        {
          error:
            "TANK01_API_KEY is not configured."
        }
      );
    }

    const query =
      event.queryStringParameters ||
      {};

    const season =
      String(
        query.season ||
        new Date().getFullYear()
      );

    const week =
      Number(
        query.week
      );

    const seasonType =
      String(
        query.seasonType ||
        DEFAULT_SEASON_TYPE
      );

    if (
      !Number.isInteger(week) ||
      week < 1 ||
      week > 18
    ) {
      return jsonResponse(
        400,
        {
          error:
            "week must be an integer from 1 through 18."
        }
      );
    }

    if (
      ![
        "reg",
        "pre",
        "post",
        "all"
      ].includes(
        seasonType
      )
    ) {
      return jsonResponse(
        400,
        {
          error:
            "seasonType must be reg, pre, post, or all."
        }
      );
    }

    try {
      const result =
        await tank01Fetch(
          "getNFLGamesForWeek",
          {
            week:
              String(week),

            season:
              String(season),

            seasonType
          }
        );

      const rawGames =
        Array.isArray(
          result.body
        )
          ? result.body
          : [];

      const games =
        rawGames.map(
          normalizeGame
        );

      return jsonResponse(
        200,
        {
          evidenceType:
            "weekly-sage-schedule",

          schemaVersion: 1,

          generatedAt:
            new Date()
              .toISOString(),

          season,

          week,

          seasonType,

          gamesReturned:
            games.length,

          games
        },

        CACHE_CONTROL
      );
    } catch (error) {
      console.error(
        "weekly-sage-schedule failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not retrieve Weekly SAGE schedule evidence.",

          detail:
            error.message
        }
      );
    }
  };
