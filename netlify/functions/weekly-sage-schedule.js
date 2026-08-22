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
// REGULAR-SEASON TEAM STATE
// -------------------------
// This endpoint also identifies:
//
//   activeTeams
//     Teams appearing in a game during the requested week.
//
//   byeTeams
//     NFL teams not appearing in a game during the requested
//     regular-season week.
//
// This centralizes bye-week knowledge so downstream SAGE
// functions do not have to infer or hard-code bye logic.
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

const DEFAULT_SEASON_TYPE =
  "reg";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

/*
  Canonical NFL team abbreviations.

  Used only to determine regular-season bye teams.

  Keep this list centralized here rather than duplicating
  bye logic across RB / WR / QB / TE SAGE functions.
*/
const NFL_TEAMS = [
  "ARI",
  "ATL",
  "BAL",
  "BUF",
  "CAR",
  "CHI",
  "CIN",
  "CLE",
  "DAL",
  "DEN",
  "DET",
  "GB",
  "HOU",
  "IND",
  "JAX",
  "KC",
  "LV",
  "LAC",
  "LAR",
  "MIA",
  "MIN",
  "NE",
  "NO",
  "NYG",
  "NYJ",
  "PHI",
  "PIT",
  "SEA",
  "SF",
  "TB",
  "TEN",
  "WSH"
];

function tank01Headers() {
  return {
    "Content-Type":
      "application/json",

    "x-rapidapi-host":
      TANK01_HOST,

    "x-rapidapi-key":
      process.env.TANK01_API_KEY
  };
}

function normalizeTeam(value) {
  const raw =
    String(
      value || ""
    )
      .trim()
      .toUpperCase();

  /*
    Normalize common alternate abbreviations in case an
    upstream source uses one of them.
  */
  const aliases = {
    JAC: "JAX",
    GBP: "GB",
    KAN: "KC",
    LVR: "LV",
    NEP: "NE",
    NOR: "NO",
    SFO: "SF",
    TBB: "TB",
    WAS: "WSH"
  };

  return (
    aliases[raw] ||
    raw
  );
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
    (
      query
        ? `?${query}`
        : ""
    );

  const response =
    await fetch(
      url,
      {
        method: "GET",

        headers:
          tank01Headers()
      }
    );

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
      typeof data.body ===
        "string"
    ) {
      message =
        data.body;
    }

    throw new Error(
      message
    );
  }

  return data;
}

function normalizeGame(game) {
  return {
    gameID:
      game.gameID ||
      null,

    season:
      game.season ||
      null,

    seasonType:
      game.seasonType ||
      null,

    gameWeek:
      game.gameWeek ||
      null,

    gameDate:
      game.gameDate ||
      null,

    gameTime:
      game.gameTime ||
      null,

    gameTime_epoch:
      game.gameTime_epoch ||
      null,

    gameStatus:
      game.gameStatus ||
      null,

    gameStatusCode:
      game.gameStatusCode ||
      null,

    away:
      normalizeTeam(
        game.away
      ),

    home:
      normalizeTeam(
        game.home
      ),

    teamIDAway:
      game.teamIDAway ||
      null,

    teamIDHome:
      game.teamIDHome ||
      null,

    neutralSite:
      game.neutralSite ||
      null,

    espnID:
      game.espnID ||
      null
  };
}

/*
  Return all unique teams participating in this week's games.
*/
function buildActiveTeams(games) {
  const teams =
    new Set();

  for (
    const game of games
  ) {
    const away =
      normalizeTeam(
        game.away
      );

    const home =
      normalizeTeam(
        game.home
      );

    if (away) {
      teams.add(away);
    }

    if (home) {
      teams.add(home);
    }
  }

  return Array
    .from(teams)
    .sort();
}

/*
  Bye calculation is meaningful for the regular season only.

  A team absent from the complete regular-season weekly
  schedule is on bye.

  We intentionally do NOT apply this rule to preseason,
  postseason, or seasonType=all because absence there does
  not mean "bye" in the normal NFL regular-season sense.
*/
function buildByeTeams(
  activeTeams,
  seasonType
) {
  if (
    seasonType !== "reg"
  ) {
    return [];
  }

  const active =
    new Set(
      activeTeams.map(
        normalizeTeam
      )
    );

  return NFL_TEAMS
    .filter(
      team =>
        !active.has(team)
    )
    .sort();
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
        cacheControl ||
        "no-store"
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
      event.httpMethod !==
        "GET"
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
      !process.env
        .TANK01_API_KEY
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
      event
        .queryStringParameters ||
      {};

    const season =
      String(
        query.season ||
        new Date()
          .getFullYear()
      );

    const week =
      Number(
        query.week
      );

    const seasonType =
      String(
        query.seasonType ||
        DEFAULT_SEASON_TYPE
      )
        .trim()
        .toLowerCase();

    if (
      !Number.isInteger(
        week
      ) ||
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

      /*
        NEW:
        Derive weekly team-state once here so every downstream
        SAGE layer consumes the same answer.
      */
      const activeTeams =
        buildActiveTeams(
          games
        );

      const byeTeams =
        buildByeTeams(
          activeTeams,
          seasonType
        );

      return jsonResponse(
        200,
        {
          evidenceType:
            "weekly-sage-schedule",

          schemaVersion:
            2,

          generatedAt:
            new Date()
              .toISOString(),

          season,

          week,

          seasonType,

          gamesReturned:
            games.length,

          activeTeamsReturned:
            activeTeams.length,

          byeTeamsReturned:
            byeTeams.length,

          /*
            True only for regular-season requests because that
            is where absence from the weekly NFL schedule means
            a normal scheduled bye.
          */
          byeClassificationAvailable:
            seasonType === "reg",

          /*
            Helpful explanation for downstream consumers.
          */
          teamState: {
            rule:
              seasonType === "reg"
                ? "Teams appearing in the requested week's games are active. NFL teams absent from the complete regular-season weekly schedule are classified as bye teams."
                : "Bye classification is not applied outside regular-season requests.",

            nflTeamCount:
              NFL_TEAMS.length,

            scheduledTeamCount:
              activeTeams.length,

            byeTeamCount:
              byeTeams.length
          },

          activeTeams,

          byeTeams,

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
