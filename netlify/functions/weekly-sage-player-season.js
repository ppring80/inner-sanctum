// netlify/functions/weekly-sage-player-season.js
//
// WEEKLY SAGE — PLAYER SEASON-TO-DATE EVIDENCE
//
// PURPOSE
// -------
// Build a player's production + usage evidence entering a target week.
//
// Example:
//   ?season=2025&week=8&playerID=4430807
//
// CRITICAL NO-LOOK-AHEAD RULE
// ---------------------------
// Target Week 8 may use ONLY Weeks 1-7.
// The target week's game must never be included.
//
// This function:
// - resolves player information from Tank01
// - retrieves prior weekly player game stats
// - aggregates season-to-date production
// - exposes position-relevant usage metrics
//
// This function DOES NOT:
// - calculate defensive matchup scores
// - produce START/SIT recommendations
// - calculate a final SAGE player score
// - modify weekly.html
//
// ═══════════════════════════════════════════════════════════════════════

const TANK01_HOST =
  "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";

const DEFAULT_SEASON_TYPE = "reg";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round(value, digits = 2) {
  const factor =
    Math.pow(10, digits);

  return (
    Math.round(
      (num(value) + Number.EPSILON) *
      factor
    ) / factor
  );
}

function tank01Headers() {
  return {
    "Content-Type": "application/json",
    "x-rapidapi-host": TANK01_HOST,
    "x-rapidapi-key":
      process.env.TANK01_API_KEY
  };
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
    const detail =
      data &&
      (
        data.message ||
        data.error
      )
        ? (
            data.message ||
            data.error
          )
        : `HTTP ${response.status}`;

    throw new Error(
      `Tank01 ${endpoint} failed: ${detail}`
    );
  }

  return data;
}

