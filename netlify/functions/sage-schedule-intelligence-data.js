// netlify/functions/sage-schedule-intelligence-data.js
//
// SAGE — SCHEDULE INTELLIGENCE DATA BUILDER V1.2
//
// PURPOSE
// -------
// Build trustworthy league-wide RB Schedule Intelligence from:
//
//   Tank01 archived historical team rosters
//   + Tank01 player metadata
//   + Tank01 historical player game logs
//   + authoritative Weekly SAGE schedule
//   + sage-schedule-intelligence.js calculations
//
// WHY V1.2 EXISTS
// ---------------
// The original historical-player discovery path used getNFLPlayerList.
// In live testing that endpoint returned exactly 1,000 player records and
// only 69 RB candidates, which produced just 291 matched historical RB
// game rows and insufficient defense samples.
//
// V1.2 therefore DOES NOT use getNFLPlayerList as the authoritative
// historical population.
//
// Instead:
//
//   1. Build the complete historical regular-season schedule.
//   2. Take multiple archived roster snapshots for all 32 teams.
//   3. Union the historical player IDs.
//   4. Resolve player metadata/position.
//   5. Keep historical RBs.
//   6. Fetch their game logs.
//   7. Join only regular-season games.
//   8. Calculate defense-vs-RB fantasy production.
//   9. Apply quality gates before the result can be trusted.
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
} = require(
  "./sage-schedule-intelligence.js"
);


