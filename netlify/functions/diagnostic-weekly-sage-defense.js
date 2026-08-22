// netlify/functions/diagnostic-weekly-sage-defense.js
//
// WEEKLY SAGE — TEAM DEFENSE EVIDENCE DIAGNOSTIC
//
// PURPOSE
// -------
// Prove that Tank01's existing:
//
//   getNFLGamesForWeek
//          +
//   getNFLBoxScore
//
// responses can be normalized into the run-defense and pass-defense
// evidence Weekly SAGE will eventually consume.
//
// THIS IS NOT A PRODUCTION ENDPOINT.
//
// It:
//   - creates no scheduled job
//   - writes no cache
//   - changes no Weekly Rankings behavior
//   - changes no SAGE behavior
//   - changes no existing production function
//
// After we validate this output against known games, the aggregation
// logic can be moved into the production Weekly SAGE evidence pipeline.
//
// EXAMPLE:
//
// /.netlify/functions/diagnostic-weekly-sage-defense?season=2025&week=8
//
// IMPORTANT:
// Only COMPLETED games are included in the defensive aggregation.
// Scheduled/in-progress games are ignored.
//
// ═══════════════════════════════════════════════════════════════════════

const TANK01_HOST =
  "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";

const DEFAULT_SEASON = "2025";
const DEFAULT_WEEK = "8";
const DEFAULT_SEASON_TYPE = "reg";

function tank01Headers() {
  return {
    "Content-Type": "application/json",
    "x-rapidapi-host": TANK01_HOST,
    "x-rapidapi-key": process.env.TANK01_API_KEY
  };
}

async function tank01Fetch(endpoint, params) {
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
    data = await response.json();
  } catch (err) {
    data = null;
  }

  if (!response.ok) {
    const message =
      data &&
      data.body
        ? data.body
        : `Tank01 request failed with HTTP ${response.status}`;

    throw new Error(
      `${endpoint}: ${message}`
    );
  }

  return data;
}

function numberValue(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return 0;
  }

  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : 0;
}

function parseCompletionsAttempts(value) {
  if (
    !value ||
    typeof value !== "string"
  ) {
    return {
      completions: 0,
      attempts: 0
    };
  }

  const parts =
    value.split("-");

  return {
    completions:
      numberValue(parts[0]),

    attempts:
      numberValue(parts[1])
  };
}

function parseSacks(value) {
  if (
    !value ||
    typeof value !== "string"
  ) {
    return {
      sacks: 0,
      yardsLost: 0
    };
  }

  const parts =
    value.split("-");

  return {
    sacks:
      numberValue(parts[0]),

    yardsLost:
      numberValue(parts[1])
  };
}

function isCompletedGame(game) {
  const status =
    String(
      game &&
      game.gameStatus
        ? game.gameStatus
        : ""
    )
      .trim()
      .toLowerCase();

  return (
    status === "completed" ||
    status === "final"
  );
}

function emptyDefenseProfile(team) {
  return {
    team,

    games: 0,

    runDefense: {
      attemptsAllowed: 0,
      yardsAllowed: 0,
      touchdownsAllowed: 0,
      yardsPerCarryAllowed: 0
    },

    passDefense: {
      attemptsAllowed: 0,
      completionsAllowed: 0,
      yardsAllowed: 0,
      touchdownsAllowed: 0,
      interceptions: 0,
      sacks: 0,
      yardsPerAttemptAllowed: 0,
      completionPctAllowed: 0
    },

    totalDefense: {
      yardsAllowed: 0,
      playsFaced: 0,
      yardsPerPlayAllowed: 0
    },

    gamesUsed: []
  };
}

function ensureTeamProfile(map, team) {
  if (!map[team]) {
    map[team] =
      emptyDefenseProfile(team);
  }

  return map[team];
}

