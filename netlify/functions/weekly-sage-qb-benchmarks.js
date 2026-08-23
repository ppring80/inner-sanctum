// netlify/functions/weekly-sage-qb-benchmarks.js
//
// WEEKLY SAGE — QB BENCHMARKS
//
// PURPOSE
// -------
// Convert the reusable QB population snapshot into peer-relative
// benchmark evidence for one requested quarterback.
//
// SOURCE
// ------
//
//   weekly-sage-qb-snapshot
//
// This endpoint DOES NOT:
//
// - call Tank01 directly
// - rebuild player-game evidence itself
// - calculate final QB Role or Production scores
// - assign Role / Production / Matchup weights
// - calculate a final SAGE score
// - create START / FLEX / SIT recommendations
//
// PRINCIPLE
// ---------
// The snapshot tells us WHAT happened entering the target week.
//
// This endpoint tells us WHERE the requested QB sits relative
// to the eligible QB peer population.
//
// PERCENTILE METHOD
// -----------------
// Midrank:
//
//   ((players below + 0.5 * players tied) / population size) * 100
//
// Higher benchmark percentiles always mean better peer-relative evidence.
//
// For interceptions per game, lower raw values are better, so that metric's
// percentile is inverted after midrank calculation.
//
// IMPORTANT
// ---------
// These percentiles are diagnostic peer-relative evidence.
//
// They are NOT yet the QB SAGE component formulas.
//
// We will inspect the benchmark behavior before deciding how
// passing volume, rushing usage, efficiency, yardage and touchdown production
// should combine into QB Role and Production scores.
//
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_SEASON_TYPE =
  "reg";

const POSITION =
  "QB";

const SNAPSHOT_FUNCTION =
  "weekly-sage-qb-snapshot";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

/*
  All raw QB evidence currently available from the snapshot.

  Including a metric here means:
    - expose its population distribution
    - expose the requested player's percentile

  It DOES NOT mean the metric has been selected for the final
  SAGE component formula.
*/
const ROLE_METRICS = [
  {
    key:
      "passAttemptsPerGame",

    label:
      "Pass Attempts per Game",

    direction:
      "higher_is_better"
  },

  {
    key:
      "carriesPerGame",

    label:
      "Rush Attempts per Game",

    direction:
      "higher_is_better"
  },

  {
    key:
      "offensiveSnapPct",

    label:
      "Offensive Snap Percentage",

    direction:
      "higher_is_better"
  }
];

const PRODUCTION_METRICS = [
  {
    key:
      "passYardsPerGame",

    label:
      "Passing Yards per Game",

    direction:
      "higher_is_better"
  },

  {
    key:
      "passTDPerGame",

    label:
      "Passing TD per Game",

    direction:
      "higher_is_better"
  },

  {
    key:
      "rushingYardsPerGame",

    label:
      "Rushing Yards per Game",

    direction:
      "higher_is_better"
  },

  {
    key:
      "rushingTDPerGame",

    label:
      "Rushing TD per Game",

    direction:
      "higher_is_better"
  },

  {
    key:
      "yardsPerAttempt",

    label:
      "Yards per Attempt",

    direction:
      "higher_is_better"
  },

  {
    key:
      "interceptionsPerGame",

    label:
      "Interceptions per Game",

    direction:
      "lower_is_better"
  }
];

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
  } catch (error) {
    data =
      null;
  }

  if (
    !response.ok
  ) {
    const rawDetail =
      data &&
      (
        data.detail ||
        data.error
      );

    let detail =
      `HTTP ${response.status}`;

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
          String(
            rawDetail
          );
      }
    }

    throw new Error(
      detail
    );
  }

  return data;
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
      "weekly-sage-qb-snapshot"
  ) {
    throw new Error(
      "Unexpected Weekly SAGE QB snapshot schema."
    );
  }

  return data;
}

