// netlify/functions/weekly-sage-qb-snapshot.js
//
// WEEKLY SAGE — QB POPULATION SNAPSHOT
//
// PURPOSE
// -------
// Build the reusable Quarterback peer population entering a target week.
//
// This is the QB equivalent of the proven WR/TE snapshot architecture:
// build the expensive historical peer population ONCE, then let downstream
// benchmark / component / confidence / final-score functions reuse it.
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
// separately as currentTeam. This prevents current-roster movement from
// rewriting historical team identity.
//
// QB ROLE EVIDENCE
// ----------------
// - pass attempts per game
// - rushing attempts per game
// - offensive snap percentage
//
// QB PRODUCTION EVIDENCE
// ----------------------
// - passing yards per game
// - passing TD per game
// - yards per attempt
// - interceptions per game
// - rushing yards per game
// - rushing TD per game
//
// POPULATION RULES — QB V1
// ------------------------
// - at least 2 prior games
// - at least 15 pass attempts per game
//
// These are population-eligibility rules only. They are NOT SAGE weights,
// recommendations, or final model assumptions.
//
// COST DISCIPLINE
// ---------------
// This function makes one getNFLPlayerList call, one prior-week schedule pass,
// and one getNFLGamesForPlayer call per discovered QB candidate. It does NOT
// invoke weekly-sage-player-season once per QB, avoiding large Netlify
// function fan-out during population construction.
//
// ═══════════════════════════════════════════════════════════════════════

const TANK01_HOST =
  "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";

const DEFAULT_SEASON_TYPE = "reg";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

const POSITION = "QB";

const MINIMUM_GAMES = 2;

const MINIMUM_PASS_ATTEMPTS_PER_GAME = 15;

// Keep conservative concurrency so the population build is reliable and
// doesn't hammer Tank01.
const PLAYER_CONCURRENCY = 3;

const SCHEDULE_CONCURRENCY = 4;

function num(value) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : 0;
}

function round(
  value,
  digits = 2
) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
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

function normalizePosition(value) {
  return String(
    value || ""
  )
    .trim()
    .toUpperCase();
}