function normalizePosition(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function extractPlayerInfo(data) {
  if (!data) {
    return null;
  }

  if (
    data.body &&
    !Array.isArray(data.body)
  ) {
    return data.body;
  }

  if (
    Array.isArray(data.body) &&
    data.body.length
  ) {
    return data.body[0];
  }

  return null;
}

function extractGames(data) {
  if (!data) {
    return [];
  }

  if (Array.isArray(data.body)) {
    return data.body;
  }

  if (
    data.body &&
    Array.isArray(data.body.games)
  ) {
    return data.body.games;
  }

  if (
    data.body &&
    Array.isArray(
      data.body.gameStats
    )
  ) {
    return data.body.gameStats;
  }

  return [];
}

function statBlock(
  game,
  key
) {
  if (
    !game ||
    !game[key] ||
    typeof game[key] !== "object"
  ) {
    return {};
  }

  return game[key];
}

function passingStats(game) {
  const stats =
    statBlock(
      game,
      "Passing"
    );

  return {
    attempts:
      num(
        stats.passAttempts ??
        stats.attempts
      ),

    completions:
      num(
        stats.passCompletions ??
        stats.completions
      ),

    yards:
      num(
        stats.passYds ??
        stats.passYards
      ),

    touchdowns:
      num(
        stats.passTD ??
        stats.passTouchdowns
      ),

    interceptions:
      num(
        stats.int ??
        stats.passInterceptions ??
        stats.interceptions
      )
  };
}

function rushingStats(game) {
  const stats =
    statBlock(
      game,
      "Rushing"
    );

  return {
    carries:
      num(
        stats.carries ??
        stats.rushAttempts
      ),

    yards:
      num(
        stats.rushYds ??
        stats.rushYards
      ),

    touchdowns:
      num(
        stats.rushTD ??
        stats.rushTouchdowns
      )
  };
}

function receivingStats(game) {
  const stats =
    statBlock(
      game,
      "Receiving"
    );

  return {
    targets:
      num(
        stats.targets
      ),

    receptions:
      num(
        stats.receptions ??
        stats.rec
      ),

    yards:
      num(
        stats.recYds ??
        stats.receivingYards
      ),

    touchdowns:
      num(
        stats.recTD ??
        stats.receivingTD
      )
  };
}

function aggregateGames(games) {
  const totals = {
    games: 0,

    passing: {
      attempts: 0,
      completions: 0,
      yards: 0,
      touchdowns: 0,
      interceptions: 0
    },

    rushing: {
      carries: 0,
      yards: 0,
      touchdowns: 0
    },

    receiving: {
      targets: 0,
      receptions: 0,
      yards: 0,
      touchdowns: 0
    }
  };

  for (const game of games) {
    const passing =
      passingStats(game);

    const rushing =
      rushingStats(game);

    const receiving =
      receivingStats(game);

    totals.games += 1;

    for (
      const key of
      Object.keys(totals.passing)
    ) {
      totals.passing[key] +=
        passing[key];
    }

    for (
      const key of
      Object.keys(totals.rushing)
    ) {
      totals.rushing[key] +=
        rushing[key];
    }

    for (
      const key of
      Object.keys(totals.receiving)
    ) {
      totals.receiving[key] +=
        receiving[key];
    }
  }

  return totals;
}

function buildDerived(totals) {
  const games =
    totals.games;

  const passAttempts =
    totals.passing.attempts;

  const carries =
    totals.rushing.carries;

  const targets =
    totals.receiving.targets;

  const receptions =
    totals.receiving.receptions;

  return {
    passing: {
      attemptsPerGame:
        games
          ? round(
              passAttempts / games
            )
          : 0,

      yardsPerGame:
        games
          ? round(
              totals.passing.yards /
              games
            )
          : 0,

      yardsPerAttempt:
        passAttempts
          ? round(
              totals.passing.yards /
              passAttempts
            )
          : 0,

      completionPct:
        passAttempts
          ? round(
              (
                totals.passing
                  .completions /
                passAttempts
              ) * 100,
              1
            )
          : 0,

      touchdownsPerGame:
        games
          ? round(
              totals.passing
                .touchdowns /
              games
            )
          : 0,

      interceptionsPerGame:
        games
          ? round(
              totals.passing
                .interceptions /
              games
            )
          : 0
    },

    rushing: {
      carriesPerGame:
        games
          ? round(
              carries / games
            )
          : 0,

      yardsPerGame:
        games
          ? round(
              totals.rushing.yards /
              games
            )
          : 0,

      yardsPerCarry:
        carries
          ? round(
              totals.rushing.yards /
              carries
            )
          : 0,

      touchdownsPerGame:
        games
          ? round(
              totals.rushing
                .touchdowns /
              games
            )
          : 0
    },

    receiving: {
      targetsPerGame:
        games
          ? round(
              targets / games
            )
          : 0,

      receptionsPerGame:
        games
          ? round(
              receptions / games
            )
          : 0,

      yardsPerGame:
        games
          ? round(
              totals.receiving.yards /
              games
            )
          : 0,

      yardsPerTarget:
        targets
          ? round(
              totals.receiving.yards /
              targets
            )
          : 0,

      yardsPerReception:
        receptions
          ? round(
              totals.receiving.yards /
              receptions
            )
          : 0,

      catchRate:
        targets
          ? round(
              (
                receptions /
                targets
              ) * 100,
              1
            )
          : 0,

      touchdownsPerGame:
        games
          ? round(
              totals.receiving
                .touchdowns /
              games
            )
          : 0
    }
  };
}

function buildUsageProfile(
  position,
  totals,
  derived
) {
  switch (position) {
    case "QB":
      return {
        passAttemptsPerGame:
          derived.passing
            .attemptsPerGame,

        passYardsPerGame:
          derived.passing
            .yardsPerGame,

        yardsPerAttempt:
          derived.passing
            .yardsPerAttempt,

        passTDPerGame:
          derived.passing
            .touchdownsPerGame,

        interceptionsPerGame:
          derived.passing
            .interceptionsPerGame,

        carriesPerGame:
          derived.rushing
            .carriesPerGame,

        rushYardsPerGame:
          derived.rushing
            .yardsPerGame
      };

    case "RB":
      return {
        carriesPerGame:
          derived.rushing
            .carriesPerGame,

        rushYardsPerGame:
          derived.rushing
            .yardsPerGame,

        yardsPerCarry:
          derived.rushing
            .yardsPerCarry,

        rushTDPerGame:
          derived.rushing
            .touchdownsPerGame,

        targetsPerGame:
          derived.receiving
            .targetsPerGame,

        receptionsPerGame:
          derived.receiving
            .receptionsPerGame,

        receivingYardsPerGame:
          derived.receiving
            .yardsPerGame
      };

    case "WR":
    case "TE":
      return {
        targetsPerGame:
          derived.receiving
            .targetsPerGame,

        receptionsPerGame:
          derived.receiving
            .receptionsPerGame,

        receivingYardsPerGame:
          derived.receiving
            .yardsPerGame,

        yardsPerTarget:
          derived.receiving
            .yardsPerTarget,

        yardsPerReception:
          derived.receiving
            .yardsPerReception,

        catchRate:
          derived.receiving
            .catchRate,

        receivingTDPerGame:
          derived.receiving
            .touchdownsPerGame,

        carriesPerGame:
          derived.rushing
            .carriesPerGame,

        rushYardsPerGame:
          derived.rushing
            .yardsPerGame
      };

    default:
      return {};
  }
}

function gameWeekNumber(game) {
  const candidates = [
    game.gameWeek,
    game.week,
    game.gameWeekNumber
  ];

  for (
    const candidate of
    candidates
  ) {
    if (
      candidate === undefined ||
      candidate === null
    ) {
      continue;
    }

    const match =
      String(candidate)
        .match(/\d+/);

    if (match) {
      return Number(match[0]);
    }
  }

  return null;
}

function filterPriorGames(
  games,
  targetWeek
) {
  return games.filter(game => {
    const week =
      gameWeekNumber(game);

    if (week === null) {
      return false;
    }

    return (
      week >= 1 &&
      week < targetWeek
    );
  });
}

function compactGame(game) {
  return {
    gameID:
      game.gameID ||
      null,

    week:
      gameWeekNumber(game),

    opponent:
      game.opponent ||
      game.opp ||
      null,

    Passing:
      game.Passing ||
      null,

    Rushing:
      game.Rushing ||
      null,

    Receiving:
      game.Receiving ||
      null
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

    const targetWeek =
      Number(
        query.week
      );

    const playerID =
      String(
        query.playerID ||
        ""
      ).trim();

    const seasonType =
      String(
        query.seasonType ||
        DEFAULT_SEASON_TYPE
      );

    if (
      !Number.isInteger(
        targetWeek
      ) ||
      targetWeek < 1 ||
      targetWeek > 18
    ) {
      return jsonResponse(
        400,
        {
          error:
            "week must be an integer from 1 through 18."
        }
      );
    }

    if (!playerID) {
      return jsonResponse(
        400,
        {
          error:
            "playerID is required."
        }
      );
    }

    try {
      /*
        We already validated getNFLPlayerInfo earlier in the
        Weekly SAGE work, so player identity stays on the
        same Tank01 data path.
      */
      const playerInfoResult =
        await tank01Fetch(
          "getNFLPlayerInfo",
          {
            playerID
          }
        );

      const player =
        extractPlayerInfo(
          playerInfoResult
        );

      if (!player) {
        return jsonResponse(
          404,
          {
            error:
              "Player not found.",

            playerID
          }
        );
      }

      /*
        Tank01's player game stats endpoint.

        IMPORTANT:
        We intentionally retrieve the season and then enforce
        targetWeek exclusion ourselves below.

        That makes the no-look-ahead rule visible and testable
        in our own code rather than trusting an implicit API
        behavior.
      */
      const gameStatsResult =
        await tank01Fetch(
          "getNFLGamesForPlayer",
          {
            playerID,
            season,
            seasonType
          }
        );

      const allGames =
        extractGames(
          gameStatsResult
        );

      const priorGames =
        filterPriorGames(
          allGames,
          targetWeek
        );

      const totals =
        aggregateGames(
          priorGames
        );

      const derived =
        buildDerived(
          totals
        );

      const position =
        normalizePosition(
          player.pos ||
          player.position
        );

      const usageProfile =
        buildUsageProfile(
          position,
          totals,
          derived
        );

      const weeksIncluded =
        priorGames
          .map(gameWeekNumber)
          .filter(
            week =>
              Number.isInteger(
                week
              )
          )
          .sort(
            (a, b) => a - b
          );

      return jsonResponse(
        200,
        {
          evidenceType:
            "weekly-sage-player-season",

          schemaVersion: 1,

          generatedAt:
            new Date()
              .toISOString(),

          season,

          targetWeek,

          seasonType,

          player: {
            playerID,

            name:
              player.longName ||
              player.name ||
              null,

            team:
              player.team ||
              player.teamAbv ||
              null,

            position
          },

          noLookAhead: {
            rule:
              `Only games before Week ${targetWeek} are included.`,

            weeksIncluded,

            targetWeekExcluded:
              !weeksIncluded.includes(
                targetWeek
              )
          },

          gamesUsed:
            priorGames.length,

          totals,

          perGame:
            derived,

          usageProfile,

          /*
            Keep compact source games for diagnostics.
            This makes validation much easier before we
            trust the aggregation in SAGE.
          */
          sourceGames:
            priorGames.map(
              compactGame
            )
        },

        CACHE_CONTROL
      );
    } catch (error) {
      console.error(
        "weekly-sage-player-season failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not build Weekly SAGE player season evidence.",

          detail:
            error.message
        }
      );
    }
  };