function addOpponentOffenseToDefense({
  defense,
  opponentStats,
  game
}) {
  if (
    !defense ||
    !opponentStats
  ) {
    return;
  }

  const passing =
    parseCompletionsAttempts(
      opponentStats
        .passCompletionsAndAttempts
    );

  const sacks =
    parseSacks(
      opponentStats
        .sacksAndYardsLost
    );

  const rushAttempts =
    numberValue(
      opponentStats.rushingAttempts
    );

  const rushYards =
    numberValue(
      opponentStats.rushingYards
    );

  const rushTD =
    numberValue(
      opponentStats.rushTD
    );

  const passYards =
    numberValue(
      opponentStats.passingYards
    );

  const passTD =
    numberValue(
      opponentStats.passTD
    );

  const interceptionsThrown =
    numberValue(
      opponentStats.interceptionsThrown
    );

  const totalYards =
    numberValue(
      opponentStats.totalYards
    );

  const totalPlays =
    numberValue(
      opponentStats.totalPlays
    );

  defense.games += 1;

  defense
    .runDefense
    .attemptsAllowed +=
      rushAttempts;

  defense
    .runDefense
    .yardsAllowed +=
      rushYards;

  defense
    .runDefense
    .touchdownsAllowed +=
      rushTD;

  defense
    .passDefense
    .attemptsAllowed +=
      passing.attempts;

  defense
    .passDefense
    .completionsAllowed +=
      passing.completions;

  defense
    .passDefense
    .yardsAllowed +=
      passYards;

  defense
    .passDefense
    .touchdownsAllowed +=
      passTD;

  /*
    From the defense's point of view:

    opponent interceptions thrown
      =
    defense interceptions produced
  */
  defense
    .passDefense
    .interceptions +=
      interceptionsThrown;

  /*
    opponent sacksAndYardsLost
      =
    sacks produced by this defense
  */
  defense
    .passDefense
    .sacks +=
      sacks.sacks;

  defense
    .totalDefense
    .yardsAllowed +=
      totalYards;

  defense
    .totalDefense
    .playsFaced +=
      totalPlays;

  defense.gamesUsed.push({
    gameID:
      game.gameID,

    week:
      game.gameWeek,

    season:
      game.season,

    opponent:
      opponentStats.teamAbv ||
      opponentStats.team ||
      null,

    opponentRushAttempts:
      rushAttempts,

    opponentRushYards:
      rushYards,

    opponentRushTD:
      rushTD,

    opponentPassAttempts:
      passing.attempts,

    opponentPassCompletions:
      passing.completions,

    opponentPassYards:
      passYards,

    opponentPassTD:
      passTD,

    opponentInterceptions:
      interceptionsThrown,

    opponentSacksAllowed:
      sacks.sacks,

    opponentTotalYards:
      totalYards
  });
}

function finalizeDefenseProfile(profile) {
  const result =
    JSON.parse(
      JSON.stringify(profile)
    );

  const run =
    result.runDefense;

  const pass =
    result.passDefense;

  const total =
    result.totalDefense;

  run.yardsPerCarryAllowed =
    run.attemptsAllowed > 0
      ? Number(
          (
            run.yardsAllowed /
            run.attemptsAllowed
          ).toFixed(2)
        )
      : 0;

  pass.yardsPerAttemptAllowed =
    pass.attemptsAllowed > 0
      ? Number(
          (
            pass.yardsAllowed /
            pass.attemptsAllowed
          ).toFixed(2)
        )
      : 0;

  pass.completionPctAllowed =
    pass.attemptsAllowed > 0
      ? Number(
          (
            (
              pass.completionsAllowed /
              pass.attemptsAllowed
            ) *
            100
          ).toFixed(1)
        )
      : 0;

  total.yardsPerPlayAllowed =
    total.playsFaced > 0
      ? Number(
          (
            total.yardsAllowed /
            total.playsFaced
          ).toFixed(2)
        )
      : 0;

  /*
    Per-game values make the diagnostic much easier to sanity-check
    and are likely useful inputs later for Weekly SAGE.
  */

  result.perGame = {
    rushAttemptsAllowed:
      result.games > 0
        ? Number(
            (
              run.attemptsAllowed /
              result.games
            ).toFixed(1)
          )
        : 0,

    rushYardsAllowed:
      result.games > 0
        ? Number(
            (
              run.yardsAllowed /
              result.games
            ).toFixed(1)
          )
        : 0,

    rushTDAllowed:
      result.games > 0
        ? Number(
            (
              run.touchdownsAllowed /
              result.games
            ).toFixed(2)
          )
        : 0,

    passAttemptsAllowed:
      result.games > 0
        ? Number(
            (
              pass.attemptsAllowed /
              result.games
            ).toFixed(1)
          )
        : 0,

    passYardsAllowed:
      result.games > 0
        ? Number(
            (
              pass.yardsAllowed /
              result.games
            ).toFixed(1)
          )
        : 0,

    passTDAllowed:
      result.games > 0
        ? Number(
            (
              pass.touchdownsAllowed /
              result.games
            ).toFixed(2)
          )
        : 0,

    interceptions:
      result.games > 0
        ? Number(
            (
              pass.interceptions /
              result.games
            ).toFixed(2)
          )
        : 0,

    sacks:
      result.games > 0
        ? Number(
            (
              pass.sacks /
              result.games
            ).toFixed(2)
          )
        : 0,

    totalYardsAllowed:
      result.games > 0
        ? Number(
            (
              total.yardsAllowed /
              result.games
            ).toFixed(1)
          )
        : 0
  };

  return result;
}

