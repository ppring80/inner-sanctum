// netlify/functions/weekly-sage-rb-leaderboard.js
//
// WEEKLY SAGE — RB LEADERBOARD
//
// PURPOSE
// -------
// Build the weekly SAGE RB ranking board from the already-validated
// final RB scoring pipeline.
//
// This function:
//
// 1. Reads the cached Weekly SAGE RB snapshot.
// 2. Gets the eligible RB population.
// 3. Calls weekly-sage-rb-final-score for each eligible RB.
// 4. Sorts players by final SAGE score.
// 5. Returns one validation-friendly leaderboard.
//
// IMPORTANT
// ---------
// This function does NOT:
// - rebuild the RB population
// - call Tank01 directly
// - create START / FLEX / SIT recommendations
// - change Role / Production / Matchup methodology
//
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_SEASON_TYPE = "reg";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

const SNAPSHOT_FUNCTION =
  "weekly-sage-rb-snapshot";

const FINAL_SCORE_FUNCTION =
  "weekly-sage-rb-final-score";

function num(value) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

function round(value, digits = 1) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return null;
  }

  const factor =
    Math.pow(10, digits);

  return (
    Math.round(
      (n + Number.EPSILON) *
      factor
    ) / factor
  );
}

function getBaseUrl(event) {
  const headers =
    event.headers || {};

  const proto =
    headers["x-forwarded-proto"] ||
    headers["X-Forwarded-Proto"] ||
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

    throw new Error(detail);
  }

  return data;
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

/*
  Snapshot schemas can evolve.

  Keep population extraction intentionally tolerant so the
  leaderboard is not tightly coupled to one property name.

  We only accept arrays containing player-like objects.
*/
function findPlayerArray(snapshot) {
  const candidates = [
    snapshot.eligiblePlayers,
    snapshot.eligibleRBs,
    snapshot.population,
    snapshot.players,
    snapshot.runningBacks,
    snapshot.rbs,
    snapshot.snapshot,
    snapshot.data
  ];

  for (const candidate of candidates) {
    if (
      Array.isArray(candidate) &&
      candidate.length > 0
    ) {
      return candidate;
    }
  }

  /*
    Some snapshot versions may wrap the population one level down.
  */
  const nestedObjects = [
    snapshot.population,
    snapshot.snapshot,
    snapshot.data
  ];

  for (const object of nestedObjects) {
    if (
      !object ||
      typeof object !== "object" ||
      Array.isArray(object)
    ) {
      continue;
    }

    const nestedCandidates = [
      object.eligiblePlayers,
      object.eligibleRBs,
      object.players,
      object.runningBacks,
      object.rbs
    ];

    for (const candidate of nestedCandidates) {
      if (
        Array.isArray(candidate) &&
        candidate.length > 0
      ) {
        return candidate;
      }
    }
  }

  return [];
}

function playerIDFromRecord(player) {
  if (
    !player ||
    typeof player !== "object"
  ) {
    return null;
  }

  const value =
    player.playerID ??
    player.playerId ??
    player.id;

  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const result =
    String(value).trim();

  return result || null;
}

function playerNameFromRecord(player) {
  if (
    !player ||
    typeof player !== "object"
  ) {
    return null;
  }

  return (
    player.name ||
    player.longName ||
    player.playerName ||
    null
  );
}

async function fetchSnapshot({
  baseUrl,
  season,
  week,
  seasonType
}) {
  const url =
    buildUrl({
      baseUrl,

      functionName:
        SNAPSHOT_FUNCTION,

      params: {
        season,
        week:
          String(week),
        seasonType
      }
    });

  const data =
    await fetchJson(url);

  if (
    !data ||
    data.evidenceType !==
      "weekly-sage-rb-snapshot"
  ) {
    throw new Error(
      "Unexpected RB snapshot schema."
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
          String(week),
        seasonType,
        playerID
      }
    });

  const data =
    await fetchJson(url);

  if (
    !data ||
    data.evidenceType !==
      "weekly-sage-rb-final-score"
  ) {
    throw new Error(
      "Unexpected final RB score schema."
    );
  }

  return data;
}

