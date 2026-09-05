// netlify/functions/sage-schedule-intelligence-data.js
//
// SAGE — SCHEDULE INTELLIGENCE DATA BUILDER V1
//
// PURPOSE
// -------
// Build the real data inputs required by:
//
//   sage-schedule-intelligence.js
//
// This file owns DATA COLLECTION / NORMALIZATION only.
//
// It:
// - loads the Tank01 NFL player list
// - identifies RBs
// - loads historical RB game logs
// - joins those game logs to authoritative Weekly SAGE schedule evidence
// - determines the defense faced in each historical game
// - loads the target-season NFL schedule
// - feeds the normalized evidence into Schedule Intelligence
//
// It DOES NOT:
// - alter Draft SAGE recommendation ordering
// - alter Opportunity Intelligence
// - alter Context Intelligence
// - alter Market Intelligence
// - alter Scarcity Intelligence
// - alter draft-sage-synthesis.js
// - calculate a hidden player score
//
// V1 DEFAULT
// ----------
// Target season:     2026
// Baseline season:   target season - 1 (2025)
// Position:          RB
// Season type:       regular season
//
// Historical defensive strength is therefore based on the prior completed
// regular season until current-season blending is added in a later version.
//
// IMPORTANT AGGREGATION RULE
// --------------------------
// sage-schedule-intelligence.js is responsible for:
//
//   1. scoring each RB game
//   2. summing all opposing RB production within the same NFL game
//   3. averaging those TEAM-RB game totals for each defense
//
// That avoids bias toward teams that simply use more running backs.
//
// ═══════════════════════════════════════════════════════════════════════

const {
  normalizeTeam,
  normalizeScoring,
  buildDefenseRbRatings,
  buildLeagueScheduleIntelligence,
  buildScheduleInsight
} =
  require(
    "./sage-schedule-intelligence.js"
  );

const {
  buildWeeklySchedule
} =
  require(
    "./weekly-sage-schedule.js"
  );

const TANK01_HOST =
  "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";

const DEFAULT_SEASON_TYPE =
  "reg";

const DEFAULT_POSITION =
  "RB";

const DEFAULT_TARGET_SEASON =
  2026;

const DEFAULT_EARLY_WEEKS =
  [
    1,
    2,
    3,
    4
  ];

const DEFAULT_SEASON_WEEKS =
  [
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    10,
    11,
    12,
    13,
    14,
    15,
    16,
    17,
    18
  ];

const DEFAULT_PLAYOFF_WEEKS =
  [
    14,
    15,
    16,
    17
  ];

/*
  Keep Tank01 pressure intentionally controlled.

  This mirrors the production discipline already used by Weekly SAGE
  population builders rather than blasting every player request at once.
*/
const PLAYER_CONCURRENCY =
  2;


// ═══════════════════════════════════════════════════════════════════════
// GENERIC HELPERS
// ═══════════════════════════════════════════════════════════════════════

function num(
  value
) {
  const n =
    Number(
      value
    );

  return Number.isFinite(
    n
  )
    ? n
    : 0;
}


function integer(
  value,
  fallback
) {
  const n =
    Number(
      value
    );

  return Number.isInteger(
    n
  )
    ? n
    : fallback;
}


function normalizePosition(
  value
) {
  return String(
    value ||
    ""
  )
    .trim()
    .toUpperCase();
}


function normalizeSeasonType(
  value
) {
  const result =
    String(
      value ||
      DEFAULT_SEASON_TYPE
    )
      .trim()
      .toLowerCase();

  return (
    result ||
    DEFAULT_SEASON_TYPE
  );
}


function playerIDOf(
  player
) {
  return String(
    player &&
    (
      player.playerID ??
      player.playerId ??
      player.id ??
      ""
    )
  ).trim();
}


function playerNameOf(
  player
) {
  if (
    !player ||
    typeof player !==
      "object"
  ) {
    return null;
  }

  return (
    player.longName ??
    player.name ??
    player.playerName ??
    null
  );
}


