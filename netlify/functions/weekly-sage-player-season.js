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
// Tank01 getNFLGamesForPlayer returns:
//
//   body: {
//     "GAME_ID": { player game stats },
//     ...
//   }
//
// Those objects do NOT contain NFL week numbers.
//
// Therefore:
//
//   getNFLGamesForPlayer
//          +
//   weekly-sage-schedule for Weeks 1 through targetWeek - 1
//
// are joined by gameID.
//
// This makes our own schedule layer the authoritative source for the
// no-look-ahead boundary.
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

const SCHEDULE_CONCURRENCY = 4;

function num(value) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : 0;
}

function round(value, digits = 2) {
  const factor =
    Math.pow(10, digits);

  return (
    Math.round(
      (
        num(value) +
        Number.EPSILON
      ) *
      factor
    ) / factor
  );
}

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
      headers:
        tank01Headers()
    });

  let data = null;

  try {
    data =
      await response.json();
  } catch (error) {
    data = null;
  }

  if (!response.ok) {
    let detail =
      `HTTP ${response.status}`;

    if (
      data &&
      data.message
    ) {
      detail =
        data.message;
    } else if (
      data &&
      data.error
    ) {
      detail =
        data.error;
    } else if (
      data &&
      typeof data.body === "string"
    ) {
      detail =
        data.body;
    }

    throw new Error(
      `Tank01 ${endpoint} failed: ${detail}`
    );
  }

  return data;
}

function normalizePosition(value) {
  return String(
    value || ""
  )
    .trim()
    .toUpperCase();
}