function percentileValue(
  values,
  percentile
) {
  const clean =
    values
      .map(
        nullableNum
      )
      .filter(
        function (
          value
        ) {
          return (
            value !==
            null
          );
        }
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

  if (
    clean.length ===
    0
  ) {
    return null;
  }

  if (
    clean.length ===
    1
  ) {
    return round(
      clean[0],
      2
    );
  }

  const position =
    (
      clean.length -
      1
    ) *
    percentile;

  const lowerIndex =
    Math.floor(
      position
    );

  const upperIndex =
    Math.ceil(
      position
    );

  if (
    lowerIndex ===
    upperIndex
  ) {
    return round(
      clean[
        lowerIndex
      ],
      2
    );
  }

  const interpolationWeight =
    position -
    lowerIndex;

  const value =
    (
      clean[
        lowerIndex
      ] *
      (
        1 -
        interpolationWeight
      )
    ) +
    (
      clean[
        upperIndex
      ] *
      interpolationWeight
    );

  return round(
    value,
    2
  );
}

function buildDistribution(
  values
) {
  const clean =
    values
      .map(
        nullableNum
      )
      .filter(
        function (
          value
        ) {
          return (
            value !==
            null
          );
        }
      );

  if (
    clean.length ===
    0
  ) {
    return {
      count:
        0,

      min:
        null,

      p10:
        null,

      p25:
        null,

      median:
        null,

      p75:
        null,

      p90:
        null,

      max:
        null,

      mean:
        null
    };
  }

  const total =
    clean.reduce(
      function (
        sum,
        value
      ) {
        return (
          sum +
          value
        );
      },
      0
    );

  return {
    count:
      clean.length,

    min:
      round(
        Math.min(
          ...clean
        ),
        2
      ),

    p10:
      percentileValue(
        clean,
        0.10
      ),

    p25:
      percentileValue(
        clean,
        0.25
      ),

    median:
      percentileValue(
        clean,
        0.50
      ),

    p75:
      percentileValue(
        clean,
        0.75
      ),

    p90:
      percentileValue(
        clean,
        0.90
      ),

    max:
      round(
        Math.max(
          ...clean
        ),
        2
      ),

    mean:
      round(
        total /
        clean.length,
        2
      )
  };
}

/*
  Midrank percentile:

    below + half of tied players
    ----------------------------
            population

  multiplied by 100.

  Example:
    In a 100-player population, if 80 are below and
    4 players including the target are tied:

      (80 + 0.5 * 4) / 100 = 82nd percentile

  This avoids arbitrary ordering of tied values.
*/
function midrankPercentile(
  values,
  targetValue
) {
  const target =
    nullableNum(
      targetValue
    );

  const clean =
    values
      .map(
        nullableNum
      )
      .filter(
        function (
          value
        ) {
          return (
            value !==
            null
          );
        }
      );

  if (
    target ===
      null ||
    clean.length ===
      0
  ) {
    return null;
  }

  let below =
    0;

  let tied =
    0;

  for (
    const value of
    clean
  ) {
    if (
      value <
      target
    ) {
      below +=
        1;
    } else if (
      value ===
      target
    ) {
      tied +=
        1;
    }
  }

  return round(
    (
      (
        below +
        (
          0.5 *
          tied
        )
      ) /
      clean.length
    ) *
    100,
    1
  );
}

function directionAwarePercentile(
  values,
  targetValue,
  direction
) {
  const raw =
    midrankPercentile(
      values,
      targetValue
    );

  if (
    raw ===
    null
  ) {
    return null;
  }

  if (
    direction ===
    "lower_is_better"
  ) {
    return round(
      100 -
      raw,
      1
    );
  }

  return raw;
}

function metricValues(
  population,
  section,
  metricKey
) {
  return population
    .map(
      function (
        player
      ) {
        if (
          !player ||
          !player[
            section
          ]
        ) {
          return null;
        }

        return nullableNum(
          player[
            section
          ][
            metricKey
          ]
        );
      }
    )
    .filter(
      function (
        value
      ) {
        return (
          value !==
          null
        );
      }
    );
}

function benchmarkMetric({
  population,
  player,
  section,
  metric
}) {
  const values =
    metricValues(
      population,
      section,
      metric.key
    );

  const value =
    player &&
    player[
      section
    ]
      ? nullableNum(
          player[
            section
          ][
            metric.key
          ]
        )
      : null;

  return {
    label:
      metric.label,

    value,

    percentile:
      directionAwarePercentile(
        values,
        value,
        metric.direction ||
          "higher_is_better"
      ),

    direction:
      metric.direction ||
      "higher_is_better",

    distribution:
      buildDistribution(
        values
      )
  };
}

function benchmarkSection({
  population,
  player,
  section,
  metrics
}) {
  const output =
    {};

  for (
    const metric of
    metrics
  ) {
    output[
      metric.key
    ] =
      benchmarkMetric({
        population,
        player,
        section,
        metric
      });
  }

  return output;
}

function populationRank({
  population,
  playerID,
  section,
  metricKey
}) {
  const ranked =
    population
      .map(
        function (
          player
        ) {
          return {
            playerID:
              String(
                player.playerID ||
                ""
              ),

            name:
              player.name ||
              null,

            value:
              nullableNum(
                player &&
                player[
                  section
                ] &&
                player[
                  section
                ][
                  metricKey
                ]
              )
          };
        }
      )
      .filter(
        function (
          row
        ) {
          return (
            row.value !==
            null
          );
        }
      )
      .sort(
        function (
          a,
          b
        ) {
          if (
            b.value !==
            a.value
          ) {
            return (
              b.value -
              a.value
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

  const targetIndex =
    ranked.findIndex(
      function (
        row
      ) {
        return (
          row.playerID ===
          String(
            playerID
          )
        );
      }
    );

  return {
    rank:
      targetIndex >=
      0
        ? targetIndex +
          1
        : null,

    populationSize:
      ranked.length
  };
}

function summarizePercentiles(
  benchmarks
) {
  const entries =
    Object.entries(
      benchmarks ||
      {}
    );

  const values =
    entries
      .map(
        function ([
          key,
          benchmark
        ]) {
          return {
            key,

            percentile:
              nullableNum(
                benchmark &&
                benchmark.percentile
              )
          };
        }
      )
      .filter(
        function (
          row
        ) {
          return (
            row.percentile !==
            null
          );
        }
      );

  if (
    values.length ===
    0
  ) {
    return {
      metricsAvailable:
        0,

      averagePercentile:
        null,

      highestMetric:
        null,

      lowestMetric:
        null
    };
  }

  const average =
    values.reduce(
      function (
        sum,
        row
      ) {
        return (
          sum +
          row.percentile
        );
      },
      0
    ) /
    values.length;

  const descending =
    [
      ...values
    ].sort(
      function (
        a,
        b
      ) {
        return (
          b.percentile -
          a.percentile
        );
      }
    );

  return {
    metricsAvailable:
      values.length,

    averagePercentile:
      round(
        average,
        1
      ),

    highestMetric:
      descending[0] ||
      null,

    lowestMetric:
      descending[
        descending.length -
        1
      ] ||
      null,

    important:
      "Average percentile is diagnostic only and is not a SAGE component score."
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

function statusError(
  status,
  body
) {
  const err =
    new Error(
      (
        body &&
        body.error
      ) ||
      "Request failed."
    );

  err.status =
    status;

  err.body =
    body;

  return err;
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

    const playerID =
      String(
        query.playerID ||
        ""
      ).trim();

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

    if (
      !playerID
    ) {
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
        getBaseUrl(
          event
        );

      const body =
        await buildQbBenchmarks({
          baseUrl,
          season,
          targetWeek,
          seasonType,
          playerID
        });

      return jsonResponse(
        200,
        body,
        CACHE_CONTROL
      );
    } catch (
      error
    ) {
      if (
        typeof error.status ===
        "number"
      ) {
        return jsonResponse(
          error.status,
          error.body
        );
      }

      console.error(
        "weekly-sage-qb-benchmarks failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not build Weekly SAGE QB benchmarks.",

          detail:
            error.message
        }
      );
    }
  };

/*
  Core Weekly SAGE QB benchmark computation, extracted additively.
  exports.handler above is a thin wrapper around this function.

  Returns plain data on success. Early-exit cases throw via
  statusError(status, body) instead of calling jsonResponse()
  directly, since this function returns plain data (not an HTTP
  response) and may be called by weekly-sage-qb-component-scores.js
  in-process, which needs an ordinary JS error to propagate
  correctly, not an HTTP envelope. exports.handler above translates
  any statusError back into the same jsonResponse(status, body)
  shape.

  prebuiltSnapshot is OPTIONAL. When supplied in-process from
  weekly-sage-qb-leaderboard.js through the downstream scoring chain,
  fetchSnapshot() is never called. When omitted, this function
  fetches the QB snapshot itself for independent GET requests.
*/
async function buildQbBenchmarks({
  baseUrl,
  season,
  targetWeek,
  seasonType,
  playerID,
  prebuiltSnapshot
}) {
  /*
    STEP 1
    ------
    Fetch the reusable QB population.

    This endpoint makes no Tank01 calls.
  */
  const snapshot =
    prebuiltSnapshot ||
    await fetchSnapshot({
      baseUrl,
      season,
      week:
        targetWeek,
      seasonType
    });

  if (
    !snapshot.nextStep ||
    !snapshot.nextStep.ready
  ) {
    throw statusError(
      422,
      {
        error:
          "QB snapshot is not ready for benchmark use.",

        snapshotStatus:
          snapshot.nextStep ||
          null
      }
    );
  }

  const population =
    Array.isArray(
      snapshot.population
    )
      ? snapshot.population
      : [];

  if (
    population.length ===
    0
  ) {
    throw statusError(
      422,
      {
        error:
          "QB snapshot contains no eligible peer population."
      }
    );
  }

  /*
    STEP 2
    ------
    Find the requested QB inside the already-validated snapshot.

    We intentionally do NOT inject an outside player here.

    If a player is absent, that tells us the snapshot eligibility
    rules did not include him. That is useful information and
    should be addressed at the population layer rather than hidden
    by benchmark-time injection.
  */
  const player =
    population.find(
      function (
        candidate
      ) {
        return (
          String(
            candidate.playerID ||
            ""
          ) ===
          playerID
        );
      }
    );

  if (
    !player
  ) {
    throw statusError(
      404,
      {
        error:
          "Requested QB is not present in the eligible QB snapshot population.",

        playerID,

        snapshotKey:
          snapshot.snapshotKey ||
          null,

        eligibleQBPopulation:
          population.length,

        populationRules:
          snapshot.methodology
            ? {
                minimumGames:
                  snapshot
                    .methodology
                    .minimumGames,

                minimumPassAttemptsPerGame:
                  snapshot
                    .methodology
                    .minimumPassAttemptsPerGame
              }
            : null
      }
    );
  }

  if (
    player.position !==
    POSITION
  ) {
    throw statusError(
      400,
      {
        error:
          "QB benchmarks require a QB.",

        playerID,

        position:
          player.position ||
          null
      }
    );
  }

  /*
    STEP 3
    ------
    Convert raw evidence into peer percentiles.

    Again: these are NOT yet Role / Production scores.
  */
  const roleBenchmarks =
    benchmarkSection({
      population,
      player,
      section:
        "role",
      metrics:
        ROLE_METRICS
    });

  const productionBenchmarks =
    benchmarkSection({
      population,
      player,
      section:
        "production",
      metrics:
        PRODUCTION_METRICS
    });

  const passAttemptsRank =
    populationRank({
      population,
      playerID,
      section:
        "role",
      metricKey:
        "passAttemptsPerGame"
    });

  const carriesRank =
    populationRank({
      population,
      playerID,
      section:
        "role",
      metricKey:
        "carriesPerGame"
    });

  const passYardsRank =
    populationRank({
      population,
      playerID,
      section:
        "production",
      metricKey:
        "passYardsPerGame"
    });

  const rushingYardsRank =
    populationRank({
      population,
      playerID,
      section:
        "production",
      metricKey:
        "rushingYardsPerGame"
    });

  return {
    evidenceType:
      "weekly-sage-qb-benchmarks",

    schemaVersion:
      1,

    generatedAt:
      new Date()
        .toISOString(),

    season,

    targetWeek,

    seasonType,

    snapshotKey:
      snapshot.snapshotKey ||
      `${season}|${targetWeek}|${seasonType}|QB`,

    noLookAhead: {
      rule:
        `Only player evidence before Week ${targetWeek} is used.`,

      targetWeekExcluded:
        true,

      source:
        "weekly-sage-qb-snapshot",

      sourceWeeks:
        snapshot.noLookAhead &&
        Array.isArray(
          snapshot
            .noLookAhead
            .weeksQueried
        )
          ? snapshot
              .noLookAhead
              .weeksQueried
          : []
    },

    methodology: {
      position:
        POSITION,

      populationDefinition:
        "Quarterbacks meeting the QB snapshot's minimum prior-game and passing-volume eligibility rules entering the target week.",

      populationRules: {
        minimumGames:
          snapshot.methodology
            ? snapshot
                .methodology
                .minimumGames
            : null,

        minimumPassAttemptsPerGame:
          snapshot.methodology
            ? snapshot
                .methodology
                .minimumPassAttemptsPerGame
            : null
      },

      percentileMethod:
        "midrank",

      percentileFormula:
        "((players below + 0.5 * players tied) / population size) * 100",

      direction:
        "Higher percentile always means better peer-relative evidence. Interceptions per game is inverted because lower is better; all other QB metrics are higher-is-better.",

      roleMetricsBenchmarked:
        ROLE_METRICS.map(
          function (
            metric
          ) {
            return (
              metric.key
            );
          }
        ),

      productionMetricsBenchmarked:
        PRODUCTION_METRICS.map(
          function (
            metric
          ) {
            return (
              metric.key
            );
          }
        ),

      important:
        "These percentiles describe the QB peer population. They are not yet final SAGE Role or Production scores and no component weights are applied."
    },

    populationSummary: {
      eligibleQBPopulation:
        population.length,

      snapshotCandidatesDiscovered:
        snapshot.populationSummary
          ? snapshot
              .populationSummary
              .qbCandidatesDiscovered
          : null,

      snapshotPlayerGameFailures:
        snapshot.populationSummary
          ? snapshot
              .populationSummary
              .playerGameFailures
          : null,

      populationRebuiltByBenchmarks:
        false,

      directTank01Calls:
        0
    },

    player: {
      playerID:
        player.playerID,

      name:
        player.name ||
        null,

      team:
        player.team ||
        null,

      currentTeam:
        player.currentTeam ||
        null,

      position:
        player.position,

      gamesUsed:
        player.gamesUsed,

      weeksIncluded:
        player.weeksIncluded,

      historicalIdentity:
        player.historicalIdentity ||
        null
    },

    populationRanks: {
      passAttemptsPerGame: {
        rank:
          passAttemptsRank.rank,

        populationSize:
          passAttemptsRank
            .populationSize
      },

      carriesPerGame: {
        rank:
          carriesRank.rank,

        populationSize:
          carriesRank
            .populationSize
      },

      passYardsPerGame: {
        rank:
          passYardsRank.rank,

        populationSize:
          passYardsRank
            .populationSize
      },

      rushingYardsPerGame: {
        rank:
          rushingYardsRank.rank,

        populationSize:
          rushingYardsRank
            .populationSize
      }
    },

    rawEvidence: {
      role:
        player.role,

      production:
        player.production
    },

    benchmarks: {
      role:
        roleBenchmarks,

      production:
        productionBenchmarks
    },

    diagnosticSummary: {
      role:
        summarizePercentiles(
          roleBenchmarks
        ),

      production:
        summarizePercentiles(
          productionBenchmarks
        ),

      important:
        "Diagnostic averages summarize percentile behavior only. Do not use them as final SAGE component scores."
    },

    recommendation:
      null,

    nextStep: {
      ready:
        true,

      reason:
        "QB benchmark percentiles are available. Inspect representative QB profiles before selecting the evidence and weights used to construct QB Role and Production component scores."
    },

    architecture: {
      populationSource:
        "weekly-sage-qb-snapshot",

      populationRebuiltForThisPlayer:
        false,

      directTank01Calls:
        0
    },

    provenance: {
      peerPopulation:
        "weekly-sage-qb-snapshot",

      historicalIdentity:
        "weekly-sage-qb-snapshot",

      benchmarkMethod:
        "midrank peer percentile"
    }
  };
}

exports.buildQbBenchmarks =
  buildQbBenchmarks;