function leaderboardRecord(result) {
  const player =
    result.player || {};

  const components =
    result.components || {};

  const role =
    components.role || {};

  const production =
    components.production || {};

  const matchup =
    components.matchup || {};

  const sage =
    result.sage || {};

  return {
    playerID:
      player.playerID ||
      null,

    name:
      player.name ||
      null,

    team:
      player.team ||
      null,

    position:
      player.position ||
      "RB",

    opponent:
      matchup.opponent ||
      (
        result.upcomingGame &&
        result.upcomingGame.opponent
      ) ||
      null,

    location:
      (
        result.upcomingGame &&
        result.upcomingGame.location
      ) ||
      null,

    role: {
      rawScore:
        num(role.rawScore),

      adjustedScore:
        num(role.adjustedScore),

      confidence:
        num(
          role.confidence &&
          role.confidence.weight
        )
    },

    production: {
      rawScore:
        num(production.rawScore),

      adjustedScore:
        num(production.adjustedScore),

      confidence:
        num(
          production.confidence &&
          production.confidence.weight
        )
    },

    matchup: {
      rawScore:
        num(matchup.rawScore),

      adjustedScore:
        num(matchup.adjustedScore),

      confidence:
        num(
          matchup.confidence &&
          matchup.confidence.weight
        ),

      signal:
        matchup.signal ||
        null,

      label:
        matchup.label ||
        null
    },

    sage: {
      score:
        num(sage.score),

      label:
        sage.label ||
        null,

      confidence:
        num(
          sage.confidence &&
          sage.confidence.weight
        ),

      confidenceLabel:
        (
          sage.confidence &&
          sage.confidence.label
        ) ||
        null
    },

    recommendation:
      result.recommendation ??
      null
  };
}

function compareLeaderboard(a, b) {
  const scoreA =
    num(
      a &&
      a.sage &&
      a.sage.score
    );

  const scoreB =
    num(
      b &&
      b.sage &&
      b.sage.score
    );

  if (
    scoreA === null &&
    scoreB === null
  ) {
    return 0;
  }

  if (scoreA === null) {
    return 1;
  }

  if (scoreB === null) {
    return -1;
  }

  if (scoreB !== scoreA) {
    return scoreB - scoreA;
  }

  /*
    Tie breaker #1:
    higher confidence.
  */
  const confidenceA =
    num(
      a &&
      a.sage &&
      a.sage.confidence
    ) ?? 0;

  const confidenceB =
    num(
      b &&
      b.sage &&
      b.sage.confidence
    ) ?? 0;

  if (
    confidenceB !==
    confidenceA
  ) {
    return (
      confidenceB -
      confidenceA
    );
  }

  /*
    Tie breaker #2:
    alphabetical player name.

    This is deterministic only.
    It has no football meaning.
  */
  return String(
    a.name || ""
  ).localeCompare(
    String(
      b.name || ""
    )
  );
}

