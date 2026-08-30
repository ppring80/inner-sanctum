// netlify/functions/weekly-sage-defense-week.js
//
// WEEKLY SAGE — ONE-WEEK DEFENSIVE EVIDENCE
//
// Production evidence endpoint.
//
// Given:
//
//   season=2025
//   week=8
//
// it:
//
//   1. Gets that week's NFL schedule from Tank01
//   2. Keeps completed games only
//   3. Gets each completed game's Tank01 box score
//   4. Converts opponent offensive teamStats into defensive evidence
//   5. Returns one normalized defensive snapshot for that week
//
// IMPORTANT:
//
// This endpoint contains NO SAGE recommendation logic.
// It contains NO player rankings.
// It simply turns factual Tank01 game data into clean evidence.
//
// The response is CDN-cacheable by season/week so we do not repeatedly
// spend Tank01 calls rebuilding historical weeks.
//
// ═══════════════════════════════════════════════════════════════════════

const TANK01_HOST =
  "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";

const DEFAULT_SEASON_TYPE = "reg";

const BOX_SCORE_CONCURRENCY = 4;

// Historical weeks can be cached aggressively.
// Current/recent weeks can still be refreshed periodically by the CDN.
const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

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
    let message =
      `Tank01 ${endpoint} failed with HTTP ${response.status}`;

    if (data && data.message) {
      message = data.message;
    } else if (
      data &&
      data.body &&
      typeof data.body === "string"
    ) {
      message = data.body;
    }

    throw new Error(message);
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

  const n = Number(value);

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
      game && game.gameStatus
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

    // Additive only -- see addPointsAllowedToDefense() below. A
    // SEPARATE counter from `games` above (not a reuse of it):
    // opponent-offense stats (rushing/passing/sacks/etc., tracked by
    // addOpponentOffenseToDefense) and box-score final score
    // (homePts/awayPts) are two independent fields on the same
    // already-fetched box score, so gamesRepresented only increments
    // when a valid, finite score was actually present for that game
    // -- never assumed equal to `games`, and never silently treated
    // as zero when score data is missing or invalid.
    pointsAllowed: {
      total: 0,
      gamesRepresented: 0
    },

    gamesUsed: []
  };
}

function ensureDefense(map, team) {
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

  defense.runDefense.attemptsAllowed +=
    rushAttempts;

  defense.runDefense.yardsAllowed +=
    rushYards;

  defense.runDefense.touchdownsAllowed +=
    rushTD;

  defense.passDefense.attemptsAllowed +=
    passing.attempts;

  defense.passDefense.completionsAllowed +=
    passing.completions;

  defense.passDefense.yardsAllowed +=
    passYards;

  defense.passDefense.touchdownsAllowed +=
    passTD;

  // Opponent interceptions thrown = interceptions created by defense.
  defense.passDefense.interceptions +=
    interceptionsThrown;

  // Opponent sacks taken = sacks created by defense.
  defense.passDefense.sacks +=
    sacks.sacks;

  defense.totalDefense.yardsAllowed +=
    totalYards;

  defense.totalDefense.playsFaced +=
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

/*
  Additive only. Records ONE defense's points allowed for ONE game,
  from boxScore.homePts / boxScore.awayPts -- the same already-fetched
  box score this file already reads, no new field source. Only
  increments when points is a valid, finite number; a missing or
  invalid value is skipped entirely rather than treated as a 0-point
  game, so a data gap can never silently understate points allowed.
*/
function addPointsAllowedToDefense({
  defense,
  points
}) {
  if (
    !defense ||
    points === null
  ) {
    return;
  }

  defense.pointsAllowed.total +=
    points;

  defense.pointsAllowed.gamesRepresented +=
    1;
}

function finalizeDefense(profile) {
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

        playByPlay:
          "false"
      }
    );

  return result.body || null;
}

