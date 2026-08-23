// netlify/functions/weekly-sage-qb-leaderboard.js
//
// WEEKLY SAGE — QB LEADERBOARD
//
// PURPOSE
// -------
// Build a complete Weekly SAGE QB leaderboard for one target week.
//
// SOURCES
// -------
//
//   weekly-sage-qb-snapshot
//   weekly-sage-schedule
//   weekly-sage-qb-final-score
//
// ARCHITECTURE
// ------------
// The snapshot defines the eligible QB population.
//
// The weekly schedule determines whether each player's historical
// team is ACTIVE or on BYE in the target week.
//
// Only active QBs are sent to weekly-sage-qb-final-score.
//
// This prevents bye weeks from being incorrectly reported as
// scoring failures and avoids unnecessary downstream function calls.
//
// This function DOES NOT:
// - call Tank01 directly
// - rebuild QB evidence
// - recalculate benchmarks
// - recalculate QB components
// - duplicate confidence logic
// - duplicate matchup logic
// - alter the underlying Weekly SAGE score when assigning START / FLEX / SIT
//
// IMPORTANT
// ---------
// QB SAGE v1 weights remain provisional.
//
// This leaderboard exposes the current forecast population for
// historical validation. It does not validate or optimize weights.
//
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_SEASON_TYPE =
  "reg";

const POSITION =
  "QB";

const SNAPSHOT_FUNCTION =
  "weekly-sage-qb-snapshot";

/*
  PHASE 2 — read the Phase 1 cached QB snapshot from Netlify Blobs
  instead of live-rebuilding it on every leaderboard request.

  Same Blobs pattern already proven in refresh-player-data.js /
  refresh-risers-fallers.js / player-data.js / refresh-qb-snapshot.js:
  connectLambda(event) must run before any getStore() call -- see
  exports.handler below.

  Deliberately NO live-rebuild fallback: if the cache is missing,
  unreadable, or incomplete, this file fails fast (503) rather than
  ever calling weekly-sage-qb-snapshot.js itself. That live rebuild
  remains available only via refresh-qb-snapshot.js's own manual/
  future-scheduled path -- never from a customer leaderboard request.
*/
const {
  connectLambda,
  getStore
} = require(
  "@netlify/blobs"
);

const QB_SNAPSHOT_STORE =
  "qb-snapshot";

const SCHEDULE_FUNCTION =
  "weekly-sage-schedule";

const FINAL_SCORE_FUNCTION =
  "weekly-sage-qb-final-score";

/*
  weekly-sage-qb-final-score's core computation (buildQbFinalScore)
  is required directly, in-process, rather than invoked over HTTP
  (see fetchFinalScore() below, now unused but left in place for
  reference). This is the top of the chain: the snapshot this file
  already fetches exactly once at STEP 1 below is passed down by
  reference as prebuiltSnapshot to every one of the ~N per-QB calls,
  instead of each one (through final-score -> confidence ->
  component-scores -> benchmarks) independently rebuilding the
  entire QB population snapshot from scratch -- the redundancy this
  whole fix exists to remove.
*/
const {
  buildQbFinalScore
} = require(
  "./weekly-sage-qb-final-score.js"
);

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

const DEFAULT_CONCURRENCY =
  5;

const MAX_CONCURRENCY =
  10;

/*
  IMPORTANT:
  These thresholds are inherited placeholders.

  They have NOT yet been calibrated or validated for QB.

  They remain exposed so the leaderboard architecture can be tested
  end-to-end, but they must not be represented as QB-calibrated until
  historical QB validation/backtesting has been completed.
*/
const QB_RECOMMENDATION_THRESHOLDS = {
  start: 72,
  flex: 52
};

function qbRecommendation(
  score
) {
  const value =
    nullableNum(
      score
    );

  if (
    value ===
    null
  ) {
    return null;
  }

  if (
    value >=
    QB_RECOMMENDATION_THRESHOLDS.start
  ) {
    return "START";
  }

  if (
    value >=
    QB_RECOMMENDATION_THRESHOLDS.flex
  ) {
    return "FLEX";
  }

  return "SIT";
}

function nullableNum(
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
    : null;
}

function integerOrNull(
  value
) {
  const n =
    Number(
      value
    );

  return Number.isInteger(
    n
  )
    ? n
    : null;
}

