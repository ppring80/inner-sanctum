// netlify/functions/sage-schedule-intelligence-data.js
//
// SAGE — SCHEDULE INTELLIGENCE DATA BUILDER V1.1
//
// PURPOSE
// -------
// Build trustworthy league-wide RB Schedule Intelligence from:
//
//   Tank01 player list
//   + Tank01 historical player game logs
//   + authoritative Weekly SAGE schedule
//   + sage-schedule-intelligence.js calculations
//
// THIS FILE OWNS
// --------------
// - historical RB discovery
// - historical RB game collection
// - historical team / opponent resolution
// - game deduplication
// - schedule collection
// - data-quality diagnostics
// - coverage validation
// - final Schedule Intelligence assembly
//
// THIS FILE DOES NOT
// ------------------
// - modify Draft SAGE scoring
// - modify Draft SAGE recommendation order
// - modify Opportunity Intelligence
// - modify Context Intelligence
// - modify Market Intelligence
// - modify Scarcity Intelligence
// - modify draft-sage-synthesis.js
//
// IMPORTANT V1 RULE
// -----------------
// Schedule Intelligence remains a separate, explainable signal.
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


// ═══════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════

const TANK01_HOST =
  "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";


const DEFAULT_SEASON_TYPE =
  "reg";


const DEFAULT_POSITION =
  "RB";


const DEFAULT_TARGET_SEASON =
  2026;


/*
  Request more than a regular-season maximum.

  The important point is that we NEVER rely on Tank01's default
  getNFLGamesForPlayer game count.
*/
const PLAYER_GAME_REQUEST_LIMIT =
  25;


/*
  Keep pressure on Tank01 intentionally low.

  This is a build / refresh path, not a customer-request path.
*/
const PLAYER_CONCURRENCY =
  2;


/*
  Basic quality gates.

  These are intentionally conservative.

  A defense normally plays 17 regular-season games. We should see
  substantially more than the 4-10 defense samples produced by the
  first incomplete collector.

  We do not require exactly 17 because:
  - a Tank01 player may be missing
  - positional classifications may vary
  - historical game evidence may occasionally be incomplete

  But a league-wide result averaging only a handful of games per
  defense is NOT acceptable Schedule Intelligence.
*/
const MIN_ACCEPTABLE_DEFENSE_GAMES =
  12;


const MIN_ACCEPTABLE_DEFENSES =
  28;


const MIN_ACCEPTABLE_HISTORICAL_ROWS =
  450;


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


// ═══════════════════════════════════════════════════════════════════════
// BASIC HELPERS
// ═══════════════════════════════════════════════════════════════════════

function num(
  value
) {
  const result =
    Number(
      value
    );

  return Number.isFinite(
    result
  )
    ? result
    : 0;
}