function distribution(values) {
  const clean =
    values
      .map(num)
      .filter(
        value =>
          value !== null
      )
      .sort(
        (a, b) =>
          a - b
      );

  if (
    clean.length === 0
  ) {
    return {
      count: 0,
      min: null,
      max: null,
      mean: null,
      median: null
    };
  }

  const total =
    clean.reduce(
      (sum, value) =>
        sum + value,
      0
    );

  let median = null;

  const middle =
    Math.floor(
      clean.length / 2
    );

  if (
    clean.length % 2 === 0
  ) {
    median =
      (
        clean[middle - 1] +
        clean[middle]
      ) / 2;
  } else {
    median =
      clean[middle];
  }

  return {
    count:
      clean.length,

    min:
      round(
        clean[0],
        1
      ),

    max:
      round(
        clean[
          clean.length - 1
        ],
        1
      ),

    mean:
      round(
        total /
        clean.length,
        1
      ),

    median:
      round(
        median,
        1
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

    const query =
      event.queryStringParameters ||
      {};

    const season =
      String(
        query.season ||
        new Date()
          .getFullYear()
      );

    const week =
      Number(
        query.week
      );

    const seasonType =
      String(
        query.seasonType ||
        DEFAULT_SEASON_TYPE
      );

    if (
      !Number.isInteger(week) ||
      week < 2 ||
      week > 18
    ) {
      return jsonResponse(
        400,
        {
          error:
            "week must be an integer from 2 through 18."
        }
      );
    }

    try {
      const baseUrl =
        getBaseUrl(event);

      /*
        STEP 1
        ------
        Read the cached RB snapshot.

        This is the population source.
      */
      const snapshot =
        await fetchSnapshot({
          baseUrl,
          season,
          week,
          seasonType
        });

      const population =
        findPlayerArray(
          snapshot
        );

      if (
        population.length === 0
      ) {
        return jsonResponse(
          422,
          {
            error:
              "Could not locate the eligible RB population in the Weekly SAGE RB snapshot.",

            diagnostic: {
              snapshotKeys:
                Object.keys(
                  snapshot
                )
            }
          }
        );
      }

      /*
        STEP 2
        ------
        Deduplicate player IDs.

        The snapshot remains authoritative about who belongs
        in this week's eligible RB population.
      */
      const playerMap =
        new Map();

      for (
        const player of population
      ) {
        const playerID =
          playerIDFromRecord(
            player
          );

        if (!playerID) {
          continue;
        }

        if (
          !playerMap.has(
            playerID
          )
        ) {
          playerMap.set(
            playerID,
            {
              playerID,

              name:
                playerNameFromRecord(
                  player
                )
            }
          );
        }
      }

      const players =
        Array.from(
          playerMap.values()
        );

      if (
        players.length === 0
      ) {
        return jsonResponse(
          422,
          {
            error:
              "RB snapshot population did not contain usable player IDs."
          }
        );
      }

      /*
        STEP 3
        ------
        Score every eligible RB.

        Population size is intentionally small because the
        snapshot already applied our eligibility rules.

        Promise.allSettled means one player failure will not
        destroy the entire leaderboard.
      */
      const results =
        await Promise.allSettled(
          players.map(
            player =>
              fetchFinalScore({
                baseUrl,
                season,
                week,
                seasonType,
                playerID:
                  player.playerID
              })
          )
        );

      const leaderboard =
        [];

      const failures =
        [];

      results.forEach(
        (
          result,
          index
        ) => {
          const requestedPlayer =
            players[index];

          if (
            result.status ===
            "fulfilled"
          ) {
            leaderboard.push(
              leaderboardRecord(
                result.value
              )
            );

            return;
          }

          failures.push({
            playerID:
              requestedPlayer.playerID,

            name:
              requestedPlayer.name,

            error:
              result.reason &&
              result.reason.message
                ? result.reason.message
                : String(
                    result.reason ||
                    "Unknown scoring failure."
                  )
          });
        }
      );

      /*
        STEP 4
        ------
        Rank by final SAGE score.
      */
      leaderboard.sort(
        compareLeaderboard
      );

      leaderboard.forEach(
        (
          player,
          index
        ) => {
          player.rank =
            index + 1;
        }
      );

      const sageDistribution =
        distribution(
          leaderboard.map(
            player =>
              player.sage.score
          )
        );

      /*
        STEP 5
        ------
        Return validation board.

        Still NO recommendation thresholds.
      */
      return jsonResponse(
        200,
        {
          evidenceType:
            "weekly-sage-rb-leaderboard",

          schemaVersion:
            1,

          generatedAt:
            new Date()
              .toISOString(),

          season,

          targetWeek:
            week,

          seasonType,

          methodology: {
            ranking:
              "Descending final confidence-adjusted Weekly SAGE Score.",

            tieBreakers: [
              "Higher overall SAGE confidence",
              "Alphabetical player name for deterministic ordering only"
            ],

            recommendationThresholdsApplied:
              false,

            important:
              "This leaderboard is for model validation. START / FLEX / SIT thresholds have not been defined."
          },

          architecture: {
            populationSource:
              "weekly-sage-rb-snapshot",

            playerScoreSource:
              "weekly-sage-rb-final-score",

            populationRebuiltByLeaderboard:
              false,

            directTank01Calls:
              0
          },

          population: {
            snapshotPlayersFound:
              population.length,

            uniquePlayerIDs:
              players.length,

            successfullyScored:
              leaderboard.length,

            failures:
              failures.length
          },

          scoreDistribution:
            sageDistribution,

          leaderboard,

          failures,

          recommendation:
            null,

          nextStep: {
            ready:
              leaderboard.length > 0,

            reason:
              "Inspect the complete Week SAGE score distribution and natural score separation before defining consumer-facing recommendation tiers."
          },

          provenance: {
            population:
              "weekly-sage-rb-snapshot",

            finalScores:
              "weekly-sage-rb-final-score",

            roleAndProduction:
              "weekly-sage-rb-component-scores",

            confidence:
              "weekly-sage-rb-confidence",

            matchup:
              "weekly-sage-player-matchup"
          }
        },

        CACHE_CONTROL
      );
    } catch (error) {
      console.error(
        "weekly-sage-rb-leaderboard failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not build Weekly SAGE RB leaderboard.",

          detail:
            error.message
        }
      );
    }
  };
