// netlify/functions/weekly-sage-wr-snapshot.js
//
// WEEKLY SAGE — WR POPULATION SNAPSHOT
//
// PURPOSE
// -------
// Build the reusable Wide Receiver peer population entering a target week.
//
// This version persists completed weekly WR snapshots in Netlify Blobs.
// Normal customer/leaderboard requests reuse the saved snapshot.
// Expensive refreshes are triggered explicitly by the background refresh
// function.
//
// CRITICAL NO-LOOK-AHEAD RULE
// ---------------------------
// Target Week 8 may use ONLY Weeks 1-7.
// The target week's game is never eligible.
//
// HISTORICAL IDENTITY RULE
// ------------------------
// A player's team in historical evidence is taken from his latest matched
// pre-target player-game record. The current Tank01 player-list team is kept
// separately as currentTeam.
//
// ═══════════════════════════════════════════════════════════════════════

const {
  getStore
} = require(
  "@netlify/blobs"
);

const SNAPSHOT_STORE =
  "weekly-sage-wr-snapshots";

const TANK01_HOST =
  "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";

const DEFAULT_SEASON_TYPE =
  "reg";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

const POSITION =
  "WR";

const MINIMUM_GAMES =
  2;

const MINIMUM_TARGETS_PER_GAME =
  3;

/*
  Snapshot generation is intentionally conservative.

  Since a completed snapshot is persisted and reused, reliability
  matters more than raw refresh speed.
*/
const PLAYER_CONCURRENCY =
  1;

const SCHEDULE_CONCURRENCY =
  1;

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

function normalizeTeam(
  value
) {
  return String(
    value ||
    ""
  )
    .trim()
    .toUpperCase();
}

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

function sleep(
  ms
) {
  return new Promise(
    function (
      resolve
    ) {
      setTimeout(
        resolve,
        ms
      );
    }
  );
}

function snapshotBlobKey({
  season,
  targetWeek,
  seasonType
}) {
  return (
    `wr/${season}/${seasonType}/week-${targetWeek}`
  );
}

function refreshRequested(
  value
) {
  const normalized =
    String(
      value ||
      ""
    )
      .trim()
      .toLowerCase();

  return [
    "1",
    "true",
    "yes",
    "refresh"
  ].includes(
    normalized
  );
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
    5;

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt += 1
  ) {
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
        await response
          .json();
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

    const lowerDetail =
      String(
        detail ||
        ""
      )
        .toLowerCase();

    const rateLimited =
      response.status ===
        429 ||
      lowerDetail.includes(
        "too many requests"
      );

    if (
      rateLimited &&
      attempt <
        maxAttempts
    ) {
      const delayMs =
        attempt *
        1500;

      console.warn(
        `Tank01 rate limit on ${endpoint}. Retry ${attempt}/${maxAttempts - 1} after ${delayMs}ms.`
      );

      await sleep(
        delayMs
      );

      continue;
    }

    throw new Error(
      `Tank01 ${endpoint} failed: ${detail}`
    );
  }

  throw new Error(
    `Tank01 ${endpoint} failed after retries.`
  );
}

function getBaseUrl(
  event
) {
  const headers =
    event.headers ||
    {};

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

  if (
    !host
  ) {
    throw new Error(
      "Could not determine host."
    );
  }

  return (
    `${proto}://${host}`
  );
}