function integer(
  value,
  fallback = null
) {
  const result =
    Number(
      value
    );

  return Number.isInteger(
    result
  )
    ? result
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


function round(
  value,
  digits = 2
) {
  const n =
    Number(
      value
    );

  if (
    !Number.isFinite(
      n
    )
  ) {
    return null;
  }

  const factor =
    Math.pow(
      10,
      digits
    );

  return (
    Math.round(
      (
        n +
        Number.EPSILON
      ) *
      factor
    ) /
    factor
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
// PLAYER HELPERS
// ═══════════════════════════════════════════════════════════════════════

function playerIDOf(
  player
) {
  if (
    !player ||
    typeof player !==
      "object"
  ) {
    return "";
  }

  return String(
    player.playerID ??
    player.playerId ??
    player.id ??
    ""
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
    player.teamAbbreviation ??
    ""
  );
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

  const maxAttempts =
    4;

  let lastError =
    null;

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt += 1
  ) {
    try {
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
        response.ok
      ) {
        return data;
      }

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

      lastError =
        new Error(
          `Tank01 ${endpoint} failed: ${detail}`
        );

      /*
        Retry only server/rate-limit style failures.
      */
      if (
        response.status !== 429 &&
        response.status < 500
      ) {
        throw lastError;
      }
    } catch (
      error
    ) {
      lastError =
        error;
    }

    if (
      attempt <
      maxAttempts
    ) {
      const delay =
        attempt *
        500;

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            delay
          )
      );
    }
  }

  throw (
    lastError ||
    new Error(
      `Tank01 ${endpoint} failed.`
    )
  );
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
        /*
          Keep raw body.
        */
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
    return body
      .filter(
        game =>
          game &&
          typeof game ===
            "object"
      );
  }

  if (
    typeof body ===
      "object"
  ) {
    return Object.entries(
      body
    )
      .map(
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
      )
      .filter(
        game =>
          game &&
          game.gameID
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

  if (
    source.length ===
    0
  ) {
    return [];
  }

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

  async function workerLoop() {
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

  const workerCount =
    Math.min(
      limit,
      source.length
    );

  const workers =
    [];

  for (
    let index = 0;
    index < workerCount;
    index += 1
  ) {
    workers.push(
      workerLoop()
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

function normalizeRequestedWeeks(
  weeks
) {
  return Array.from(
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
}


async function buildSeasonSchedules({
  season,
  seasonType =
    DEFAULT_SEASON_TYPE,
  weeks =
    DEFAULT_SEASON_WEEKS
}) {
  const requestedWeeks =
    normalizeRequestedWeeks(
      weeks
    );

  const schedules =
    [];

  /*
    Intentionally serialized.

    We use the proven Weekly SAGE schedule builder as the
    authoritative source for game/week/team context.
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

    if (
      !schedule ||
      !Array.isArray(
        schedule.games
      )
    ) {
      throw new Error(
        `Weekly schedule build failed structural validation for ${season} Week ${week}.`
      );
    }

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

      if (
        !away ||
        !home
      ) {
        continue;
      }

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

  const seen =
    new Set();

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

      const gameID =
        String(
          game.gameID
        );

      if (
        seen.has(
          gameID
        )
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

      if (
        !away ||
        !home
      ) {
        continue;
      }

      seen.add(
        gameID
      );

      games.push({
        ...game,

        gameID,

        week:
          integer(
            game.week ??
            game.gameWeek,
            scheduleWeek
          ),

        away,

        home
      });
    }
  }

  return games;
}


// ═══════════════════════════════════════════════════════════════════════
// HISTORICAL TEAM / OPPONENT RESOLUTION
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
    return (
      home ||
      null
    );
  }

  if (
    normalizedTeam ===
    home
  ) {
    return (
      away ||
      null
    );
  }

  return null;
}


function historicalTeamCandidates(
  game,
  player
) {
  const rawCandidates =
    [
      game &&
      game.teamAbv,

      game &&
      game.team,

      game &&
      game.teamAbbr,

      game &&
      game.teamAbbreviation,

      game &&
      game.playerTeam,

      player &&
      player.historicalTeam,

      player &&
      player.team
    ];

  const result =
    [];

  const seen =
    new Set();

  for (
    const candidate
    of rawCandidates
  ) {
    const normalized =
      normalizeTeam(
        candidate
      );

    if (
      !normalized ||
      seen.has(
        normalized
      )
    ) {
      continue;
    }

    seen.add(
      normalized
    );

    result.push(
      normalized
    );
  }

  return result;
}


function inferHistoricalTeam({
  game,
  scheduleGame,
  player
}) {
  const candidates =
    historicalTeamCandidates(
      game,
      player
    );

  for (
    const team
    of candidates
  ) {
    if (
      opponentForTeam(
        scheduleGame,
        team
      )
    ) {
      return team;
    }
  }

  /*
    If Tank01 gives an explicit opponent but not player team,
    derive the player team from the schedule.
  */
  const explicitOpponent =
    normalizeTeam(
      game &&
      (
        game.opponent ??
        game.opponentAbv ??
        game.opp ??
        game.oppAbv ??
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
      return (
        home ||
        null
      );
    }

    if (
      explicitOpponent ===
      home
    ) {
      return (
        away ||
        null
      );
    }
  }

  return null;
}


// ═══════════════════════════════════════════════════════════════════════
// HISTORICAL GAME NORMALIZATION
// ═══════════════════════════════════════════════════════════════════════

function normalizeHistoricalPlayerGame({
  player,
  game,
  gameMap
}) {
  if (
    !game ||
    !game.gameID
  ) {
    return {
      ok:
        false,

      reason:
        "missing-game-id",

      row:
        null
    };
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
    return {
      ok:
        false,

      reason:
        "schedule-game-not-found",

      gameID,

      row:
        null
    };
  }

  const team =
    inferHistoricalTeam({
      game,
      scheduleGame,
      player
    });

  if (
    !team
  ) {
    return {
      ok:
        false,

      reason:
        "historical-team-not-resolved",

      gameID,

      row:
        null
    };
  }

  const defense =
    opponentForTeam(
      scheduleGame,
      team
    );

  if (
    !defense
  ) {
    return {
      ok:
        false,

      reason:
        "opponent-not-resolved",

      gameID,

      row:
        null
    };
  }

  return {
    ok:
      true,

    reason:
      null,

    row: {
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
    }
  };
}


// ═══════════════════════════════════════════════════════════════════════
// DEDUPLICATION
// ═══════════════════════════════════════════════════════════════════════

function dedupeHistoricalRows(
  rows
) {
  const seen =
    new Set();

  const result =
    [];

  let duplicateCount =
    0;

  for (
    const row
    of (
      Array.isArray(
        rows
      )
        ? rows
        : []
    )
  ) {
    if (
      !row ||
      !row.playerID ||
      !row.gameID
    ) {
      continue;
    }

    const key =
      `${row.playerID}|${row.gameID}`;

    if (
      seen.has(
        key
      )
    ) {
      duplicateCount +=
        1;

      continue;
    }

    seen.add(
      key
    );

    result.push(
      row
    );
  }

  return {
    rows:
      result,

    duplicateCount
  };
}


// ═══════════════════════════════════════════════════════════════════════
// HISTORICAL RB COLLECTION
// ═══════════════════════════════════════════════════════════════════════

async function loadHistoricalRbGames({
  baselineSeason,
  historicalSchedules
}) {
  /*
    IMPORTANT:

    all=true is intentional.

    We want the broadest Tank01 player population available rather
    than relying on a filtered active-player list.
  */
  const playerListData =
    await tank01Fetch(
      "getNFLPlayerList",
      {
        all:
          "true"
      }
    );

  const allPlayers =
    extractPlayers(
      playerListData
    );

  const rbCandidates =
    allPlayers
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
            ),

          rawPosition:
            playerPositionOf(
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

  /*
    Remove duplicate player IDs from player-list evidence.
  */
  const uniqueCandidates =
    [];

  const candidateIDs =
    new Set();

  for (
    const player
    of rbCandidates
  ) {
    if (
      candidateIDs.has(
        player.playerID
      )
    ) {
      continue;
    }

    candidateIDs.add(
      player.playerID
    );

    uniqueCandidates.push(
      player
    );
  }

  const gameMap =
    buildGameMap(
      historicalSchedules
    );

  const diagnostics = {
    totalPlayerListRecords:
      allPlayers.length,

    rbCandidateRecords:
      rbCandidates.length,

    uniqueRbCandidates:
      uniqueCandidates.length,

    rawHistoricalGameRecords:
      0,

    matchedHistoricalGameRecords:
      0,

    duplicateHistoricalGameRecords:
      0,

    missingGameID:
      0,

    missingScheduleGame:
      0,

    unresolvedHistoricalTeam:
      0,

    unresolvedOpponent:
      0
  };

  const collectionProblems =
    [];

  const playerResults =
    await mapWithConcurrency(
      uniqueCandidates,
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
                  ),

                numberOfGames:
                  PLAYER_GAME_REQUEST_LIMIT
              }
            );

          const games =
            extractPlayerGames(
              data
            );

          const normalizedRows =
            [];

          const rejectedRows =
            [];

          for (
            const game
            of games
          ) {
            const normalized =
              normalizeHistoricalPlayerGame({
                player,
                game,
                gameMap
              });

            if (
              normalized.ok
            ) {
              normalizedRows.push(
                normalized.row
              );
            } else {
              rejectedRows.push({
                reason:
                  normalized.reason,

                gameID:
                  normalized.gameID ||
                  (
                    game &&
                    game.gameID
                      ? String(
                          game.gameID
                        )
                      : null
                  )
              });
            }
          }

          return {
            playerID:
              player.playerID,

            playerName:
              player.name,

            currentTeam:
              player.team,

            rawGamesReturned:
              games.length,

            normalizedRows,

            rejectedRows,

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

            currentTeam:
              player.team,

            rawGamesReturned:
              0,

            normalizedRows:
              [],

            rejectedRows:
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

  const playerErrors =
    [];

  const allNormalizedRows =
    [];

  const playerGameCounts =
    [];

  for (
    const result
    of playerResults
  ) {
    diagnostics
      .rawHistoricalGameRecords +=
        result.rawGamesReturned;

    diagnostics
      .matchedHistoricalGameRecords +=
        result.normalizedRows.length;

    if (
      result.error
    ) {
      playerErrors.push({
        playerID:
          result.playerID,

        playerName:
          result.playerName,

        currentTeam:
          result.currentTeam,

        error:
          result.error
      });

      continue;
    }

    for (
      const rejected
      of result.rejectedRows
    ) {
      switch (
        rejected.reason
      ) {
        case "missing-game-id":
          diagnostics
            .missingGameID +=
              1;
          break;

        case "schedule-game-not-found":
          diagnostics
            .missingScheduleGame +=
              1;
          break;

        case "historical-team-not-resolved":
          diagnostics
            .unresolvedHistoricalTeam +=
              1;
          break;

        case "opponent-not-resolved":
          diagnostics
            .unresolvedOpponent +=
              1;
          break;

        default:
          break;
      }

      if (
        collectionProblems.length <
        100
      ) {
        collectionProblems.push({
          playerID:
            result.playerID,

          playerName:
            result.playerName,

          currentTeam:
            result.currentTeam,

          gameID:
            rejected.gameID,

          reason:
            rejected.reason
        });
      }
    }

    allNormalizedRows.push(
      ...result.normalizedRows
    );

    playerGameCounts.push({
      playerID:
        result.playerID,

      playerName:
        result.playerName,

      currentTeam:
        result.currentTeam,

      rawGamesReturned:
        result.rawGamesReturned,

      matchedGames:
        result.normalizedRows.length,

      rejectedGames:
        result.rejectedRows.length
    });
  }

  const deduped =
    dedupeHistoricalRows(
      allNormalizedRows
    );

  diagnostics
    .duplicateHistoricalGameRecords =
      deduped.duplicateCount;

  /*
    Sort diagnostics with highest-volume players first.
  */
  playerGameCounts.sort(
    (a, b) =>
      b.matchedGames -
      a.matchedGames
  );

  return {
    candidatesFound:
      uniqueCandidates.length,

    playersLoaded:
      playerResults.length,

    playerGames:
      deduped.rows,

    playerErrors,

    collectionProblems,

    playerGameCounts,

    diagnostics
  };
}


// ═══════════════════════════════════════════════════════════════════════
// COVERAGE DIAGNOSTICS
// ═══════════════════════════════════════════════════════════════════════

function buildDefenseCoverage(
  defenseRatings
) {
  const ratings =
    Array.isArray(
      defenseRatings
    )
      ? defenseRatings
      : [];

  const rows =
    ratings
      .filter(
        item =>
          item &&
          item.defense
      )
      .map(
        item => ({
          defense:
            item.defense,

          gamesSampled:
            num(
              item.gamesSampled
            ),

          fantasyPointsAllowed:
            item
              .fantasyPointsAllowed,

          rank:
            item.rank,

          outlook:
            item.outlook
        })
      )
      .sort(
        (a, b) =>
          a.gamesSampled -
          b.gamesSampled
      );

  const completeEnough =
    rows.filter(
      item =>
        item.gamesSampled >=
        MIN_ACCEPTABLE_DEFENSE_GAMES
    );

  const belowThreshold =
    rows.filter(
      item =>
        item.gamesSampled <
        MIN_ACCEPTABLE_DEFENSE_GAMES
    );

  const totalGames =
    rows.reduce(
      (
        sum,
        item
      ) =>
        sum +
        item.gamesSampled,
      0
    );

  const averageGamesSampled =
    rows.length > 0
      ? round(
          totalGames /
          rows.length,
          2
        )
      : 0;

  return {
    defensesRated:
      rows.length,

    defensesMeetingMinimumSample:
      completeEnough.length,

    minimumGamesRequired:
      MIN_ACCEPTABLE_DEFENSE_GAMES,

    averageGamesSampled,

    lowestGamesSampled:
      rows.length > 0
        ? rows[0]
            .gamesSampled
        : 0,

    highestGamesSampled:
      rows.length > 0
        ? rows[
            rows.length -
            1
          ]
            .gamesSampled
        : 0,

    belowThreshold
  };
}


function buildQualityGate({
  historical,
  defenseCoverage,
  targetScheduleGames
}) {
  const checks =
    [];

  function addCheck(
    name,
    passed,
    actual,
    expected
  ) {
    checks.push({
      name,

      passed:
        Boolean(
          passed
        ),

      actual,

      expected
    });
  }

  addCheck(
    "historical-rb-game-volume",

    historical
      .playerGames
      .length >=
      MIN_ACCEPTABLE_HISTORICAL_ROWS,

    historical
      .playerGames
      .length,

    `>= ${MIN_ACCEPTABLE_HISTORICAL_ROWS}`
  );


  addCheck(
    "defenses-rated",

    defenseCoverage
      .defensesRated >=
      MIN_ACCEPTABLE_DEFENSES,

    defenseCoverage
      .defensesRated,

    `>= ${MIN_ACCEPTABLE_DEFENSES}`
  );


  addCheck(
    "defenses-with-adequate-sample",

    defenseCoverage
      .defensesMeetingMinimumSample >=
      MIN_ACCEPTABLE_DEFENSES,

    defenseCoverage
      .defensesMeetingMinimumSample,

    `>= ${MIN_ACCEPTABLE_DEFENSES}`
  );


  addCheck(
    "player-api-errors",

    historical
      .playerErrors
      .length ===
      0,

    historical
      .playerErrors
      .length,

    0
  );


  addCheck(
    "target-schedule-game-count",

    targetScheduleGames >=
      270,

    targetScheduleGames,

    ">= 270"
  );


  const failedChecks =
    checks.filter(
      check =>
        !check.passed
    );

  return {
    passed:
      failedChecks.length ===
      0,

    status:
      failedChecks.length ===
      0
        ? "PASS"
        : "FAIL",

    checks,

    failedChecks
  };
}


// ═══════════════════════════════════════════════════════════════════════
// MAIN BUILD
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


  // ════════════════════════════════════════════════════════════════════
  // STEP 1
  // Build prior-season schedule
  // ════════════════════════════════════════════════════════════════════

  const historicalSchedules =
    await buildSeasonSchedules({
      season:
        normalizedBaselineSeason,

      seasonType:
        normalizedSeasonType,

      weeks:
        DEFAULT_SEASON_WEEKS
    });


  // ════════════════════════════════════════════════════════════════════
  // STEP 2
  // Collect historical RB player games
  // ════════════════════════════════════════════════════════════════════

  const historical =
    await loadHistoricalRbGames({
      baselineSeason:
        normalizedBaselineSeason,

      historicalSchedules
    });


  // ════════════════════════════════════════════════════════════════════
  // STEP 3
  // Calculate defense-vs-RB ratings
  // ════════════════════════════════════════════════════════════════════

  const defenseRatings =
    buildDefenseRbRatings({
      playerGames:
        historical
          .playerGames,

      scoring:
        normalizedScoring
    });


  // ════════════════════════════════════════════════════════════════════
  // STEP 4
  // Validate historical defense coverage
  // ════════════════════════════════════════════════════════════════════

  const defenseCoverage =
    buildDefenseCoverage(
      defenseRatings
    );


  // ════════════════════════════════════════════════════════════════════
  // STEP 5
  // Build target-season schedule
  // ════════════════════════════════════════════════════════════════════

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


  // ════════════════════════════════════════════════════════════════════
  // STEP 6
  // Quality gate BEFORE calling the output trusted
  // ════════════════════════════════════════════════════════════════════

  const qualityGate =
    buildQualityGate({
      historical,

      defenseCoverage,

      targetScheduleGames:
        targetSchedule.length
    });


  /*
    We still calculate the schedule result when the quality gate fails.

    WHY:
    - diagnostics remain inspectable
    - development is easier
    - we can see exactly what coverage remains missing

    BUT:
    trustedForProduction is false and consumers must not use it.
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


  // ════════════════════════════════════════════════════════════════════
  // FINAL RESPONSE
  // ════════════════════════════════════════════════════════════════════

  return {
    evidenceType:
      "sage-schedule-intelligence",

    schemaVersion:
      2,

    generatedAt:
      new Date()
        .toISOString(),

    trustedForProduction:
      qualityGate.passed,

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
        "Prior regular-season RB fantasy production allowed by defense.",

      playerGameRequestLimit:
        PLAYER_GAME_REQUEST_LIMIT,

      gameAggregation:
        "All opposing RB production is summed within each NFL game before defense averages are calculated.",

      rankingDirection:
        "Defense rank 1 allows the most RB fantasy points and is therefore the most favorable RB matchup.",

      byeHandling:
        "Bye and missing weeks are excluded from schedule averages rather than scored as zero.",

      scheduleSignal:
        "Schedule Intelligence remains separate from the core Draft SAGE recommendation calculation in V1.",

      qualityRule:
        "Schedule Intelligence must pass historical evidence coverage checks before trustedForProduction becomes true."
    },

    windows: {
      earlySeason:
        normalizeRequestedWeeks(
          earlyWeeks
        ),

      fullSeason:
        normalizeRequestedWeeks(
          seasonWeeks
        ),

      fantasyPlayoffs:
        normalizeRequestedWeeks(
          playoffWeeks
        )
    },

    collection: {
      totalPlayerListRecords:
        historical
          .diagnostics
          .totalPlayerListRecords,

      rbCandidateRecords:
        historical
          .diagnostics
          .rbCandidateRecords,

      uniqueRbCandidates:
        historical
          .diagnostics
          .uniqueRbCandidates,

      rbPlayersLoaded:
        historical
          .playersLoaded,

      rawHistoricalGameRecords:
        historical
          .diagnostics
          .rawHistoricalGameRecords,

      historicalRbGameRows:
        historical
          .playerGames
          .length,

      duplicateHistoricalGameRecords:
        historical
          .diagnostics
          .duplicateHistoricalGameRecords,

      missingGameID:
        historical
          .diagnostics
          .missingGameID,

      missingScheduleGame:
        historical
          .diagnostics
          .missingScheduleGame,

      unresolvedHistoricalTeam:
        historical
          .diagnostics
          .unresolvedHistoricalTeam,

      unresolvedOpponent:
        historical
          .diagnostics
          .unresolvedOpponent,

      playerErrors:
        historical
          .playerErrors
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

    qualityGate,

    defenseCoverage,

    warnings: {
      playerErrors:
        historical
          .playerErrors
          .slice(
            0,
            50
          ),

      collectionProblems:
        historical
          .collectionProblems
          .slice(
            0,
            100
          )
    },

    diagnostics: {
      playerGameCounts:
        historical
          .playerGameCounts
    },

    defenseRatings,

    teams
  };
}


// ═══════════════════════════════════════════════════════════════════════
// HTTP HANDLER
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

          trustedForProduction:
            false,

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
// EXPORTS FOR TESTING / FUTURE REFRESHER
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


exports.historicalTeamCandidates =
  historicalTeamCandidates;


exports.inferHistoricalTeam =
  inferHistoricalTeam;


exports.normalizeHistoricalPlayerGame =
  normalizeHistoricalPlayerGame;


exports.dedupeHistoricalRows =
  dedupeHistoricalRows;


exports.loadHistoricalRbGames =
  loadHistoricalRbGames;


exports.buildDefenseCoverage =
  buildDefenseCoverage;


exports.buildQualityGate =
  buildQualityGate;


exports.normalizeRequestedWeeks =
  normalizeRequestedWeeks;