const {
  buildWeeklySchedule
} = require(
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
  Never rely on Tank01's default getNFLGamesForPlayer limit.
*/
const PLAYER_GAME_REQUEST_LIMIT =
  25;


/*
  Keep API pressure low.

  This is a build/refresh operation, not a customer-facing request path.
*/
const PLAYER_INFO_CONCURRENCY =
  3;


const PLAYER_GAME_CONCURRENCY =
  2;


const ROSTER_CONCURRENCY =
  4;


/*
  Historical roster snapshots.

  Rather than use a single opening-day roster, we derive snapshot dates
  from several points in the actual historical regular-season schedule.

  This helps capture:
  - opening-day players
  - midseason additions
  - late-season additions
  - players who changed teams

  Snapshot weeks are intentionally spread across the season.
*/
const HISTORICAL_ROSTER_SNAPSHOT_WEEKS =
  [
    1,
    6,
    12,
    18
  ];


/*
  Quality thresholds.

  A defense normally has 17 regular-season games.

  We do not demand perfection because source feeds can occasionally miss
  a player record, but we do demand broad league coverage before the data
  may be called production-trustworthy.
*/
const MIN_ACCEPTABLE_HISTORICAL_RB_ROWS =
  450;


const MIN_DEFENSE_GAMES_SAMPLE =
  14;


const MIN_DEFENSES_WITH_GOOD_SAMPLE =
  30;


const MIN_AVERAGE_DEFENSE_GAMES =
  15;


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


function sleep(
  milliseconds
) {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        milliseconds
      )
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
// TEAM LIST
// ═══════════════════════════════════════════════════════════════════════

const NFL_TEAMS =
  [
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
    "SF",
    "SEA",
    "TB",
    "TEN",
    "WSH"
  ];


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
    player.positionAbbreviation ??
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


function tank01ErrorFromPayload(
  endpoint,
  data
) {
  if (
    !data ||
    typeof data !==
      "object"
  ) {
    return null;
  }

  const error =
    data.error ??
    data.message ??
    null;

  if (
    !error
  ) {
    return null;
  }

  return new Error(
    `Tank01 ${endpoint} failed: ${String(
      error
    )}`
  );
}


async function tank01Fetch(
  endpoint,
  params = {}
) {
  const query =
    new URLSearchParams();

  for (
    const [
      key,
      value
    ]
    of Object.entries(
      params
    )
  ) {
    if (
      value ===
        undefined ||
      value ===
        null ||
      value ===
        ""
    ) {
      continue;
    }

    query.set(
      key,
      String(
        value
      )
    );
  }

  const queryString =
    query.toString();

  const url =
    `https://${TANK01_HOST}/${endpoint}` +
    (
      queryString
        ? `?${queryString}`
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
        const payloadError =
          tank01ErrorFromPayload(
            endpoint,
            data
          );

        if (
          payloadError
        ) {
          throw payloadError;
        }

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
      }

      lastError =
        new Error(
          `Tank01 ${endpoint} failed: ${detail}`
        );

      if (
        response.status !==
          429 &&
        response.status <
          500
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
      await sleep(
        attempt *
        750
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
        // Keep raw body.
      }
    }

    return body;
  }

  return data;
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

    Weekly SAGE schedule remains authoritative for:
    - NFL week
    - game ID
    - team pairing
    - game date
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
// ARCHIVE DATE SELECTION
// ═══════════════════════════════════════════════════════════════════════

function normalizeArchiveDate(
  value
) {
  const text =
    String(
      value ||
      ""
    )
      .replace(
        /[^0-9]/g,
        ""
      )
      .trim();

  return /^\d{8}$/.test(
    text
  )
    ? text
    : null;
}


function gameDateToArchiveDate(
  value
) {
  return normalizeArchiveDate(
    value
  );
}


function snapshotDatesFromSchedules(
  historicalSchedules
) {
  const byWeek =
    new Map();

  for (
    const schedule
    of (
      Array.isArray(
        historicalSchedules
      )
        ? historicalSchedules
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

    if (
      !HISTORICAL_ROSTER_SNAPSHOT_WEEKS
        .includes(
          week
        )
    ) {
      continue;
    }

    const dates =
      (
        Array.isArray(
          schedule.games
        )
          ? schedule.games
          : []
      )
        .map(
          game =>
            gameDateToArchiveDate(
              game &&
              game.gameDate
            )
        )
        .filter(
          Boolean
        )
        .sort();

    if (
      dates.length ===
      0
    ) {
      continue;
    }

    /*
      Use the latest game date in the selected week.

      That gives the snapshot a chance to reflect roster transactions
      made earlier in the week.
    */
    byWeek.set(
      week,
      dates[
        dates.length -
        1
      ]
    );
  }

  const snapshots =
    [];

  for (
    const week
    of HISTORICAL_ROSTER_SNAPSHOT_WEEKS
  ) {
    const archiveDate =
      byWeek.get(
        week
      );

    if (
      archiveDate
    ) {
      snapshots.push({
        week,
        archiveDate
      });
    }
  }

  return snapshots;
}


// ═══════════════════════════════════════════════════════════════════════
// ARCHIVED ROSTER EXTRACTION
// ═══════════════════════════════════════════════════════════════════════

function extractArchivedRosterIDs(
  data
) {
  const body =
    unwrapBody(
      data
    );

  if (
    !body ||
    typeof body !==
      "object"
  ) {
    return [];
  }

  const roster =
    body.roster ??
    body.Roster ??
    [];

  if (
    Array.isArray(
      roster
    )
  ) {
    return roster
      .map(
        item => {
          if (
            typeof item ===
              "string" ||
            typeof item ===
              "number"
          ) {
            return String(
              item
            ).trim();
          }

          if (
            item &&
            typeof item ===
              "object"
          ) {
            return playerIDOf(
              item
            );
          }

          return "";
        }
      )
      .filter(
        Boolean
      );
  }

  if (
    roster &&
    typeof roster ===
      "object"
  ) {
    return Object.entries(
      roster
    )
      .map(
        ([
          key,
          item
        ]) =>
          playerIDOf(
            item
          ) ||
          String(
            key
          ).trim()
      )
      .filter(
        Boolean
      );
  }

  return [];
}


async function fetchArchivedRoster({
  team,
  archiveDate
}) {
  const data =
    await tank01Fetch(
      "getNFLTeamRoster",
      {
        teamAbv:
          team,

        archiveDate
      }
    );

  return {
    team,

    archiveDate,

    playerIDs:
      extractArchivedRosterIDs(
        data
      )
  };
}


async function buildHistoricalRosterUniverse({
  historicalSchedules
}) {
  const snapshots =
    snapshotDatesFromSchedules(
      historicalSchedules
    );

  if (
    snapshots.length ===
      0
  ) {
    throw new Error(
      "Could not derive historical roster snapshot dates from the regular-season schedule."
    );
  }

  const requests =
    [];

  for (
    const snapshot
    of snapshots
  ) {
    for (
      const team
      of NFL_TEAMS
    ) {
      requests.push({
        team,

        week:
          snapshot.week,

        archiveDate:
          snapshot.archiveDate
      });
    }
  }

  const rosterResults =
    await mapWithConcurrency(
      requests,
      ROSTER_CONCURRENCY,

      async request => {
        try {
          const result =
            await fetchArchivedRoster(
              request
            );

          return {
            ...request,

            playerIDs:
              result.playerIDs,

            error:
              null
          };
        } catch (
          error
        ) {
          return {
            ...request,

            playerIDs:
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

  const playerMembership =
    new Map();

  const rosterErrors =
    [];

  let rosterPlayerEntries =
    0;

  for (
    const result
    of rosterResults
  ) {
    if (
      result.error
    ) {
      rosterErrors.push({
        team:
          result.team,

        week:
          result.week,

        archiveDate:
          result.archiveDate,

        error:
          result.error
      });

      continue;
    }

    rosterPlayerEntries +=
      result.playerIDs.length;

    for (
      const playerID
      of result.playerIDs
    ) {
      if (
        !playerMembership.has(
          playerID
        )
      ) {
        playerMembership.set(
          playerID,
          {
            playerID,

            teams:
              new Set(),

            snapshots:
              []
          }
        );
      }

      const membership =
        playerMembership.get(
          playerID
        );

      membership.teams.add(
        result.team
      );

      membership.snapshots.push({
        team:
          result.team,

        week:
          result.week,

        archiveDate:
          result.archiveDate
      });
    }
  }

  const players =
    Array.from(
      playerMembership.values()
    )
      .map(
        item => ({
          playerID:
            item.playerID,

          historicalTeams:
            Array.from(
              item.teams
            ),

          snapshots:
            item.snapshots
        })
      );

  return {
    snapshots,

    rosterRequests:
      requests.length,

    rosterCallsSucceeded:
      rosterResults.length -
      rosterErrors.length,

    rosterErrors,

    rosterPlayerEntries,

    uniqueHistoricalPlayerIDs:
      players.length,

    players
  };
}


// ═══════════════════════════════════════════════════════════════════════
// CURRENT METADATA CACHE
// ═══════════════════════════════════════════════════════════════════════

function extractCurrentTeamRosterPlayers(
  data
) {
  const body =
    unwrapBody(
      data
    );

  if (
    !Array.isArray(
      body
    )
  ) {
    return [];
  }

  const players =
    [];

  for (
    const team
    of body
  ) {
    if (
      !team ||
      typeof team !==
        "object"
    ) {
      continue;
    }

    const roster =
      team.Roster ??
      team.roster ??
      null;

    if (
      Array.isArray(
        roster
      )
    ) {
      for (
        const player
        of roster
      ) {
        if (
          player &&
          typeof player ===
            "object"
        ) {
          players.push(
            player
          );
        }
      }

      continue;
    }

    if (
      roster &&
      typeof roster ===
        "object"
    ) {
      for (
        const [
          playerID,
          player
        ]
        of Object.entries(
          roster
        )
      ) {
        if (
          player &&
          typeof player ===
            "object"
        ) {
          players.push({
            ...player,

            playerID:
              playerIDOf(
                player
              ) ||
              String(
                playerID
              )
          });
        }
      }
    }
  }

  return players;
}


async function buildCurrentMetadataMap() {
  const map =
    new Map();

  let sourceCount =
    0;

  /*
    getNFLTeams(rosters=true) is used only as a cheap metadata cache.

    It is NOT authoritative for the historical population.
  */
  try {
    const teamsData =
      await tank01Fetch(
        "getNFLTeams",
        {
          rosters:
            "true"
        }
      );

    const currentPlayers =
      extractCurrentTeamRosterPlayers(
        teamsData
      );

    sourceCount =
      currentPlayers.length;

    for (
      const player
      of currentPlayers
    ) {
      const playerID =
        playerIDOf(
          player
        );

      if (
        !playerID
      ) {
        continue;
      }

      map.set(
        playerID,
        player
      );
    }
  } catch (
    error
  ) {
    /*
      Fail-soft.

      Missing current metadata only means more getNFLPlayerInfo calls.
    */
  }

  return {
    map,

    sourceCount
  };
}


// ═══════════════════════════════════════════════════════════════════════
// PLAYER INFORMATION
// ═══════════════════════════════════════════════════════════════════════

function extractPlayerInfo(
  data
) {
  const body =
    unwrapBody(
      data
    );

  if (
    !body
  ) {
    return null;
  }

  if (
    Array.isArray(
      body
    )
  ) {
    return (
      body[0] ||
      null
    );
  }

  if (
    typeof body ===
      "object"
  ) {
    /*
      Normal direct player object.
    */
    if (
      playerIDOf(
        body
      ) ||
      playerNameOf(
        body
      ) ||
      playerPositionOf(
        body
      )
    ) {
      return body;
    }

    /*
      Defensive fallback for a map keyed by playerID.
    */
    const values =
      Object.values(
        body
      );

    for (
      const value
      of values
    ) {
      if (
        value &&
        typeof value ===
          "object"
      ) {
        return value;
      }
    }
  }

  return null;
}


async function resolveHistoricalPlayerMetadata({
  historicalRosterUniverse
}) {
  const currentMetadata =
    await buildCurrentMetadataMap();

  const resolved =
    [];

  const unresolved =
    [];

  const infoRequests =
    [];

  for (
    const historicalPlayer
    of historicalRosterUniverse.players
  ) {
    const cached =
      currentMetadata
        .map
        .get(
          historicalPlayer.playerID
        );

    if (
      cached &&
      playerPositionOf(
        cached
      )
    ) {
      resolved.push({
        playerID:
          historicalPlayer.playerID,

        name:
          playerNameOf(
            cached
          ),

        position:
          playerPositionOf(
            cached
          ),

        currentTeam:
          playerTeamOf(
            cached
          ),

        historicalTeams:
          historicalPlayer
            .historicalTeams,

        snapshots:
          historicalPlayer
            .snapshots,

        metadataSource:
          "getNFLTeams-roster"
      });
    } else {
      infoRequests.push(
        historicalPlayer
      );
    }
  }

  const infoResults =
    await mapWithConcurrency(
      infoRequests,
      PLAYER_INFO_CONCURRENCY,

      async historicalPlayer => {
        try {
          const data =
            await tank01Fetch(
              "getNFLPlayerInfo",
              {
                playerID:
                  historicalPlayer.playerID
              }
            );

          const player =
            extractPlayerInfo(
              data
            );

          if (
            !player
          ) {
            return {
              historicalPlayer,

              player:
                null,

              error:
                "Player information was empty."
            };
          }

          return {
            historicalPlayer,

            player,

            error:
              null
          };
        } catch (
          error
        ) {
          return {
            historicalPlayer,

            player:
              null,

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

  for (
    const result
    of infoResults
  ) {
    if (
      result.error ||
      !result.player
    ) {
      unresolved.push({
        playerID:
          result
            .historicalPlayer
            .playerID,

        historicalTeams:
          result
            .historicalPlayer
            .historicalTeams,

        error:
          result.error ||
          "Missing player information."
      });

      continue;
    }

    resolved.push({
      playerID:
        result
          .historicalPlayer
          .playerID,

      name:
        playerNameOf(
          result.player
        ),

      position:
        playerPositionOf(
          result.player
        ),

      currentTeam:
        playerTeamOf(
          result.player
        ),

      historicalTeams:
        result
          .historicalPlayer
          .historicalTeams,

      snapshots:
        result
          .historicalPlayer
          .snapshots,

      metadataSource:
        "getNFLPlayerInfo"
    });
  }

  return {
    currentRosterMetadataRecords:
      currentMetadata
        .sourceCount,

    metadataResolvedFromCurrentRoster:
      resolved.filter(
        item =>
          item.metadataSource ===
          "getNFLTeams-roster"
      ).length,

    playerInfoRequests:
      infoRequests.length,

    playerInfoResolved:
      resolved.filter(
        item =>
          item.metadataSource ===
          "getNFLPlayerInfo"
      ).length,

    unresolved,

    players:
      resolved
  };
}


// ═══════════════════════════════════════════════════════════════════════
// PLAYER GAME EXTRACTION
// ═══════════════════════════════════════════════════════════════════════

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

      ...(
        player &&
        Array.isArray(
          player.historicalTeams
        )
          ? player.historicalTeams
          : []
      ),

      player &&
      player.currentTeam
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
    If Tank01 gives explicit opponent but no historical team,
    derive the player's team from the authoritative schedule.
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

  /*
    This is no longer automatically an error.

    getNFLGamesForPlayer can return preseason and postseason games.
    Our authoritative baseline is regular season only, so games that
    do not exist in the 18-week regular-season map are deliberately
    excluded.
  */
  if (
    !scheduleGame
  ) {
    return {
      ok:
        false,

      reason:
        "outside-regular-season-schedule",

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
  const gameMap =
    buildGameMap(
      historicalSchedules
    );


  // ───────────────────────────────────────────────────────────────────
  // A. Historical roster universe
  // ───────────────────────────────────────────────────────────────────

  const rosterUniverse =
    await buildHistoricalRosterUniverse({
      historicalSchedules
    });


  // ───────────────────────────────────────────────────────────────────
  // B. Resolve positions
  // ───────────────────────────────────────────────────────────────────

  const metadata =
    await resolveHistoricalPlayerMetadata({
      historicalRosterUniverse:
        rosterUniverse
    });


  const rbCandidates =
    metadata.players
      .filter(
        player =>
          normalizePosition(
            player.position
          ) ===
            DEFAULT_POSITION
      );


  // ───────────────────────────────────────────────────────────────────
  // C. Load RB game logs
  // ───────────────────────────────────────────────────────────────────

  const playerResults =
    await mapWithConcurrency(
      rbCandidates,
      PLAYER_GAME_CONCURRENCY,

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

          const matchedRows =
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
              matchedRows.push(
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

            historicalTeams:
              player.historicalTeams,

            rawGamesReturned:
              games.length,

            matchedRows,

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

            historicalTeams:
              player.historicalTeams,

            rawGamesReturned:
              0,

            matchedRows:
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


  // ───────────────────────────────────────────────────────────────────
  // D. Diagnostics
  // ───────────────────────────────────────────────────────────────────

  const diagnostics = {
    rawHistoricalGameRecords:
      0,

    regularSeasonMatchedRecords:
      0,

    outsideRegularSeasonRecords:
      0,

    missingGameID:
      0,

    unresolvedHistoricalTeam:
      0,

    unresolvedOpponent:
      0,

    duplicateHistoricalGameRecords:
      0
  };


  const playerErrors =
    [];

  const collectionProblems =
    [];

  const allMatchedRows =
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
      .regularSeasonMatchedRecords +=
        result.matchedRows.length;

    if (
      result.error
    ) {
      playerErrors.push({
        playerID:
          result.playerID,

        playerName:
          result.playerName,

        historicalTeams:
          result.historicalTeams,

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
        case "outside-regular-season-schedule":
          diagnostics
            .outsideRegularSeasonRecords +=
              1;
          break;

        case "missing-game-id":
          diagnostics
            .missingGameID +=
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

      /*
        Do not spam the warnings block with expected preseason/postseason
        exclusions.

        Only unexpected normalization problems belong here.
      */
      if (
        rejected.reason !==
          "outside-regular-season-schedule" &&
        collectionProblems.length <
          100
      ) {
        collectionProblems.push({
          playerID:
            result.playerID,

          playerName:
            result.playerName,

          historicalTeams:
            result.historicalTeams,

          gameID:
            rejected.gameID,

          reason:
            rejected.reason
        });
      }
    }

    allMatchedRows.push(
      ...result.matchedRows
    );

    playerGameCounts.push({
      playerID:
        result.playerID,

      playerName:
        result.playerName,

      historicalTeams:
        result.historicalTeams,

      rawGamesReturned:
        result.rawGamesReturned,

      matchedRegularSeasonGames:
        result.matchedRows.length,

      excludedNonRegularGames:
        result.rejectedRows
          .filter(
            row =>
              row.reason ===
              "outside-regular-season-schedule"
          )
          .length,

      rejectedUnexpectedGames:
        result.rejectedRows
          .filter(
            row =>
              row.reason !==
              "outside-regular-season-schedule"
          )
          .length
    });
  }


  const deduped =
    dedupeHistoricalRows(
      allMatchedRows
    );


  diagnostics
    .duplicateHistoricalGameRecords =
      deduped.duplicateCount;


  playerGameCounts.sort(
    (a, b) =>
      b.matchedRegularSeasonGames -
      a.matchedRegularSeasonGames
  );


  return {
    rosterUniverse,

    metadata,

    rbCandidates,

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
// DEFENSE COVERAGE
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
            item.fantasyPointsAllowed,

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


  const goodSample =
    rows.filter(
      item =>
        item.gamesSampled >=
        MIN_DEFENSE_GAMES_SAMPLE
    );


  const belowThreshold =
    rows.filter(
      item =>
        item.gamesSampled <
        MIN_DEFENSE_GAMES_SAMPLE
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
      goodSample.length,

    minimumGamesRequired:
      MIN_DEFENSE_GAMES_SAMPLE,

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


// ═══════════════════════════════════════════════════════════════════════
// QUALITY GATE
// ═══════════════════════════════════════════════════════════════════════

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
    "historical-roster-errors",

    historical
      .rosterUniverse
      .rosterErrors
      .length ===
      0,

    historical
      .rosterUniverse
      .rosterErrors
      .length,

    0
  );


  addCheck(
    "historical-player-metadata",

    historical
      .metadata
      .unresolved
      .length ===
      0,

    historical
      .metadata
      .unresolved
      .length,

    0
  );


  addCheck(
    "historical-rb-game-volume",

    historical
      .playerGames
      .length >=
      MIN_ACCEPTABLE_HISTORICAL_RB_ROWS,

    historical
      .playerGames
      .length,

    `>= ${MIN_ACCEPTABLE_HISTORICAL_RB_ROWS}`
  );


  addCheck(
    "all-defenses-rated",

    defenseCoverage
      .defensesRated ===
      32,

    defenseCoverage
      .defensesRated,

    32
  );


  addCheck(
    "defenses-with-adequate-sample",

    defenseCoverage
      .defensesMeetingMinimumSample >=
      MIN_DEFENSES_WITH_GOOD_SAMPLE,

    defenseCoverage
      .defensesMeetingMinimumSample,

    `>= ${MIN_DEFENSES_WITH_GOOD_SAMPLE}`
  );


  addCheck(
    "average-defense-game-sample",

    defenseCoverage
      .averageGamesSampled >=
      MIN_AVERAGE_DEFENSE_GAMES,

    defenseCoverage
      .averageGamesSampled,

    `>= ${MIN_AVERAGE_DEFENSE_GAMES}`
  );


  addCheck(
    "unexpected-team-resolution-errors",

    (
      historical
        .diagnostics
        .unresolvedHistoricalTeam ===
        0 &&
      historical
        .diagnostics
        .unresolvedOpponent ===
        0
    ),

    {
      unresolvedHistoricalTeam:
        historical
          .diagnostics
          .unresolvedHistoricalTeam,

      unresolvedOpponent:
        historical
          .diagnostics
          .unresolvedOpponent
    },

    {
      unresolvedHistoricalTeam:
        0,

      unresolvedOpponent:
        0
    }
  );


  addCheck(
    "player-game-api-errors",

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
  // STEP 1 — Historical regular-season schedule
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
  // STEP 2 — Historical RB universe + game evidence
  // ════════════════════════════════════════════════════════════════════

  const historical =
    await loadHistoricalRbGames({
      baselineSeason:
        normalizedBaselineSeason,

      historicalSchedules
    });


  // ════════════════════════════════════════════════════════════════════
  // STEP 3 — Defense-vs-RB ratings
  // ════════════════════════════════════════════════════════════════════

  const defenseRatings =
    buildDefenseRbRatings({
      playerGames:
        historical.playerGames,

      scoring:
        normalizedScoring
    });


  // ════════════════════════════════════════════════════════════════════
  // STEP 4 — Defense coverage diagnostics
  // ════════════════════════════════════════════════════════════════════

  const defenseCoverage =
    buildDefenseCoverage(
      defenseRatings
    );


  // ════════════════════════════════════════════════════════════════════
  // STEP 5 — Target-season schedule
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
  // STEP 6 — Quality gate
  // ════════════════════════════════════════════════════════════════════

  const qualityGate =
    buildQualityGate({
      historical,

      defenseCoverage,

      targetScheduleGames:
        targetSchedule.length
    });


  // ════════════════════════════════════════════════════════════════════
  // STEP 7 — Schedule Intelligence calculation
  // ════════════════════════════════════════════════════════════════════

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
      3,

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

      historicalPopulation:
        "Historical player population is derived from multiple archived Tank01 team-roster snapshots rather than getNFLPlayerList.",

      rosterSnapshotWeeks:
        HISTORICAL_ROSTER_SNAPSHOT_WEEKS,

      rosterSnapshotDates:
        historical
          .rosterUniverse
          .snapshots,

      playerGameRequestLimit:
        PLAYER_GAME_REQUEST_LIMIT,

      gameAggregation:
        "All opposing RB production is summed within each NFL game before defense averages are calculated.",

      rankingDirection:
        "Defense rank 1 allows the most RB fantasy points and is therefore the most favorable RB matchup.",

      nonRegularSeasonHandling:
        "Preseason and postseason player-game records are excluded because only games present in the authoritative regular-season schedule are accepted.",

      byeHandling:
        "Bye and missing weeks are excluded from schedule averages rather than scored as zero.",

      scheduleSignal:
        "Schedule Intelligence remains separate from the core Draft SAGE recommendation calculation in V1.",

      qualityRule:
        "Schedule Intelligence must pass historical population, defense coverage, schedule, and error checks before trustedForProduction becomes true."
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

    historicalRosterCollection: {
      snapshotCount:
        historical
          .rosterUniverse
          .snapshots
          .length,

      snapshots:
        historical
          .rosterUniverse
          .snapshots,

      rosterRequests:
        historical
          .rosterUniverse
          .rosterRequests,

      rosterCallsSucceeded:
        historical
          .rosterUniverse
          .rosterCallsSucceeded,

      rosterErrors:
        historical
          .rosterUniverse
          .rosterErrors
          .length,

      rosterPlayerEntries:
        historical
          .rosterUniverse
          .rosterPlayerEntries,

      uniqueHistoricalPlayerIDs:
        historical
          .rosterUniverse
          .uniqueHistoricalPlayerIDs
    },

    metadataCollection: {
      currentRosterMetadataRecords:
        historical
          .metadata
          .currentRosterMetadataRecords,

      metadataResolvedFromCurrentRoster:
        historical
          .metadata
          .metadataResolvedFromCurrentRoster,

      playerInfoRequests:
        historical
          .metadata
          .playerInfoRequests,

      playerInfoResolved:
        historical
          .metadata
          .playerInfoResolved,

      unresolvedPlayerMetadata:
        historical
          .metadata
          .unresolved
          .length,

      historicalRbCandidates:
        historical
          .rbCandidates
          .length
    },

    collection: {
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

      regularSeasonMatchedRecords:
        historical
          .diagnostics
          .regularSeasonMatchedRecords,

      outsideRegularSeasonRecords:
        historical
          .diagnostics
          .outsideRegularSeasonRecords,

      duplicateHistoricalGameRecords:
        historical
          .diagnostics
          .duplicateHistoricalGameRecords,

      missingGameID:
        historical
          .diagnostics
          .missingGameID,

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
      rosterErrors:
        historical
          .rosterUniverse
          .rosterErrors
          .slice(
            0,
            100
          ),

      unresolvedPlayerMetadata:
        historical
          .metadata
          .unresolved
          .slice(
            0,
            100
          ),

      playerErrors:
        historical
          .playerErrors
          .slice(
            0,
            100
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

          schemaVersion:
            3,

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

exports.NFL_TEAMS =
  NFL_TEAMS;


exports.HISTORICAL_ROSTER_SNAPSHOT_WEEKS =
  HISTORICAL_ROSTER_SNAPSHOT_WEEKS;


exports.buildRbScheduleIntelligence =
  buildRbScheduleIntelligence;


exports.buildSeasonSchedules =
  buildSeasonSchedules;


exports.buildGameMap =
  buildGameMap;


exports.flattenSchedules =
  flattenSchedules;


exports.normalizeRequestedWeeks =
  normalizeRequestedWeeks;


exports.normalizeArchiveDate =
  normalizeArchiveDate;


exports.snapshotDatesFromSchedules =
  snapshotDatesFromSchedules;


exports.extractArchivedRosterIDs =
  extractArchivedRosterIDs;


exports.fetchArchivedRoster =
  fetchArchivedRoster;


exports.buildHistoricalRosterUniverse =
  buildHistoricalRosterUniverse;


exports.extractCurrentTeamRosterPlayers =
  extractCurrentTeamRosterPlayers;


exports.buildCurrentMetadataMap =
  buildCurrentMetadataMap;


exports.extractPlayerInfo =
  extractPlayerInfo;


exports.resolveHistoricalPlayerMetadata =
  resolveHistoricalPlayerMetadata;


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