async function fetchJson(
  url
) {
  const response =
    await fetch(
      url,
      {
        method:
          "GET",

        headers: {
          Accept:
            "application/json"
        }
      }
    );

  let data =
    null;

  try {
    data =
      await response
        .json();
  } catch (
    error
  ) {
    data =
      null;
  }

  if (
    !response.ok
  ) {
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
    await fetchJson(
      url
    );

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

  let nextIndex =
    0;

  async function runner() {
    while (
      true
    ) {
      const index =
        nextIndex++;

      if (
        index >=
        items.length
      ) {
        return;
      }

      results[
        index
      ] =
        await worker(
          items[
            index
          ],
          index
        );
    }
  }

  const runnerCount =
    Math.min(
      limit,
      items.length
    );

  const runners =
    [];

  for (
    let i = 0;
    i <
    runnerCount;
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
    targetWeek <=
    1
  ) {
    return {
      weeksIncluded:
        [],

      gameMap:
        new Map()
    };
  }

  const weeksIncluded =
    Array.from(
      {
        length:
          targetWeek -
          1
      },
      function (
        _,
        index
      ) {
        return (
          index +
          1
        );
      }
    );

  const schedules =
    await mapWithConcurrency(
      weeksIncluded,
      SCHEDULE_CONCURRENCY,
      function (
        week
      ) {
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
      if (
        !game.gameID
      ) {
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

function extractPlayerList(
  data
) {
  if (
    !data ||
    !Array.isArray(
      data.body
    )
  ) {
    return [];
  }

  return data.body;
}

function extractPlayerGames(
  data
) {
  if (
    !data ||
    !data.body
  ) {
    return [];
  }

  if (
    Array.isArray(
      data.body
    )
  ) {
    return data.body;
  }

  if (
    typeof data.body ===
      "object"
  ) {
    return Object.entries(
      data.body
    ).map(
      function ([
        gameID,
        game
      ]) {
        return {
          ...(
            game ||
            {}
          ),

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
    !game[
      key
    ] ||
    typeof game[
      key
    ] !==
      "object"
  ) {
    return {};
  }

  return game[
    key
  ];
}

function receivingStats(
  game
) {
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

function rushingStats(
  game
) {
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

function snapStats(
  game
) {
  const stats =
    statBlock(
      game,
      "snapCounts"
    );

  const offense =
    num(
      stats.offSnap ??
      stats.offense ??
      stats.offensiveSnaps ??
      stats.offSnaps
    );

  let offensePct =
    num(
      stats.offSnapPct ??
      stats.offensePct ??
      stats.offensiveSnapPct
    );

  if (
    offensePct >
      0 &&
    offensePct <=
      1
  ) {
    offensePct *=
      100;
  }

  return {
    offense,

    offensePct
  };
}

function gameTeam(
  game
) {
  return normalizeTeam(
    game &&
    (
      game.teamAbv ||
      game.team
    )
  );
}

function attachScheduleContext(
  playerGames,
  gameMap
) {
  const games =
    [];

  for (
    const game of
    playerGames
  ) {
    const schedule =
      gameMap.get(
        game.gameID
      );

    if (
      !schedule
    ) {
      continue;
    }

    games.push({
      ...game,

      sageWeek:
        schedule.week,

      sageGameDate:
        schedule.gameDate,

      sageGameTime:
        schedule.gameTime,

      sageGameStatus:
        schedule.gameStatus
    });
  }

  games.sort(
    function (
      a,
      b
    ) {
      return (
        num(
          a.sageWeek
        ) -
        num(
          b.sageWeek
        )
      );
    }
  );

  return games;
}

function aggregateGames(
  games
) {
  const totals = {
    games:
      0,

    receiving: {
      targets:
        0,

      receptions:
        0,

      yards:
        0,

      touchdowns:
        0
    },

    rushing: {
      carries:
        0,

      yards:
        0,

      touchdowns:
        0
    },

    snaps: {
      offense:
        0,

      offensePctTotal:
        0,

      offensePctGames:
        0
    }
  };

  for (
    const game of
    games
  ) {
    const receiving =
      receivingStats(
        game
      );

    const rushing =
      rushingStats(
        game
      );

    const snaps =
      snapStats(
        game
      );

    totals.games +=
      1;

    totals
      .receiving
      .targets +=
        receiving.targets;

    totals
      .receiving
      .receptions +=
        receiving.receptions;

    totals
      .receiving
      .yards +=
        receiving.yards;

    totals
      .receiving
      .touchdowns +=
        receiving.touchdowns;

    totals
      .rushing
      .carries +=
        rushing.carries;

    totals
      .rushing
      .yards +=
        rushing.yards;

    totals
      .rushing
      .touchdowns +=
        rushing.touchdowns;

    totals
      .snaps
      .offense +=
        snaps.offense;

    if (
      snaps.offensePct >
      0
    ) {
      totals
        .snaps
        .offensePctTotal +=
          snaps.offensePct;

      totals
        .snaps
        .offensePctGames +=
          1;
    }
  }

  return totals;
}

function buildWRRecord({
  player,
  priorGames
}) {
  const totals =
    aggregateGames(
      priorGames
    );

  const games =
    totals.games;

  const targets =
    totals
      .receiving
      .targets;

  const receptions =
    totals
      .receiving
      .receptions;

  const carries =
    totals
      .rushing
      .carries;

  const targetsPerGame =
    games
      ? round(
          targets /
          games
        )
      : 0;

  const receptionsPerGame =
    games
      ? round(
          receptions /
          games
        )
      : 0;

  const carriesPerGame =
    games
      ? round(
          carries /
          games
        )
      : 0;

  const opportunitiesPerGame =
    games
      ? round(
          (
            targets +
            carries
          ) /
          games
        )
      : 0;

  const offensiveSnapPct =
    totals
      .snaps
      .offensePctGames >
    0
      ? round(
          totals
            .snaps
            .offensePctTotal /
          totals
            .snaps
            .offensePctGames,
          1
        )
      : 0;

  const receivingYardsPerGame =
    games
      ? round(
          totals
            .receiving
            .yards /
          games
        )
      : 0;

  const yardsPerTarget =
    targets
      ? round(
          totals
            .receiving
            .yards /
          targets
        )
      : 0;

  const yardsPerReception =
    receptions
      ? round(
          totals
            .receiving
            .yards /
          receptions
        )
      : 0;

  const catchRate =
    targets
      ? round(
          (
            receptions /
            targets
          ) *
          100,
          1
        )
      : 0;

  const receivingTDPerGame =
    games
      ? round(
          totals
            .receiving
            .touchdowns /
          games
        )
      : 0;

  const rushingYardsPerGame =
    games
      ? round(
          totals
            .rushing
            .yards /
          games
        )
      : 0;

  const rushingTDPerGame =
    games
      ? round(
          totals
            .rushing
            .touchdowns /
          games
        )
      : 0;

  const scrimmageYardsPerGame =
    games
      ? round(
          (
            totals
              .receiving
              .yards +
            totals
              .rushing
              .yards
          ) /
          games
        )
      : 0;

  const totalTDPerGame =
    games
      ? round(
          (
            totals
              .receiving
              .touchdowns +
            totals
              .rushing
              .touchdowns
          ) /
          games
        )
      : 0;

  const latestGame =
    priorGames.length
      ? priorGames[
          priorGames.length -
          1
        ]
      : null;

  const historicalTeam =
    gameTeam(
      latestGame
    ) ||
    normalizeTeam(
      player.teamAbv ||
      player.team
    );

  const currentTeam =
    normalizeTeam(
      player.teamAbv ||
      player.team
    );

  const weeksIncluded =
    priorGames
      .map(
        function (
          game
        ) {
          return game.sageWeek;
        }
      )
      .filter(
        Number.isInteger
      )
      .sort(
        function (
          a,
          b
        ) {
          return (
            a -
            b
          );
        }
      );

  return {
    playerID:
      String(
        player.playerID ||
        ""
      ),

    name:
      player.longName ||
      player.name ||
      null,

    team:
      historicalTeam ||
      null,

    currentTeam:
      currentTeam ||
      null,

    position:
      POSITION,

    gamesUsed:
      games,

    weeksIncluded,

    historicalIdentity: {
      teamEnteringTargetWeek:
        historicalTeam ||
        null,

      currentRosterTeam:
        currentTeam ||
        null,

      teamSource:
        latestGame
          ? "latest_prior_player_game"
          : "current_player_list_fallback"
    },

    role: {
      targetsPerGame,

      receptionsPerGame,

      carriesPerGame,

      opportunitiesPerGame,

      offensiveSnapPct
    },

    production: {
      receivingYardsPerGame,

      yardsPerTarget,

      yardsPerReception,

      catchRate,

      receivingTDPerGame,

      rushingYardsPerGame,

      rushingTDPerGame,

      scrimmageYardsPerGame,

      totalTDPerGame
    }
  };
}

function eligibilityReason(
  record
) {
  if (
    record.gamesUsed <
    MINIMUM_GAMES
  ) {
    return (
      "insufficient_games"
    );
  }

  if (
    record
      .role
      .targetsPerGame <
    MINIMUM_TARGETS_PER_GAME
  ) {
    return (
      "insufficient_targets"
    );
  }

  return null;
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

    const seasonType =
      String(
        query.seasonType ||
        DEFAULT_SEASON_TYPE
      )
        .trim()
        .toLowerCase();

    const forceRefresh =
      refreshRequested(
        query.refresh
      );

    if (
      !Number.isInteger(
        targetWeek
      ) ||
      targetWeek <
        2 ||
      targetWeek >
        18
    ) {
      return jsonResponse(
        400,
        {
          error:
            "week must be an integer from 2 through 18."
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
      const store =
        getStore(
          SNAPSHOT_STORE
        );

      const blobKey =
        snapshotBlobKey({
          season,
          targetWeek,
          seasonType
        });

      /*
        NORMAL PRODUCTION PATH
        ----------------------
        Serve the previously completed weekly snapshot.

        No Tank01 calls.
      */
      if (
        !forceRefresh
      ) {
        const savedSnapshot =
          await store.get(
            blobKey,
            {
              type:
                "json"
            }
          );

        if (
          savedSnapshot
        ) {
          return jsonResponse(
            200,
            savedSnapshot,
            CACHE_CONTROL
          );
        }

        return jsonResponse(
          404,
          {
            error:
              "Weekly SAGE WR snapshot has not been generated yet.",

            detail:
              `No saved WR snapshot exists for ${season} Week ${targetWeek} (${seasonType}). Run weekly-sage-wr-snapshot-refresh-background first.`,

            snapshotKey:
              blobKey
          }
        );
      }

      /*
        EXPLICIT REFRESH PATH
        ---------------------
        This is intended to be invoked by the background refresh
        function, not by customer-facing leaderboard traffic.
      */

      const baseUrl =
        getBaseUrl(
          event
        );

      const [
        playerListResult,
        scheduleContext
      ] =
        await Promise.all([
          tank01Fetch(
            "getNFLPlayerList",
            {}
          ),

          buildPriorWeekScheduleMap({
            baseUrl,
            season,
            targetWeek,
            seasonType
          })
        ]);

      const nflPlayers =
        extractPlayerList(
          playerListResult
        );

      const wrCandidates =
        nflPlayers
          .filter(
            function (
              player
            ) {
              return (
                normalizePosition(
                  player.pos ||
                  player.position
                ) ===
                  POSITION &&
                player.playerID
              );
            }
          )
          .map(
            function (
              player
            ) {
              return {
                ...player,

                playerID:
                  String(
                    player.playerID
                  )
              };
            }
          );

      const playerResults =
        await mapWithConcurrency(
          wrCandidates,
          PLAYER_CONCURRENCY,
          async function (
            player
          ) {
            try {
              const gamesResult =
                await tank01Fetch(
                  "getNFLGamesForPlayer",
                  {
                    playerID:
                      player.playerID,

                    season
                  }
                );

              const allGames =
                extractPlayerGames(
                  gamesResult
                );

              const priorGames =
                attachScheduleContext(
                  allGames,
                  scheduleContext
                    .gameMap
                );

              const record =
                buildWRRecord({
                  player,
                  priorGames
                });

              return {
                ok:
                  true,

                playerID:
                  player.playerID,

                record
              };
            } catch (
              error
            ) {
              return {
                ok:
                  false,

                playerID:
                  player.playerID,

                name:
                  player.longName ||
                  player.name ||
                  null,

                detail:
                  error.message
              };
            }
          }
        );

      const successful =
        playerResults
          .filter(
            function (
              result
            ) {
              return (
                result &&
                result.ok
              );
            }
          );

      const failures =
        playerResults
          .filter(
            function (
              result
            ) {
              return (
                result &&
                !result.ok
              );
            }
          );

      const records =
        successful
          .map(
            function (
              result
            ) {
              return (
                result.record
              );
            }
          );

      const ineligibleCounts = {
        insufficient_games:
          0,

        insufficient_targets:
          0
      };

      const population =
        [];

      for (
        const record of
        records
      ) {
        const reason =
          eligibilityReason(
            record
          );

        if (
          reason
        ) {
          ineligibleCounts[
            reason
          ] +=
            1;

          continue;
        }

        population.push(
          record
        );
      }

      population.sort(
        function (
          a,
          b
        ) {
          const volumeDifference =
            b.role
              .targetsPerGame -
            a.role
              .targetsPerGame;

          if (
            volumeDifference !==
            0
          ) {
            return (
              volumeDifference
            );
          }

          return String(
            a.name ||
            ""
          ).localeCompare(
            String(
              b.name ||
              ""
            )
          );
        }
      );

      const snapshot = {
        evidenceType:
          "weekly-sage-wr-snapshot",

        schemaVersion:
          1,

        generatedAt:
          new Date()
            .toISOString(),

        season,

        targetWeek,

        seasonType,

        snapshotKey:
          `${season}|${targetWeek}|${seasonType}|WR`,

        noLookAhead: {
          rule:
            `Only Weeks 1 through ${targetWeek - 1} are eligible.`,

          weeksQueried:
            scheduleContext
              .weeksIncluded,

          targetWeekExcluded:
            true
        },

        methodology: {
          position:
            POSITION,

          minimumGames:
            MINIMUM_GAMES,

          minimumTargetsPerGame:
            MINIMUM_TARGETS_PER_GAME,

          tank01PlayerConcurrency:
            PLAYER_CONCURRENCY,

          historicalIdentity:
            "Latest matched pre-target player-game team is authoritative. Current roster team is preserved separately.",

          architecture:
            "Build the WR population once, persist it, and reuse the completed weekly snapshot for downstream scoring.",

          roleEvidence: [
            "targetsPerGame",
            "receptionsPerGame",
            "carriesPerGame",
            "opportunitiesPerGame",
            "offensiveSnapPct"
          ],

          productionEvidence: [
            "receivingYardsPerGame",
            "yardsPerTarget",
            "yardsPerReception",
            "catchRate",
            "receivingTDPerGame",
            "rushingYardsPerGame",
            "rushingTDPerGame",
            "scrimmageYardsPerGame",
            "totalTDPerGame"
          ],

          important:
            "This snapshot contains raw WR peer evidence only. It does not calculate a final SAGE score, weight components, or create recommendations."
        },

        populationSummary: {
          nflPlayersReturned:
            nflPlayers.length,

          wrCandidatesDiscovered:
            wrCandidates.length,

          successfulPlayerGameResponses:
            successful.length,

          playerGameFailures:
            failures.length,

          recordsBuilt:
            records.length,

          eligibleWRPopulation:
            population.length,

          ineligible:
            ineligibleCounts
        },

        population,

        failures,

        nextStep: {
          ready:
            population.length >
              0 &&
            failures.length ===
              0,

          reason:
            failures.length ===
            0
              ? "WR peer snapshot built successfully and persisted for downstream reuse."
              : "WR snapshot built with one or more player-game failures. Resolve failures before using the population as the WR benchmark universe."
        },

        provenance: {
          playerIdentity:
            "Tank01 getNFLPlayerList",

          playerGames:
            "Tank01 getNFLGamesForPlayer",

          noLookAheadSchedule:
            "weekly-sage-schedule",

          persistence:
            "Netlify Blobs",

          directTank01Calls:
            1 +
            wrCandidates.length
        }
      };

      /*
        Persist only the completed snapshot.

        Subsequent normal calls return this JSON directly without
        rebuilding the population.
      */
      await store.setJSON(
        blobKey,
        snapshot
      );

      return jsonResponse(
        200,
        snapshot,
        CACHE_CONTROL
      );
    } catch (
      error
    ) {
      console.error(
        "weekly-sage-wr-snapshot failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not build Weekly SAGE WR snapshot.",

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