async function getGamesForWeek({
  season,
  week,
  seasonType
}) {
  const result =
    await tank01Fetch(
      "getNFLGamesForWeek",
      {
        week:
          String(week),

        season:
          String(season),

        seasonType:
          seasonType
      }
    );

  return Array.isArray(result.body)
    ? result.body
    : [];
}

async function getBoxScore(gameID) {
  const result =
    await tank01Fetch(
      "getNFLBoxScore",
      {
        gameID:
          gameID,

        /*
          We only need final game/team/player totals for this diagnostic.
          No reason to request the very large play-by-play payload.
        */
        playByPlay:
          "false"
      }
    );

  return result.body || null;
}

exports.handler =
  async function (event) {
    if (
      !process.env.TANK01_API_KEY
    ) {
      return {
        statusCode:
          500,

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(
            {
              error:
                "TANK01_API_KEY is not configured."
            },
            null,
            2
          )
      };
    }

    const query =
      event.queryStringParameters ||
      {};

    const season =
      query.season ||
      DEFAULT_SEASON;

    const week =
      query.week ||
      DEFAULT_WEEK;

    const seasonType =
      query.seasonType ||
      DEFAULT_SEASON_TYPE;

    try {
      const games =
        await getGamesForWeek({
          season,
          week,
          seasonType
        });

      const completedGames =
        games.filter(
          isCompletedGame
        );

      const defenseMap = {};

      const gameResults = [];

      /*
        Sequential by design.

        This is a diagnostic and we want to be respectful of the
        existing RapidAPI quota rather than firing every box score at
        Tank01 simultaneously.
      */
      for (
        const game of completedGames
      ) {
        try {
          const boxScore =
            await getBoxScore(
              game.gameID
            );

          const teamStats =
            boxScore &&
            boxScore.teamStats;

          if (
            !teamStats ||
            !teamStats.home ||
            !teamStats.away
          ) {
            gameResults.push({
              gameID:
                game.gameID,

              status:
                "missing_team_stats"
            });

            continue;
          }

          const homeTeam =
            game.home;

          const awayTeam =
            game.away;

          const homeDefense =
            ensureTeamProfile(
              defenseMap,
              homeTeam
            );

          const awayDefense =
            ensureTeamProfile(
              defenseMap,
              awayTeam
            );

          /*
            HOME defense allowed AWAY offensive statistics.
          */
          addOpponentOffenseToDefense({
            defense:
              homeDefense,

            opponentStats:
              teamStats.away,

            game:
              game
          });

          /*
            AWAY defense allowed HOME offensive statistics.
          */
          addOpponentOffenseToDefense({
            defense:
              awayDefense,

            opponentStats:
              teamStats.home,

            game:
              game
          });

          gameResults.push({
            gameID:
              game.gameID,

            away:
              awayTeam,

            home:
              homeTeam,

            gameStatus:
              game.gameStatus,

            status:
              "processed"
          });
        } catch (gameError) {
          gameResults.push({
            gameID:
              game.gameID,

            status:
              "error",

            error:
              gameError.message
          });
        }
      }

      const defenses = {};

      Object
        .keys(defenseMap)
        .sort()
        .forEach(
          function (team) {
            defenses[team] =
              finalizeDefenseProfile(
                defenseMap[team]
              );
          }
        );

      return {
        statusCode:
          200,

        headers: {
          "Content-Type":
            "application/json",

          "Cache-Control":
            "no-store"
        },

        body:
          JSON.stringify(
            {
              diagnostic:
                "Weekly SAGE Team Defense Evidence",

              generatedAt:
                new Date()
                  .toISOString(),

              request: {
                season:
                  String(season),

                week:
                  String(week),

                seasonType:
                  seasonType
              },

              schedule: {
                gamesReturned:
                  games.length,

                completedGames:
                  completedGames.length,

                gameIDs:
                  completedGames.map(
                    function (game) {
                      return game.gameID;
                    }
                  )
              },

              defenses:
                defenses,

              gameResults:
                gameResults
            },
            null,
            2
          )
      };
    } catch (error) {
      console.error(
        "Weekly SAGE defense diagnostic failed:",
        error.message
      );

      return {
        statusCode:
          500,

        headers: {
          "Content-Type":
            "application/json",

          "Cache-Control":
            "no-store"
        },

        body:
          JSON.stringify(
            {
              error:
                error.message
            },
            null,
            2
          )
      };
    }
  };