function round(
  value,
  digits = 1
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

function clamp(
  value,
  min,
  max
) {
  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );
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

function buildUrl({
  baseUrl,
  functionName,
  params
}) {
  const query =
    new URLSearchParams(
      params
    ).toString();

  return (
    `${baseUrl}/.netlify/functions/${functionName}` +
    `?${query}`
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

    const err =
      new Error(
        detail
      );

    err.status =
      response.status;

    err.data =
      data;

    throw err;
  }

  return data;
}

function cacheError(
  status,
  reason,
  detail
) {
  const err =
    new Error(
      reason
    );

  err.status =
    status;

  err.detail =
    detail ||
    null;

  return err;
}

/*
  Read the Phase 1 cached QB snapshot for this exact
  season/targetWeek/seasonType. Validates it as strictly as
  refresh-qb-snapshot.js validated it before ever writing it --
  schema identity, requested-key match, and completeness (non-empty
  population, zero failures, nextStep.ready === true). Throws a
  discriminated 503 statusError on ANY problem; never falls back to
  a live rebuild.
*/
async function readCachedSnapshot({
  season,
  targetWeek,
  seasonType
}) {
  const key =
    `week:${season}:${targetWeek}:${seasonType}`;

  let cached =
    null;

  try {
    const store =
      getStore(
        {
          name:
            QB_SNAPSHOT_STORE
        }
      );

    cached =
      await store.get(
        key,
        {
          type:
            "json"
        }
      );
  } catch (error) {
    throw cacheError(
      503,
      "QB snapshot cache could not be read.",
      {
        blobStore:
          QB_SNAPSHOT_STORE,

        blobKey:
          key,

        readError:
          error &&
          error.message
            ? error.message
            : String(
                error
              )
      }
    );
  }

  if (
    !cached ||
    typeof cached !== "object"
  ) {
    throw cacheError(
      503,
      "QB snapshot cache is missing for this season/week/seasonType.",
      {
        blobStore:
          QB_SNAPSHOT_STORE,

        blobKey:
          key
      }
    );
  }

  const problems =
    [];

  if (
    cached.evidenceType !==
    "weekly-sage-qb-snapshot"
  ) {
    problems.push(
      `Unexpected evidenceType: ${cached.evidenceType}`
    );
  }

  if (
    String(
      cached.season
    ) !==
    String(
      season
    )
  ) {
    problems.push(
      `Cached season (${cached.season}) does not match requested season (${season}).`
    );
  }

  if (
    Number(
      cached.targetWeek
    ) !==
    Number(
      targetWeek
    )
  ) {
    problems.push(
      `Cached targetWeek (${cached.targetWeek}) does not match requested week (${targetWeek}).`
    );
  }

  if (
    cached.seasonType !==
    seasonType
  ) {
    problems.push(
      `Cached seasonType (${cached.seasonType}) does not match requested seasonType (${seasonType}).`
    );
  }

  if (
    !Array.isArray(
      cached.population
    ) ||
    cached.population.length ===
      0
  ) {
    problems.push(
      "Cached snapshot has an empty or missing population."
    );
  }

  if (
    !Array.isArray(
      cached.failures
    ) ||
    cached.failures.length >
      0
  ) {
    problems.push(
      "Cached snapshot has one or more player-game failures."
    );
  }

  if (
    !cached.nextStep ||
    cached.nextStep.ready !==
      true
  ) {
    problems.push(
      "Cached snapshot's nextStep.ready is not true."
    );
  }

  if (
    problems.length >
    0
  ) {
    throw cacheError(
      503,
      "QB snapshot cache is invalid or not ready for use.",
      {
        blobStore:
          QB_SNAPSHOT_STORE,

        blobKey:
          key,

        problems
      }
    );
  }

  return cached;
}

async function fetchSchedule({
  baseUrl,
  season,
  week,
  seasonType
}) {
  const url =
    buildUrl({
      baseUrl,

      functionName:
        SCHEDULE_FUNCTION,

      params: {
        season,

        week:
          String(
            week
          ),

        seasonType
      }
    });

  const data =
    await fetchJson(
      url
    );

  if (
    !data ||
    data.evidenceType !==
      "weekly-sage-schedule"
  ) {
    throw new Error(
      "Unexpected Weekly SAGE schedule schema."
    );
  }

  return data;
}

async function fetchFinalScore({
  baseUrl,
  season,
  week,
  seasonType,
  playerID
}) {
  const url =
    buildUrl({
      baseUrl,

      functionName:
        FINAL_SCORE_FUNCTION,

      params: {
        season,

        week:
          String(
            week
          ),

        seasonType,

        playerID
      }
    });

  return await fetchJson(
    url
  );
}

function extractSnapshotPlayers(
  snapshot
) {
  const candidates = [
    snapshot &&
      snapshot.population,

    snapshot &&
      snapshot.players,

    snapshot &&
      snapshot.rows,

    snapshot &&
      snapshot.receivers,

    snapshot &&
      snapshot.wrs,

    snapshot &&
      snapshot.qbs,

    snapshot &&
      snapshot.data &&
      snapshot.data.players,

    snapshot &&
      snapshot.data &&
      snapshot.data.rows
  ];

  for (
    const candidate of
    candidates
  ) {
    if (
      Array.isArray(
        candidate
      )
    ) {
      return candidate;
    }
  }

  return [];
}

function normalizeSnapshotPlayer(
  row
) {
  if (
    !row ||
    typeof row !==
      "object"
  ) {
    return null;
  }

  const playerID =
    String(
      row.playerID ||
      row.playerId ||
      row.id ||
      ""
    ).trim();

  if (
    !playerID
  ) {
    return null;
  }

  const position =
    normalizePosition(
      row.position ||
      row.pos ||
      POSITION
    );

  if (
    position &&
    position !==
      POSITION
  ) {
    return null;
  }

  /*
    IMPORTANT:
    row.team is the historical team entering the target week.

    currentTeam is preserved separately.

    Historical team is authoritative for historical schedule
    classification.
  */
  return {
    playerID,

    name:
      row.name ||
      row.longName ||
      row.playerName ||
      null,

    team:
      normalizeTeam(
        row.team
      ) ||
      null,

    currentTeam:
      normalizeTeam(
        row.currentTeam
      ) ||
      null,

    position:
      POSITION,

    gamesUsed:
      nullableNum(
        row.gamesUsed
      ),

    weeksIncluded:
      Array.isArray(
        row.weeksIncluded
      )
        ? row.weeksIncluded
        : []
  };
}

function dedupePlayers(
  players
) {
  const seen =
    new Set();

  const result =
    [];

  for (
    const player of
    players
  ) {
    if (
      !player ||
      !player.playerID
    ) {
      continue;
    }

    if (
      seen.has(
        player.playerID
      )
    ) {
      continue;
    }

    seen.add(
      player.playerID
    );

    result.push(
      player
    );
  }

  return result;
}