function normalizeTeam(value) {
  const raw =
    String(
      value || ""
    )
      .trim()
      .toUpperCase();

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
    await fetch(
      url,
      {
        method: "GET",

        headers: {
          Accept:
            "application/json"
        }
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
    let detail =
      `HTTP ${response.status}`;

    const rawDetail =
      data &&
      (
        data.detail ||
        data.error
      );

    if (
      typeof rawDetail ===
        "string"
    ) {
      detail =
        rawDetail;
    } else if (
      rawDetail &&
      typeof rawDetail ===
        "object"
    ) {
      try {
        detail =
          JSON.stringify(
            rawDetail
          );
      } catch (error) {
        detail =
          String(rawDetail);
      }
    }

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
      (
        _,
        index
      ) =>
        index + 1
    );

  const schedules =
    await mapWithConcurrency(
      weeksIncluded,
      SCHEDULE_CONCURRENCY,
      week =>
        fetchScheduleWeek({
          baseUrl,
          season,
          week,
          seasonType
        })
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

function extractPlayerList(data) {
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

function extractPlayerGames(data) {
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
    typeof game[key] !==
      "object"
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

function snapStats(game) {
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

  /*
    Tank01 commonly returns:

      "0.83"

    meaning 83%.
  */
  if (
    offensePct > 0 &&
    offensePct <= 1
  ) {
    offensePct *= 100;
  }

  return {
    offense,
    offensePct
  };
}

function gameTeam(game) {
  return normalizeTeam(
    game &&
    (
      game.teamAbv ||
      game.team
    )
  );
}

function teamParticipates(
  scheduleGame,
  team
) {
  if (
    !scheduleGame ||
    !team
  ) {
    return false;
  }

  const normalizedTeam =
    normalizeTeam(
      team
    );

  return (
    scheduleGame.away ===
      normalizedTeam ||
    scheduleGame.home ===
      normalizedTeam
  );
}

function resolveHistoricalTeam({
  game,
  scheduleGame,
  currentTeam
}) {
  const historicalGameTeam =
    gameTeam(
      game
    );

  if (
    historicalGameTeam &&
    teamParticipates(
      scheduleGame,
      historicalGameTeam
    )
  ) {
    return {
      team:
        historicalGameTeam,

      source:
        "player_game"
    };
  }

  const normalizedCurrentTeam =
    normalizeTeam(
      currentTeam
    );

  if (
    normalizedCurrentTeam &&
    teamParticipates(
      scheduleGame,
      normalizedCurrentTeam
    )
  ) {
    return {
      team:
        normalizedCurrentTeam,

      source:
        "current_player_metadata_schedule_verified"
    };
  }

  return {
    team: null,
    source:
      "unresolved"
  };
}

function attachScheduleContext(
  playerGames,
  gameMap,
  currentTeam
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
      No schedule match means the game is outside the allowed
      pre-target week window or otherwise unresolved.

      Excluding it automatically enforces no-look-ahead.
    */
    if (!schedule) {
      continue;
    }

    const historicalTeam =
      resolveHistoricalTeam({
        game,
        scheduleGame:
          schedule,
        currentTeam
      });

    games.push({
      ...game,

      sageWeek:
        schedule.week,

      sageTeam:
        historicalTeam.team,

      sageTeamSource:
        historicalTeam.source,

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

    snaps: {
      offense: 0,
      offensePctTotal: 0,
      offensePctGames: 0
    }
  };

  for (
    const game of
    games
  ) {
    const passing =
      passingStats(
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

    totals.games += 1;

    totals.passing.attempts +=
      passing.attempts;

    totals.passing.completions +=
      passing.completions;

    totals.passing.yards +=
      passing.yards;

    totals.passing.touchdowns +=
      passing.touchdowns;

    totals.passing.interceptions +=
      passing.interceptions;

    totals.rushing.carries +=
      rushing.carries;

    totals.rushing.yards +=
      rushing.yards;

    totals.rushing.touchdowns +=
      rushing.touchdowns;

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
        .offensePctGames +=
          1;
    }
  }

  return totals;
}

function buildQBRecord({
  player,
  priorGames
}) {
  const totals =
    aggregateGames(
      priorGames
    );

  const games =
    totals.games;

  const passAttempts =
    totals
      .passing
      .attempts;

  const carries =
    totals
      .rushing
      .carries;

  const passAttemptsPerGame =
    games
      ? round(
          passAttempts /
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

  const offensiveSnapPct =
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
      : 0;

  const passYardsPerGame =
    games
      ? round(
          totals
            .passing
            .yards /
          games
        )
      : 0;

  const passTDPerGame =
    games
      ? round(
          totals
            .passing
            .touchdowns /
          games
        )
      : 0;

  const yardsPerAttempt =
    passAttempts
      ? round(
          totals
            .passing
            .yards /
          passAttempts
        )
      : 0;

  const interceptionsPerGame =
    games
      ? round(
          totals
            .passing
            .interceptions /
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

  const latestGame =
    priorGames.length
      ? priorGames[
          priorGames.length - 1
        ]
      : null;

  const historicalTeam =
    normalizeTeam(
      latestGame &&
      latestGame.sageTeam
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
        function (game) {
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
          return a - b;
        }
      );

  const unresolvedHistoricalGames =
    priorGames.filter(
      game =>
        !game.sageTeam
    ).length;

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

      unresolvedHistoricalGames,

      teamSource:
        latestGame &&
        latestGame.sageTeam
          ? latestGame
              .sageTeamSource
          : "current_player_list_fallback"
    },

    role: {
      passAttemptsPerGame,
      carriesPerGame,
      offensiveSnapPct
    },

    production: {
      passYardsPerGame,
      passTDPerGame,
      yardsPerAttempt,
      interceptionsPerGame,
      rushingYardsPerGame,
      rushingTDPerGame
    }
  };
}

function eligibilityReason(record) {
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
      .passAttemptsPerGame <
    MINIMUM_PASS_ATTEMPTS_PER_GAME
  ) {
    return (
      "insufficient_pass_attempts"
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

    const targetWeek =
      Number(
        query.week
      );

    const seasonType =
      String(
        query.seasonType ||
        DEFAULT_SEASON_TYPE
      );

    if (
      !Number.isInteger(
        targetWeek
      ) ||
      targetWeek < 2 ||
      targetWeek > 18
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
      const baseUrl =
        getBaseUrl(
          event
        );

      const body =
        await buildQbSnapshot({
          baseUrl,
          season,
          targetWeek,
          seasonType
        });

      return jsonResponse(
        200,
        body,
        CACHE_CONTROL
      );
    } catch (error) {
      console.error(
        "weekly-sage-qb-snapshot failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not build Weekly SAGE QB snapshot.",

          detail:
            error.message
        }
      );
    }
  };

/*
  Core Weekly SAGE QB population-snapshot computation.

  Returns plain data. This function makes no Blobs calls itself.
  refresh-qb-snapshot.js will call it in-process and will be solely
  responsible for caching the completed snapshot.
*/
async function buildQbSnapshot({
  baseUrl,
  season,
  targetWeek,
  seasonType
}) {
  /*
    Fetch the complete player list and prior-week schedule map once.
    Both are reused for every QB candidate.
  */
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

  if (!nflPlayers.length) {
    throw new Error(
      "Tank01 getNFLPlayerList returned no players."
    );
  }

  const qbCandidates =
    nflPlayers
      .filter(
        function (player) {
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
        function (player) {
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
      qbCandidates,
      PLAYER_CONCURRENCY,
      async function (player) {
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

          const currentTeam =
            normalizeTeam(
              player.teamAbv ||
              player.team
            );

          const priorGames =
            attachScheduleContext(
              allGames,
              scheduleContext
                .gameMap,
              currentTeam
            );

          const record =
            buildQBRecord({
              player,
              priorGames
            });

          return {
            ok: true,

            playerID:
              player.playerID,

            record
          };
        } catch (error) {
          return {
            ok: false,

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
    playerResults.filter(
      result =>
        result &&
        result.ok
    );

  const failures =
    playerResults.filter(
      result =>
        result &&
        !result.ok
    );

  const records =
    successful.map(
      result =>
        result.record
    );

  const ineligibleCounts = {
    insufficient_games: 0,
    insufficient_pass_attempts: 0
  };

  const population = [];

  for (
    const record of
    records
  ) {
    const reason =
      eligibilityReason(
        record
      );

    if (reason) {
      if (
        Object.prototype
          .hasOwnProperty
          .call(
            ineligibleCounts,
            reason
          )
      ) {
        ineligibleCounts[
          reason
        ] += 1;
      }

      continue;
    }

    population.push(
      record
    );
  }

  /*
    Deterministic output order.

    Highest passing volume first,
    then alphabetical player name.
  */
  population.sort(
    function (
      a,
      b
    ) {
      const volumeDifference =
        b.role
          .passAttemptsPerGame -
        a.role
          .passAttemptsPerGame;

      if (
        volumeDifference !==
        0
      ) {
        return volumeDifference;
      }

      return String(
        a.name || ""
      ).localeCompare(
        String(
          b.name || ""
        )
      );
    }
  );

  return {
    evidenceType:
      "weekly-sage-qb-snapshot",

    schemaVersion: 1,

    generatedAt:
      new Date()
        .toISOString(),

    season,

    targetWeek,

    seasonType,

    snapshotKey:
      `${season}|${targetWeek}|${seasonType}|QB`,

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

      minimumPassAttemptsPerGame:
        MINIMUM_PASS_ATTEMPTS_PER_GAME,

      tank01PlayerConcurrency:
        PLAYER_CONCURRENCY,

      historicalIdentity:
        "Historical player-game team is authoritative. Current roster team is used only when schedule-verified for that historical game.",

      architecture:
        "Build the QB population once per season/week and reuse the snapshot for player scoring.",

      roleEvidence: [
        "passAttemptsPerGame",
        "carriesPerGame",
        "offensiveSnapPct"
      ],

      productionEvidence: [
        "passYardsPerGame",
        "passTDPerGame",
        "yardsPerAttempt",
        "interceptionsPerGame",
        "rushingYardsPerGame",
        "rushingTDPerGame"
      ],

      important:
        "This snapshot contains raw QB peer evidence only. It does not calculate a final SAGE score, weight components, or create recommendations."
    },

    populationSummary: {
      nflPlayersReturned:
        nflPlayers.length,

      qbCandidatesDiscovered:
        qbCandidates.length,

      successfulPlayerGameResponses:
        successful.length,

      playerGameFailures:
        failures.length,

      recordsBuilt:
        records.length,

      eligibleQBPopulation:
        population.length,

      ineligible:
        ineligibleCounts
    },

    population,

    failures,

    nextStep: {
      ready:
        population.length > 0 &&
        failures.length === 0,

      reason:
        failures.length === 0
          ? "QB peer snapshot built successfully. Inspect population size and evidence distributions before defining QB benchmark/component scoring."
          : "QB snapshot built with one or more player-game failures. Resolve failures before using the population as the QB benchmark universe."
    },

    provenance: {
      playerIdentity:
        "Tank01 getNFLPlayerList",

      playerGames:
        "Tank01 getNFLGamesForPlayer",

      noLookAheadSchedule:
        "weekly-sage-schedule",

      directTank01Calls:
        1 +
        qbCandidates.length
    }
  };
}

exports.buildQbSnapshot =
  buildQbSnapshot;