/*
  KICKER EVIDENCE EXTRACTION (additive)
  --------------------------------------
  Reads only fields already present on the same boxScore object this
  file already fetches once per completed game -- no new Tank01 call,
  no change to the request above.

  Live-confirmed field names used verbatim below:
    body.playerStats[*].Kicking: fgLong, fgMade, fgAttempts, xpMade,
      fgPct, kickingPts, xpAttempts, fgMissed, xpMissed
    body.scoringPlays[*]: score, scoreType, team, playerIDs

  Return specialists also receive a Kicking block (kick-return
  fields only, no FG/XP fields), so a stat line only counts as a
  place kicker's if it actually contains at least one of
  fgAttempts / fgMade / xpAttempts / xpMade.
*/
function isPlaceKickerStatLine(kicking) {
  if (
    !kicking ||
    typeof kicking !==
      "object"
  ) {
    return false;
  }

  return (
    kicking.fgAttempts !==
      undefined ||
    kicking.fgMade !==
      undefined ||
    kicking.xpAttempts !==
      undefined ||
    kicking.xpMade !==
      undefined
  );
}

function numOrNull(value) {
  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

const FG_SCORE_TEXT_PATTERN =
  /(\d+)\s*Yd Field Goal/i;

/*
  Made field-goal distances for ONE specific kicker, using ONLY the
  confirmed scoringPlays contract -- scoreType === "FG", associated
  by playerIDs, distance parsed from the "score" text. No speculative
  field names. Fails soft (returns []) whenever a play doesn't match
  this exact confirmed shape rather than guessing.
*/
function madeFgDistancesForKicker(
  scoringPlays,
  playerID
) {
  if (
    !Array.isArray(
      scoringPlays
    )
  ) {
    return [];
  }

  const distances =
    [];

  scoringPlays.forEach(
    function (play) {
      if (
        !play ||
        play.scoreType !==
          "FG" ||
        !Array.isArray(
          play.playerIDs
        ) ||
        play.playerIDs.indexOf(
          playerID
        ) ===
          -1
      ) {
        return;
      }

      const match =
        FG_SCORE_TEXT_PATTERN.exec(
          play.score ||
          ""
        );

      if (match) {
        distances.push(
          Number(
            match[1]
          )
        );
      }
    }
  );

  return distances;
}

/*
  This game's kickerEvidence entries (zero, one, or two -- one per
  team that actually attempted a kick).
*/
function buildGameKickerEvidence({
  boxScore,
  game
}) {
  const playerStats =
    boxScore &&
    boxScore.playerStats &&
    typeof boxScore.playerStats ===
      "object"
      ? boxScore.playerStats
      : {};

  const homePts =
    numOrNull(
      boxScore &&
      boxScore.homePts
    );

  const awayPts =
    numOrNull(
      boxScore &&
      boxScore.awayPts
    );

  const evidence =
    [];

  Object.keys(
    playerStats
  ).forEach(
    function (playerID) {
      const player =
        playerStats[
          playerID
        ];

      const kicking =
        player &&
        player.Kicking;

      if (
        !isPlaceKickerStatLine(
          kicking
        )
      ) {
        return;
      }

      evidence.push({
        gameID:
          game.gameID,

        week:
          game.gameWeek ||
          null,

        home:
          game.home,

        away:
          game.away,

        homePts:
          homePts,

        awayPts:
          awayPts,

        playerID:
          playerID,

        name:
          player.longName ||
          null,

        team:
          player.teamAbv ||
          player.team ||
          null,

        fgAttempts:
          numOrNull(
            kicking.fgAttempts
          ),

        fgMade:
          numOrNull(
            kicking.fgMade
          ),

        fgMissed:
          numOrNull(
            kicking.fgMissed
          ),

        xpAttempts:
          numOrNull(
            kicking.xpAttempts
          ),

        xpMade:
          numOrNull(
            kicking.xpMade
          ),

        xpMissed:
          numOrNull(
            kicking.xpMissed
          ),

        fgLong:
          numOrNull(
            kicking.fgLong
          ),

        madeFgDistances:
          madeFgDistancesForKicker(
            boxScore &&
            boxScore.scoringPlays,
            playerID
          )
      });
    }
  );

  return evidence;
}

async function mapWithConcurrency(
  items,
  limit,
  worker
) {
  const results =
    new Array(items.length);

  let nextIndex = 0;

  async function runner() {
    while (true) {
      const index =
        nextIndex++;

      if (index >= items.length) {
        return;
      }

      try {
        results[index] =
          await worker(
            items[index],
            index
          );
      } catch (error) {
        results[index] = {
          error
        };
      }
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

  await Promise.all(runners);

  return results;
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
      Number(query.week);

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
      ].includes(seasonType)
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

      // Additive only -- see buildGameKickerEvidence() above. Does
      // not participate in, or get read by, any existing defense
      // calculation below.
      const kickerEvidenceByGame = [];

      const processed =
        await mapWithConcurrency(
          completedGames,
          BOX_SCORE_CONCURRENCY,
          async function (game) {
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
                return {
                  gameID:
                    game.gameID,

                  away:
                    game.away,

                  home:
                    game.home,

                  status:
                    "missing_team_stats"
                };
              }

              /*
                JavaScript's single-threaded execution means these
                synchronous object mutations are safe between awaits.
                The same guarantee applies to the kickerEvidenceByGame
                push immediately below.
              */

              // Additive only -- reads the SAME already-fetched
              // boxScore object; makes no new Tank01 call and does
              // not alter anything the existing defense calculation
              // below reads or produces.
              kickerEvidenceByGame.push(
                ...buildGameKickerEvidence({
                  boxScore,
                  game
                })
              );

              const homeDefense =
                ensureDefense(
                  defenseMap,
                  game.home
                );

              const awayDefense =
                ensureDefense(
                  defenseMap,
                  game.away
                );

              // Home defense allowed away offense.
              addOpponentOffenseToDefense({
                defense:
                  homeDefense,

                opponentStats:
                  teamStats.away,

                game
              });

              // Away defense allowed home offense.
              addOpponentOffenseToDefense({
                defense:
                  awayDefense,

                opponentStats:
                  teamStats.home,

                game
              });

              // Additive only -- home defense's points allowed is
              // the AWAY team's final score, and vice versa. Reads
              // the SAME already-fetched boxScore object used above;
              // numOrNull() (already defined for kickerEvidence)
              // returns null on any missing/invalid value, so a data
              // gap here is skipped, never coerced to 0.
              addPointsAllowedToDefense({
                defense:
                  homeDefense,

                points:
                  numOrNull(
                    boxScore.awayPts
                  )
              });

              addPointsAllowedToDefense({
                defense:
                  awayDefense,

                points:
                  numOrNull(
                    boxScore.homePts
                  )
              });

              return {
                gameID:
                  game.gameID,

                away:
                  game.away,

                home:
                  game.home,

                gameStatus:
                  game.gameStatus,

                status:
                  "processed"
              };
            } catch (error) {
              return {
                gameID:
                  game.gameID,

                away:
                  game.away,

                home:
                  game.home,

                status:
                  "error",

                error:
                  error.message
              };
            }
          }
        );

      const defenses = {};

      Object
        .keys(defenseMap)
        .sort()
        .forEach(
          function (team) {
            defenses[team] =
              finalizeDefense(
                defenseMap[team]
              );
          }
        );

      const processedCount =
        processed.filter(
          function (game) {
            return (
              game &&
              game.status ===
                "processed"
            );
          }
        ).length;

      return jsonResponse(
        200,
        {
          evidenceType:
            "weekly-sage-defense-week",

          schemaVersion:
            1,

          generatedAt:
            new Date()
              .toISOString(),

          season:
            season,

          week:
            week,

          seasonType:
            seasonType,

          schedule: {
            gamesReturned:
              games.length,

            completedGames:
              completedGames.length,

            processedGames:
              processedCount
          },

          defenses:
            defenses,

          gameResults:
            processed,

          // Additive only -- see buildGameKickerEvidence() above.
          // Does not alter, and is not read by, defenses/gameResults
          // above. Consumed later by the future K snapshot builder;
          // this file does not itself score or rank kickers.
          kickerEvidence:
            kickerEvidenceByGame
        },

        CACHE_CONTROL
      );
    } catch (error) {
      console.error(
        "weekly-sage-defense-week failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not build Weekly SAGE defensive evidence.",

          detail:
            error.message
        }
      );
    }
  };