function normalizeTeam(value) {
  return String(
    value || ""
  )
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

/*
  Tank01's ACTUAL getNFLGamesForPlayer shape is:

  body: {
    "20250907_TB@ATL": {
      Receiving: {...},
      Rushing: {...},
      longName: "...",
      playerID: "...",
      snapCounts: {...},
      team: "...",
      teamAbv: "ATL",
      teamID: "...",
      gameID: "20250907_TB@ATL"
    },
    ...
  }

  Convert that object to a normal array while preserving gameID.
*/
function extractPlayerGames(data) {
  if (
    !data ||
    !data.body
  ) {
    return [];
  }

  if (
    Array.isArray(data.body)
  ) {
    return data.body;
  }

  if (
    typeof data.body === "object"
  ) {
    return Object.entries(
      data.body
    ).map(
      function ([
        gameID,
        game
      ]) {
        return {
          ...(game || {}),

          gameID:
            (
              game &&
              game.gameID
            ) ||
            gameID
        };
      }
    );
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

function snapStats(game) {
  const stats =
    statBlock(
      game,
      "snapCounts"
    );

  return {
    offense:
      num(
        stats.offense ??
        stats.offensiveSnaps ??
        stats.offSnaps
      ),

    offensePct:
      num(
        stats.offensePct ??
        stats.offensiveSnapPct ??
        stats.offSnapPct
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
    },

    snaps: {
      offense: 0,
      offensePctTotal: 0,
      offensePctGames: 0
    }
  };

  for (
    const game of games
  ) {
    const passing =
      passingStats(game);

    const rushing =
      rushingStats(game);

    const receiving =
      receivingStats(game);

    const snaps =
      snapStats(game);

    totals.games += 1;

    for (
      const key of
      Object.keys(
        totals.passing
      )
    ) {
      totals.passing[key] +=
        passing[key];
    }

    for (
      const key of
      Object.keys(
        totals.rushing
      )
    ) {
      totals.rushing[key] +=
        rushing[key];
    }

    for (
      const key of
      Object.keys(
        totals.receiving
      )
    ) {
      totals.receiving[key] +=
        receiving[key];
    }

    totals.snaps.offense +=
      snaps.offense;

    if (
      snaps.offensePct > 0
    ) {
      totals
        .snaps
        .offensePctTotal +=
          snaps.offensePct;

      totals
        .snaps
        .offensePctGames += 1;
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
              passAttempts /
              games
            )
          : 0,

      completionsPerGame:
        games
          ? round(
              totals.passing
                .completions /
              games
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
              ) *
              100,
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
              carries /
              games
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
              targets /
              games
            )
          : 0,

      receptionsPerGame:
        games
          ? round(
              receptions /
              games
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
              ) *
              100,
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
    },

    snaps: {
      offensePerGame:
        games
          ? round(
              totals.snaps.offense /
              games
            )
          : 0,

      offensePct:
        totals
          .snaps
          .offensePctGames > 0
          ? round(
              totals
                .snaps
                .offensePctTotal /
              totals
                .snaps
                .offensePctGames,
              1
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
            .yardsPerGame,

        offensiveSnapPct:
          derived.snaps
            .offensePct
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
            .yardsPerGame,

        offensiveSnapPct:
          derived.snaps
            .offensePct
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
            .yardsPerGame,

        offensiveSnapPct:
          derived.snaps
            .offensePct
      };

    default:
      return {};
  }
}

function getBaseUrl(event) {
  const headers =
    event.headers || {};

  const proto =
    headers[
      "x-forwarded-proto"
    ] ||
    headers[
      "X-Forwarded-Proto"
    ] ||
    "https";

  const host =
    headers.host ||
    headers.Host;

  if (!host) {
    throw new Error(
      "Could not determine host."
    );
  }

  return `${proto}://${host}`;
}

async function fetchJson(url) {
  const response =
    await fetch(url, {
      method: "GET",
      headers: {
        Accept:
          "application/json"
      }
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
        data.detail ||
        data.error
      )
        ? (
            data.detail ||
            data.error
          )
        : `HTTP ${response.status}`;

    throw new Error(
      detail
    );
  }

  return data;
}

async function fetchScheduleWeek({
  baseUrl,
  season,
  week,
  seasonType
}) {
  const url =
    `${baseUrl}/.netlify/functions/weekly-sage-schedule` +
    `?season=${encodeURIComponent(season)}` +
    `&week=${encodeURIComponent(week)}` +
    `&seasonType=${encodeURIComponent(seasonType)}`;

  const data =
    await fetchJson(url);

  return {
    week,
    games:
      Array.isArray(
        data.games
      )
        ? data.games
        : []
  };
}

async function mapWithConcurrency(
  items,
  limit,
  worker
) {
  const results =
    new Array(
      items.length
    );

  let nextIndex = 0;

  async function runner() {
    while (true) {
      const index =
        nextIndex++;

      if (
        index >=
        items.length
      ) {
        return;
      }

      results[index] =
        await worker(
          items[index],
          index
        );
    }
  }

  const runnerCount =
    Math.min(
      limit,
      items.length
    );

  const runners = [];

  for (
    let i = 0;
    i < runnerCount;
    i += 1
  ) {
    runners.push(
      runner()
    );
  }

  await Promise.all(
    runners
  );

  return results;
}

async function buildPriorWeekScheduleMap({
  baseUrl,
  season,
  targetWeek,
  seasonType
}) {
  if (
    targetWeek <= 1
  ) {
    return {
      weeksIncluded: [],
      gameMap:
        new Map()
    };
  }

  const weeksIncluded =
    Array.from(
      {
        length:
          targetWeek - 1
      },
      function (_, index) {
        return index + 1;
      }
    );

  const schedules =
    await mapWithConcurrency(
      weeksIncluded,
      SCHEDULE_CONCURRENCY,
      function (week) {
        return fetchScheduleWeek({
          baseUrl,
          season,
          week,
          seasonType
        });
      }
    );

  const gameMap =
    new Map();

  for (
    const schedule of
    schedules
  ) {
    for (
      const game of
      schedule.games
    ) {
      if (!game.gameID) {
        continue;
      }

      gameMap.set(
        game.gameID,
        {
          week:
            schedule.week,

          gameID:
            game.gameID,

          away:
            normalizeTeam(
              game.away
            ),

          home:
            normalizeTeam(
              game.home
            ),

          gameDate:
            game.gameDate ||
            null,

          gameTime:
            game.gameTime ||
            null,

          gameStatus:
            game.gameStatus ||
            null
        }
      );
    }
  }

  return {
    weeksIncluded,
    gameMap
  };
}

function opponentFromSchedule(
  scheduleGame,
  team
) {
  if (!scheduleGame) {
    return null;
  }

  const normalizedTeam =
    normalizeTeam(team);

  if (
    scheduleGame.away ===
    normalizedTeam
  ) {
    return (
      scheduleGame.home ||
      null
    );
  }

  if (
    scheduleGame.home ===
    normalizedTeam
  ) {
    return (
      scheduleGame.away ||
      null
    );
  }

  return null;
}

function attachScheduleContext(
  playerGames,
  gameMap,
  team
) {
  const games = [];

  for (
    const game of
    playerGames
  ) {
    const schedule =
      gameMap.get(
        game.gameID
      );

    /*
      This automatically enforces no-look-ahead:
      gameMap contains ONLY Weeks 1 through targetWeek - 1.
    */
    if (!schedule) {
      continue;
    }

    games.push({
      ...game,

      sageWeek:
        schedule.week,

      sageOpponent:
        opponentFromSchedule(
          schedule,
          team
        ),

      sageGameDate:
        schedule.gameDate,

      sageGameTime:
        schedule.gameTime,

      sageGameStatus:
        schedule.gameStatus
    });
  }

  games.sort(
    function (a, b) {
      return (
        num(a.sageWeek) -
        num(b.sageWeek)
      );
    }
  );

  return games;
}

function compactGame(game) {
  return {
    gameID:
      game.gameID ||
      null,

    week:
      game.sageWeek ||
      null,

    opponent:
      game.sageOpponent ||
      null,

    gameDate:
      game.sageGameDate ||
      null,

    gameStatus:
      game.sageGameStatus ||
      null,

    Passing:
      game.Passing ||
      null,

    Rushing:
      game.Rushing ||
      null,

    Receiving:
      game.Receiving ||
      null,

    snapCounts:
      game.snapCounts ||
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
      event
        .queryStringParameters ||
      {};

    const season =
      String(
        query.season ||
        new Date()
          .getFullYear()
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
      const baseUrl =
        getBaseUrl(event);

      const [
        playerInfoResult,
        gameStatsResult,
        scheduleContext
      ] =
        await Promise.all([
          tank01Fetch(
            "getNFLPlayerInfo",
            {
              playerID
            }
          ),

          tank01Fetch(
            "getNFLGamesForPlayer",
            {
              playerID,
              season
            }
          ),

          buildPriorWeekScheduleMap({
            baseUrl,
            season,
            targetWeek,
            seasonType
          })
        ]);

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

      const allPlayerGames =
        extractPlayerGames(
          gameStatsResult
        );

      const team =
        normalizeTeam(
          player.teamAbv ||
          player.team
        );

      const position =
        normalizePosition(
          player.pos ||
          player.position
        );

      const priorGames =
        attachScheduleContext(
          allPlayerGames,
          scheduleContext.gameMap,
          team
        );

      const totals =
        aggregateGames(
          priorGames
        );

      const derived =
        buildDerived(
          totals
        );

      const usageProfile =
        buildUsageProfile(
          position,
          totals,
          derived
        );

      const actualWeeksIncluded =
        priorGames
          .map(
            function (game) {
              return game.sageWeek;
            }
          )
          .filter(
            function (week) {
              return Number.isInteger(
                week
              );
            }
          )
          .sort(
            function (a, b) {
              return a - b;
            }
          );

      return jsonResponse(
        200,
        {
          evidenceType:
            "weekly-sage-player-season",

          schemaVersion: 2,

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

            team,

            position
          },

          noLookAhead: {
            rule:
              `Only games from Weeks 1 through ${targetWeek - 1} are eligible.`,

            scheduleWeeksQueried:
              scheduleContext
                .weeksIncluded,

            weeksIncluded:
              actualWeeksIncluded,

            targetWeekExcluded:
              !actualWeeksIncluded
                .includes(
                  targetWeek
                )
          },

          sourceSummary: {
            playerGamesReturned:
              allPlayerGames.length,

            priorScheduleGamesMatched:
              priorGames.length
          },

          gamesUsed:
            priorGames.length,

          totals,

          perGame:
            derived,

          usageProfile,

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