function playerPositionOf(
  player
) {
  if (
    !player ||
    typeof player !==
      "object"
  ) {
    return "";
  }

  return normalizePosition(
    player.pos ??
    player.position ??
    player.positionAbv ??
    ""
  );
}


function playerTeamOf(
  player
) {
  if (
    !player ||
    typeof player !==
      "object"
  ) {
    return "";
  }

  return normalizeTeam(
    player.teamAbv ??
    player.team ??
    player.teamAbbr ??
    ""
  );
}


function jsonResponse(
  statusCode,
  body
) {
  return {
    statusCode,

    headers: {
      "Content-Type":
        "application/json",

      "Cache-Control":
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


// ═══════════════════════════════════════════════════════════════════════
// TANK01
// ═══════════════════════════════════════════════════════════════════════

function tank01Headers() {
  return {
    "Content-Type":
      "application/json",

    "x-rapidapi-host":
      TANK01_HOST,

    "x-rapidapi-key":
      process.env
        .TANK01_API_KEY
  };
}


async function tank01Fetch(
  endpoint,
  params
) {
  const query =
    new URLSearchParams(
      params ||
      {}
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
        method:
          "GET",

        headers:
          tank01Headers()
      }
    );

  let data =
    null;

  try {
    data =
      await response.json();
  } catch (
    error
  ) {
    data =
      null;
  }

  if (
    !response.ok
  ) {
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
      typeof data.body ===
        "string"
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


function unwrapBody(
  data
) {
  if (
    data &&
    typeof data ===
      "object" &&
    Object.prototype
      .hasOwnProperty
      .call(
        data,
        "body"
      )
  ) {
    let body =
      data.body;

    if (
      typeof body ===
        "string"
    ) {
      try {
        body =
          JSON.parse(
            body
          );
      } catch (
        error
      ) {
        // Leave body unchanged.
      }
    }

    return body;
  }

  return data;
}


function extractPlayers(
  data
) {
  const body =
    unwrapBody(
      data
    );

  if (
    Array.isArray(
      body
    )
  ) {
    return body;
  }

  if (
    body &&
    Array.isArray(
      body.players
    )
  ) {
    return body.players;
  }

  if (
    data &&
    Array.isArray(
      data.players
    )
  ) {
    return data.players;
  }

  return [];
}


/*
  Tank01 getNFLGamesForPlayer currently returns body either as:

    [
      game,
      game
    ]

  or as:

    {
      GAME_ID: game,
      GAME_ID: game
    }

  Normalize both into one array while preserving gameID.
*/
function extractPlayerGames(
  data
) {
  const body =
    unwrapBody(
      data
    );

  if (
    !body
  ) {
    return [];
  }

  if (
    Array.isArray(
      body
    )
  ) {
    return body;
  }

  if (
    typeof body ===
      "object"
  ) {
    return Object.entries(
      body
    ).map(
      ([
        gameID,
        game
      ]) => ({
        ...(game || {}),

        gameID:
          (
            game &&
            game.gameID
          ) ||
          gameID
      })
    );
  }

  return [];
}


// ═══════════════════════════════════════════════════════════════════════
// CONTROLLED CONCURRENCY
// ═══════════════════════════════════════════════════════════════════════

async function mapWithConcurrency(
  items,
  concurrency,
  worker
) {
  const source =
    Array.isArray(
      items
    )
      ? items
      : [];

  const limit =
    Math.max(
      1,
      integer(
        concurrency,
        1
      )
    );

  const results =
    new Array(
      source.length
    );

  let nextIndex =
    0;

  async function runWorker() {
    while (
      true
    ) {
      const index =
        nextIndex;

      nextIndex +=
        1;

      if (
        index >=
        source.length
      ) {
        return;
      }

      results[index] =
        await worker(
          source[index],
          index
        );
    }
  }

  const workers =
    [];

  const workerCount =
    Math.min(
      limit,
      source.length
    );

  for (
    let i = 0;
    i < workerCount;
    i += 1
  ) {
    workers.push(
      runWorker()
    );
  }

  await Promise.all(
    workers
  );

  return results;
}


// ═══════════════════════════════════════════════════════════════════════
// SCHEDULE COLLECTION
// ═══════════════════════════════════════════════════════════════════════

async function buildSeasonSchedules({
  season,
  seasonType =
    DEFAULT_SEASON_TYPE,
  weeks =
    DEFAULT_SEASON_WEEKS
}) {
  const requestedWeeks =
    Array.from(
      new Set(
        (
          Array.isArray(
            weeks
          )
            ? weeks
            : []
        )
          .map(
            week =>
              integer(
                week,
                null
              )
          )
          .filter(
            week =>
              Number.isInteger(
                week
              ) &&
              week > 0
          )
      )
    ).sort(
      (a, b) =>
        a - b
    );

  const schedules =
    [];

  /*
    Deliberately serialized.

    buildWeeklySchedule is the existing authoritative schedule builder
    and itself calls Tank01. Schedule collection happens once per build,
    so reliability is more important than making 18 parallel API calls.
  */
  for (
    const week
    of requestedWeeks
  ) {
    const schedule =
      await buildWeeklySchedule({
        season:
          String(
            season
          ),

        week,

        seasonType
      });

    schedules.push(
      schedule
    );
  }

  return schedules;
}


function buildGameMap(
  schedules
) {
  const gameMap =
    new Map();

  for (
    const schedule
    of (
      Array.isArray(
        schedules
      )
        ? schedules
        : []
    )
  ) {
    const scheduleWeek =
      integer(
        schedule &&
        (
          schedule.week ??
          schedule.gameWeek
        ),
        null
      );

    const games =
      schedule &&
      Array.isArray(
        schedule.games
      )
        ? schedule.games
        : [];

    for (
      const game
      of games
    ) {
      if (
        !game ||
        !game.gameID
      ) {
        continue;
      }

      const away =
        normalizeTeam(
          game.away
        );

      const home =
        normalizeTeam(
          game.home
        );

      gameMap.set(
        String(
          game.gameID
        ),
        {
          gameID:
            String(
              game.gameID
            ),

          week:
            scheduleWeek,

          away,

          home,

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

  return gameMap;
}


function flattenSchedules(
  schedules
) {
  const games =
    [];

  for (
    const schedule
    of (
      Array.isArray(
        schedules
      )
        ? schedules
        : []
    )
  ) {
    const week =
      integer(
        schedule &&
        (
          schedule.week ??
          schedule.gameWeek
        ),
        null
      );

    const scheduleGames =
      schedule &&
      Array.isArray(
        schedule.games
      )
        ? schedule.games
        : [];

    for (
      const game
      of scheduleGames
    ) {
      if (
        !game ||
        !game.gameID
      ) {
        continue;
      }

      games.push({
        ...game,

        week:
          integer(
            game.week ??
            game.gameWeek,
            week
          ),

        away:
          normalizeTeam(
            game.away
          ),

        home:
          normalizeTeam(
            game.home
          )
      });
    }
  }

  return games;
}


// ═══════════════════════════════════════════════════════════════════════
// HISTORICAL RB GAME NORMALIZATION
// ═══════════════════════════════════════════════════════════════════════

function opponentForTeam(
  scheduleGame,
  team
) {
  if (
    !scheduleGame ||
    !team
  ) {
    return null;
  }

  const normalizedTeam =
    normalizeTeam(
      team
    );

  const away =
    normalizeTeam(
      scheduleGame.away
    );

  const home =
    normalizeTeam(
      scheduleGame.home
    );

  if (
    normalizedTeam ===
    away
  ) {
    return home || null;
  }

  if (
    normalizedTeam ===
    home
  ) {
    return away || null;
  }

  return null;
}


function inferHistoricalTeam({
  game,
  scheduleGame,
  currentTeam
}) {
  /*
    Prefer team identity embedded in the historical game record.

    Current roster team is only a fallback because players can change
    NFL teams between the baseline season and target season.
  */
  const possibleHistoricalTeam =
    normalizeTeam(
      game &&
      (
        game.teamAbv ??
        game.team ??
        game.teamAbbr ??
        game.playerTeam ??
        ""
      )
    );

  if (
    possibleHistoricalTeam
  ) {
    const opponent =
      opponentForTeam(
        scheduleGame,
        possibleHistoricalTeam
      );

    if (
      opponent
    ) {
      return possibleHistoricalTeam;
    }
  }

  const normalizedCurrentTeam =
    normalizeTeam(
      currentTeam
    );

  if (
    normalizedCurrentTeam
  ) {
    const opponent =
      opponentForTeam(
        scheduleGame,
        normalizedCurrentTeam
      );

    if (
      opponent
    ) {
      return normalizedCurrentTeam;
    }
  }

  /*
    Last-resort support for Tank01 game records that may expose an
    explicit opponent/team pairing using alternate fields.
  */
  const explicitOpponent =
    normalizeTeam(
      game &&
      (
        game.opponent ??
        game.opponentAbv ??
        game.opp ??
        ""
      )
    );

  if (
    explicitOpponent
  ) {
    const away =
      normalizeTeam(
        scheduleGame &&
        scheduleGame.away
      );

    const home =
      normalizeTeam(
        scheduleGame &&
        scheduleGame.home
      );

    if (
      explicitOpponent ===
      away
    ) {
      return home || null;
    }

    if (
      explicitOpponent ===
      home
    ) {
      return away || null;
    }
  }

  return null;
}


function normalizeHistoricalPlayerGame({
  player,
  game,
  gameMap
}) {
  if (
    !game ||
    !game.gameID
  ) {
    return null;
  }

  const gameID =
    String(
      game.gameID
    );

  const scheduleGame =
    gameMap.get(
      gameID
    );

  if (
    !scheduleGame
  ) {
    return null;
  }

  const team =
    inferHistoricalTeam({
      game,
      scheduleGame,

      currentTeam:
        player.team
    });

  if (
    !team
  ) {
    return null;
  }

  const defense =
    opponentForTeam(
      scheduleGame,
      team
    );

  if (
    !defense
  ) {
    return null;
  }

  return {
    ...game,

    gameID,

    playerID:
      player.playerID,

    playerName:
      player.name,

    position:
      DEFAULT_POSITION,

    team,

    defense,

    opponent:
      defense,

    week:
      scheduleGame.week,

    sageWeek:
      scheduleGame.week,

    sageGameDate:
      scheduleGame.gameDate,

    sageGameTime:
      scheduleGame.gameTime,

    sageGameStatus:
      scheduleGame.gameStatus
  };
}


async function loadHistoricalRbGames({
  baselineSeason,
  historicalSchedules
}) {
  const playerListData =
    await tank01Fetch(
      "getNFLPlayerList",
      {
        all:
          "true"
      }
    );

  const players =
    extractPlayers(
      playerListData
    );

  const rbCandidates =
    players
      .filter(
        player =>
          playerPositionOf(
            player
          ) ===
            DEFAULT_POSITION
      )
      .map(
        player => ({
          playerID:
            playerIDOf(
              player
            ),

          name:
            playerNameOf(
              player
            ),

          team:
            playerTeamOf(
              player
            )
        })
      )
      .filter(
        player =>
          Boolean(
            player.playerID
          )
      );

  const gameMap =
    buildGameMap(
      historicalSchedules
    );

  const unmatched =
    [];

  const playerResults =
    await mapWithConcurrency(
      rbCandidates,
      PLAYER_CONCURRENCY,

      async player => {
        try {
          const data =
            await tank01Fetch(
              "getNFLGamesForPlayer",
              {
                playerID:
                  player.playerID,

                season:
                  String(
                    baselineSeason
                  )
              }
            );

          const games =
            extractPlayerGames(
              data
            );

          const normalized =
            [];

          for (
            const game
            of games
          ) {
            const row =
              normalizeHistoricalPlayerGame({
                player,
                game,
                gameMap
              });

            if (
              row
            ) {
              normalized.push(
                row
              );
            } else if (
              game &&
              game.gameID &&
              gameMap.has(
                String(
                  game.gameID
                )
              )
            ) {
              unmatched.push({
                playerID:
                  player.playerID,

                playerName:
                  player.name,

                currentTeam:
                  player.team,

                gameID:
                  String(
                    game.gameID
                  )
              });
            }
          }

          return {
            playerID:
              player.playerID,

            playerName:
              player.name,

            games:
              normalized,

            error:
              null
          };
        } catch (
          error
        ) {
          return {
            playerID:
              player.playerID,

            playerName:
              player.name,

            games:
              [],

            error:
              error &&
              error.message
                ? error.message
                : String(
                    error
                  )
          };
        }
      }
    );

  const playerGames =
    [];

  const playerErrors =
    [];

  for (
    const result
    of playerResults
  ) {
    if (
      result.error
    ) {
      playerErrors.push({
        playerID:
          result.playerID,

        playerName:
          result.playerName,

        error:
          result.error
      });
    }

    playerGames.push(
      ...result.games
    );
  }

  return {
    candidatesFound:
      rbCandidates.length,

    playersLoaded:
      playerResults.length,

    playerGames,

    playerErrors,

    unmatched
  };
}


// ═══════════════════════════════════════════════════════════════════════
// FULL SCHEDULE INTELLIGENCE BUILD
// ═══════════════════════════════════════════════════════════════════════

async function buildRbScheduleIntelligence({
  targetSeason =
    DEFAULT_TARGET_SEASON,

  baselineSeason =
    null,

  scoring =
    "ppr",

  seasonType =
    DEFAULT_SEASON_TYPE,

  earlyWeeks =
    DEFAULT_EARLY_WEEKS,

  seasonWeeks =
    DEFAULT_SEASON_WEEKS,

  playoffWeeks =
    DEFAULT_PLAYOFF_WEEKS
} = {}) {
  const normalizedTargetSeason =
    integer(
      targetSeason,
      DEFAULT_TARGET_SEASON
    );

  const normalizedBaselineSeason =
    integer(
      baselineSeason,
      normalizedTargetSeason -
      1
    );

  const normalizedScoring =
    normalizeScoring(
      scoring
    );

  const normalizedSeasonType =
    normalizeSeasonType(
      seasonType
    );

  /*
    Step 1:
    Build prior-season schedules.

    These are used to map Tank01 historical player GAME_ID records to
    NFL week, historical team and defense faced.
  */
  const historicalSchedules =
    await buildSeasonSchedules({
      season:
        normalizedBaselineSeason,

      seasonType:
        normalizedSeasonType,

      weeks:
        DEFAULT_SEASON_WEEKS
    });

  /*
    Step 2:
    Collect every RB historical player-game row and attach the defense.
  */
  const historical =
    await loadHistoricalRbGames({
      baselineSeason:
        normalizedBaselineSeason,

      historicalSchedules
    });

  /*
    Step 3:
    Let the calculation module score each game and calculate defense
    versus RB ratings.

    #1 defense rank here means EASIEST for fantasy RB scoring:
    the defense allowed the most RB fantasy points per NFL game.
  */
  const defenseRatings =
    buildDefenseRbRatings({
      playerGames:
        historical.playerGames,

      scoring:
        normalizedScoring
    });

  /*
    Step 4:
    Build the target-season schedule.
  */
  const targetSchedules =
    await buildSeasonSchedules({
      season:
        normalizedTargetSeason,

      seasonType:
        normalizedSeasonType,

      weeks:
        DEFAULT_SEASON_WEEKS
    });

  const targetSchedule =
    flattenSchedules(
      targetSchedules
    );

  /*
    Step 5:
    Join opponent defensive strength to each team's target schedule
    and aggregate the requested schedule horizons.
  */
  const intelligence =
    buildLeagueScheduleIntelligence({
      schedule:
        targetSchedule,

      defenseRatings,

      scoring:
        normalizedScoring,

      earlyWeeks,

      seasonWeeks,

      playoffWeeks
    });

  /*
    Step 6:
    Add one concise consumer-facing Schedule Intelligence sentence
    per team.

    The underlying weekly evidence remains intact for detailed views.
  */
  const teams =
    (
      intelligence &&
      Array.isArray(
        intelligence.teams
      )
        ? intelligence.teams
        : []
    )
      .map(
        team => ({
          ...team,

          insight:
            buildScheduleInsight(
              team
            )
        })
      );

  return {
    evidenceType:
      "sage-schedule-intelligence",

    schemaVersion:
      1,

    generatedAt:
      new Date()
        .toISOString(),

    position:
      DEFAULT_POSITION,

    scoring:
      normalizedScoring,

    targetSeason:
      normalizedTargetSeason,

    baselineSeason:
      normalizedBaselineSeason,

    seasonType:
      normalizedSeasonType,

    methodology: {
      baseline:
        "Prior regular season RB fantasy production allowed by defense.",

      gameAggregation:
        "All opposing RB production is summed within each NFL game before defense averages are calculated.",

      rankingDirection:
        "Defense rank 1 allows the most RB fantasy points and is therefore the most favorable RB matchup.",

      byeHandling:
        "Bye and missing weeks are excluded from schedule averages rather than scored as zero.",

      scheduleSignal:
        "Schedule Intelligence remains separate from the core Draft SAGE recommendation calculation in V1."
    },

    windows: {
      earlySeason:
        earlyWeeks,

      fullSeason:
        seasonWeeks,

      fantasyPlayoffs:
        playoffWeeks
    },

    collection: {
      rbCandidatesFound:
        historical
          .candidatesFound,

      rbPlayersLoaded:
        historical
          .playersLoaded,

      historicalRbGameRows:
        historical
          .playerGames
          .length,

      playerErrors:
        historical
          .playerErrors
          .length,

      unmatchedHistoricalGames:
        historical
          .unmatched
          .length,

      historicalScheduleWeeks:
        historicalSchedules
          .length,

      targetScheduleWeeks:
        targetSchedules
          .length,

      targetScheduleGames:
        targetSchedule
          .length
    },

    warnings: {
      playerErrors:
        historical
          .playerErrors,

      unmatchedHistoricalGames:
        historical
          .unmatched
          .slice(
            0,
            50
          )
    },

    defenseRatings,

    teams
  };
}


// ═══════════════════════════════════════════════════════════════════════
// HTTP ENDPOINT
// ═══════════════════════════════════════════════════════════════════════

exports.handler =
  async function (
    event
  ) {
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

    const targetSeason =
      integer(
        query.season ??
        query.targetSeason,
        DEFAULT_TARGET_SEASON
      );

    const baselineSeason =
      integer(
        query.baselineSeason,
        targetSeason -
        1
      );

    const scoring =
      normalizeScoring(
        query.scoring ||
        "ppr"
      );

    const seasonType =
      normalizeSeasonType(
        query.seasonType
      );

    try {
      const result =
        await buildRbScheduleIntelligence({
          targetSeason,

          baselineSeason,

          scoring,

          seasonType,

          earlyWeeks:
            DEFAULT_EARLY_WEEKS,

          seasonWeeks:
            DEFAULT_SEASON_WEEKS,

          playoffWeeks:
            DEFAULT_PLAYOFF_WEEKS
        });

      return jsonResponse(
        200,
        result
      );
    } catch (
      error
    ) {
      console.error(
        "sage-schedule-intelligence-data failed:",
        error
      );

      return jsonResponse(
        502,
        {
          evidenceType:
            "sage-schedule-intelligence",

          error:
            "Could not build RB Schedule Intelligence.",

          detail:
            error &&
            error.message
              ? error.message
              : String(
                  error
                )
        }
      );
    }
  };


// ═══════════════════════════════════════════════════════════════════════
// TEST / FUTURE REFRESH EXPORTS
// ═══════════════════════════════════════════════════════════════════════

exports.buildRbScheduleIntelligence =
  buildRbScheduleIntelligence;

exports.buildSeasonSchedules =
  buildSeasonSchedules;

exports.buildGameMap =
  buildGameMap;

exports.flattenSchedules =
  flattenSchedules;

exports.extractPlayers =
  extractPlayers;

exports.extractPlayerGames =
  extractPlayerGames;

exports.opponentForTeam =
  opponentForTeam;

exports.normalizeHistoricalPlayerGame =
  normalizeHistoricalPlayerGame;

exports.loadHistoricalRbGames =
  loadHistoricalRbGames;
