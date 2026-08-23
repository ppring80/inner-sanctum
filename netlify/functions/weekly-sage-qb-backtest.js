// netlify/functions/weekly-sage-qb-backtest.js
//
// WEEKLY SAGE — QB MULTI-WEEK BACKTEST
//
// PURPOSE
// -------
// Aggregate multiple historical Weekly SAGE QB validation weeks
// into one clean forecast-vs-actual dataset.
//
// SOURCE
// ------
//
//   weekly-sage-qb-validation
//
// Each weekly validation endpoint already guarantees:
//
//   PRE-GAME
//     SAGE uses only information available before target week.
//
//   POST-GAME
//     Actual target-week production is used only for validation.
//
//   PARTICIPATION
//     PLAYED -> included
//     BYE -> excluded
//     DID NOT PLAY -> excluded
//     FAILURE -> blocks clean backtest
//
// THIS FUNCTION CALCULATES
// ------------------------
//
//   - combined QB player-week sample
//   - Pearson correlation
//   - Spearman correlation
//   - simple linear regression
//   - R-squared
//   - MAE
//   - RMSE
//   - Role / Production / Matchup correlations
//   - aggregate SAGE score bands
//   - weekly validation summaries
//
// IMPORTANT
// ---------
// This endpoint is DESCRIPTIVE VALIDATION.
//
// It DOES NOT:
//
//   - change QB SAGE weights
//   - optimize QB weights
//   - create START / FLEX / SIT thresholds
//   - feed actual outcomes into historical predictions
//
// DEFAULT VALIDATION WINDOW
// -------------------------
//
//   Weeks 8 through 17
//
// This is the explicit QB validation window built and cached for the
// provisional QB SAGE v1 experiment. The 10-week window is frozen before
// any QB weight optimization is attempted.
//
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_SEASON_TYPE =
  "reg";

const DEFAULT_START_WEEK =
  8;

const DEFAULT_END_WEEK =
  17;

const VALIDATION_FUNCTION =
  "weekly-sage-qb-validation";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

const DEFAULT_CONCURRENCY =
  2;

const MAX_CONCURRENCY =
  4;

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
  digits = 3
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

async function fetchJsonWithStatus(
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

  return {
    ok:
      response.ok,

    status:
      response.status,

    data
  };
}

function errorMessage(
  result
) {
  if (
    !result
  ) {
    return (
      "Unknown validation retrieval failure."
    );
  }

  const data =
    result.data ||
    {};

  return (
    data.detail ||
    data.error ||
    `HTTP ${result.status}`
  );
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

function buildWeeks(
  startWeek,
  endWeek
) {
  const weeks =
    [];

  for (
    let week =
      startWeek;
    week <=
      endWeek;
    week +=
      1
  ) {
    weeks.push(
      week
    );
  }

  return weeks;
}

async function fetchValidationWeek({
  baseUrl,
  season,
  week,
  seasonType
}) {
  const url =
    buildUrl({
      baseUrl,

      functionName:
        VALIDATION_FUNCTION,

      params: {
        season,

        week:
          String(
            week
          ),

        seasonType
      }
    });

  const result =
    await fetchJsonWithStatus(
      url
    );

  if (
    !result.ok
  ) {
    return {
      ok:
        false,

      week,

      status:
        result.status,

      error:
        errorMessage(
          result
        )
    };
  }

  const data =
    result.data;

  if (
    !data ||
    data.evidenceType !==
      "weekly-sage-qb-validation"
  ) {
    return {
      ok:
        false,

      week,

      status:
        502,

      error:
        "Unexpected Weekly SAGE QB validation schema."
    };
  }

  return {
    ok:
      true,

    week,

    data
  };
}

async function mapWithConcurrency(
  items,
  concurrency,
  mapper
) {
  const results =
    new Array(
      items.length
    );

  let nextIndex =
    0;

  async function worker() {
    while (
      true
    ) {
      const index =
        nextIndex;

      nextIndex +=
        1;

      if (
        index >=
        items.length
      ) {
        return;
      }

      try {
        results[
          index
        ] =
          await mapper(
            items[
              index
            ],
            index
          );
      } catch (
        error
      ) {
        results[
          index
        ] = {
          ok:
            false,

          week:
            items[
              index
            ],

          status:
            500,

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
  }

  const workerCount =
    Math.min(
      concurrency,
      items.length
    );

  if (
    workerCount <=
    0
  ) {
    return results;
  }

  await Promise.all(
    Array.from(
      {
        length:
          workerCount
      },
      function () {
        return worker();
      }
    )
  );

  return results;
}

/*
  Convert one weekly validation record into one compact
  player-week observation.

  One observation = one QB who actually played in that week.
*/
function observationFromRecord(
  record,
  week
) {
  return {
    seasonWeek:
      week,

    playerID:
      record.playerID ||
      null,

    name:
      record.name ||
      null,

    team:
      record.team ||
      null,

    currentTeam:
      record.currentTeam ||
      null,

    opponent:
      record.opponent ||
      null,

    sageRank:
      nullableNum(
        record.sageRank
      ),

    sageScore:
      nullableNum(
        record.sageScore
      ),

    sageLabel:
      record.sageLabel ||
      null,

    sageConfidence:
      nullableNum(
        record.sageConfidence
      ),

    components: {
      role:
        nullableNum(
          record.components &&
          record.components.role
        ),

      production:
        nullableNum(
          record.components &&
          record.components.production
        ),

      matchup:
        nullableNum(
          record.components &&
          record.components.matchup
        )
    },

    actual: {
      standard:
        nullableNum(
          record.actual &&
          record.actual
            .fantasyPoints &&
          record.actual
            .fantasyPoints
            .standard
        ),

      halfPPR:
        nullableNum(
          record.actual &&
          record.actual
            .fantasyPoints &&
          record.actual
            .fantasyPoints
            .halfPPR
        ),

      ppr:
        nullableNum(
          record.actual &&
          record.actual
            .fantasyPoints &&
          record.actual
            .fantasyPoints
            .ppr
        ),

      passingYards:
        nullableNum(
          record.actual &&
          record.actual
            .passingYards
        ),

      passingTD:
        nullableNum(
          record.actual &&
          record.actual
            .passingTD
        ),

      interceptions:
        nullableNum(
          record.actual &&
          record.actual
            .interceptions
        ),

      carries:
        nullableNum(
          record.actual &&
          record.actual
            .carries
        ),

      rushingYards:
        nullableNum(
          record.actual &&
          record.actual
            .rushingYards
        ),

      rushingTD:
        nullableNum(
          record.actual &&
          record.actual
            .rushingTD
        ),

      totalYards:
        nullableNum(
          record.actual &&
          record.actual
            .totalYards
        ),

      totalTD:
        nullableNum(
          record.actual &&
          record.actual
            .totalTD
        )
    }
  };
}

function pairedValues(
  observations,
  xAccessor,
  yAccessor
) {
  const pairs =
    [];

  for (
    const observation of
    observations
  ) {
    const x =
      nullableNum(
        xAccessor(
          observation
        )
      );

    const y =
      nullableNum(
        yAccessor(
          observation
        )
      );

    if (
      x ===
        null ||
      y ===
        null
    ) {
      continue;
    }

    pairs.push({
      x,
      y
    });
  }

  return pairs;
}

function pearsonPairs(
  pairs
) {
  if (
    pairs.length <
    2
  ) {
    return null;
  }

  const meanX =
    pairs.reduce(
      function (
        sum,
        pair
      ) {
        return (
          sum +
          pair.x
        );
      },
      0
    ) /
    pairs.length;

  const meanY =
    pairs.reduce(
      function (
        sum,
        pair
      ) {
        return (
          sum +
          pair.y
        );
      },
      0
    ) /
    pairs.length;

  let numerator =
    0;

  let denominatorX =
    0;

  let denominatorY =
    0;

  for (
    const pair of
    pairs
  ) {
    const dx =
      pair.x -
      meanX;

    const dy =
      pair.y -
      meanY;

    numerator +=
      dx *
      dy;

    denominatorX +=
      dx *
      dx;

    denominatorY +=
      dy *
      dy;
  }

  const denominator =
    Math.sqrt(
      denominatorX *
      denominatorY
    );

  if (
    denominator ===
    0
  ) {
    return null;
  }

  return (
    numerator /
    denominator
  );
}

function pearsonCorrelation(
  observations,
  xAccessor,
  yAccessor
) {
  const pairs =
    pairedValues(
      observations,
      xAccessor,
      yAccessor
    );

  const result =
    pearsonPairs(
      pairs
    );

  return result ===
    null
    ? null
    : round(
        result,
        3
      );
}

function averageRanks(
  values
) {
  const indexed =
    values.map(
      function (
        value,
        index
      ) {
        return {
          value,
          index
        };
      }
    );

  indexed.sort(
    function (
      a,
      b
    ) {
      return (
        a.value -
        b.value
      );
    }
  );

  const ranks =
    new Array(
      values.length
    );

  let i =
    0;

  while (
    i <
    indexed.length
  ) {
    let j =
      i +
      1;

    while (
      j <
        indexed.length &&
      indexed[
        j
      ].value ===
        indexed[
          i
        ].value
    ) {
      j +=
        1;
    }

    const averageRank =
      (
        (
          i +
          1
        ) +
        j
      ) /
      2;

    for (
      let k =
        i;
      k <
        j;
      k +=
        1
    ) {
      ranks[
        indexed[
          k
        ].index
      ] =
        averageRank;
    }

    i =
      j;
  }

  return ranks;
}

function spearmanCorrelation(
  observations,
  xAccessor,
  yAccessor
) {
  const pairs =
    pairedValues(
      observations,
      xAccessor,
      yAccessor
    );

  if (
    pairs.length <
    2
  ) {
    return null;
  }

  const xs =
    pairs.map(
      function (
        pair
      ) {
        return (
          pair.x
        );
      }
    );

  const ys =
    pairs.map(
      function (
        pair
      ) {
        return (
          pair.y
        );
      }
    );

  const xRanks =
    averageRanks(
      xs
    );

  const yRanks =
    averageRanks(
      ys
    );

  const rankedPairs =
    xRanks.map(
      function (
        rank,
        index
      ) {
        return {
          x:
            rank,

          y:
            yRanks[
              index
            ]
        };
      }
    );

  const result =
    pearsonPairs(
      rankedPairs
    );

  return result ===
    null
    ? null
    : round(
        result,
        3
      );
}

function linearRegression(
  observations,
  scoringKey
) {
  const pairs =
    pairedValues(
      observations,

      function (
        observation
      ) {
        return (
          observation.sageScore
        );
      },

      function (
        observation
      ) {
        return (
          observation.actual[
            scoringKey
          ]
        );
      }
    );

  if (
    pairs.length <
    2
  ) {
    return null;
  }

  const meanX =
    pairs.reduce(
      function (
        sum,
        pair
      ) {
        return (
          sum +
          pair.x
        );
      },
      0
    ) /
    pairs.length;

  const meanY =
    pairs.reduce(
      function (
        sum,
        pair
      ) {
        return (
          sum +
          pair.y
        );
      },
      0
    ) /
    pairs.length;

  let numerator =
    0;

  let denominator =
    0;

  for (
    const pair of
    pairs
  ) {
    numerator +=
      (
        pair.x -
        meanX
      ) *
      (
        pair.y -
        meanY
      );

    denominator +=
      Math.pow(
        pair.x -
        meanX,
        2
      );
  }

  if (
    denominator ===
    0
  ) {
    return null;
  }

  const slope =
    numerator /
    denominator;

  const intercept =
    meanY -
    (
      slope *
      meanX
    );

  let squaredError =
    0;

  let absoluteError =
    0;

  let totalVariation =
    0;

  for (
    const pair of
    pairs
  ) {
    const predicted =
      intercept +
      (
        slope *
        pair.x
      );

    const error =
      pair.y -
      predicted;

    squaredError +=
      error *
      error;

    absoluteError +=
      Math.abs(
        error
      );

    totalVariation +=
      Math.pow(
        pair.y -
        meanY,
        2
      );
  }

  const rSquared =
    totalVariation >
      0
      ? (
          1 -
          (
            squaredError /
            totalVariation
          )
        )
      : null;

  const rmse =
    Math.sqrt(
      squaredError /
      pairs.length
    );

  const mae =
    absoluteError /
    pairs.length;

  return {
    observations:
      pairs.length,

    slope:
      round(
        slope,
        4
      ),

    intercept:
      round(
        intercept,
        4
      ),

    rSquared:
      rSquared ===
        null
        ? null
        : round(
            rSquared,
            3
          ),

    mae:
      round(
        mae,
        3
      ),

    rmse:
      round(
        rmse,
        3
      ),

    equation:
      `actual = ${round(
        intercept,
        4
      )} + (${round(
        slope,
        4
      )} * SAGE)`
  };
}

function analyzeScoringSystem(
  observations,
  scoringKey
) {
  const actualAccessor =
    function (
      observation
    ) {
      return (
        observation.actual[
          scoringKey
        ]
      );
    };

  return {
    sageVsFantasyPoints: {
      pearson:
        pearsonCorrelation(
          observations,

          function (
            observation
          ) {
            return (
              observation.sageScore
            );
          },

          actualAccessor
        ),

      spearman:
        spearmanCorrelation(
          observations,

          function (
            observation
          ) {
            return (
              observation.sageScore
            );
          },

          actualAccessor
        )
    },

    componentVsFantasyPoints: {
      role:
        pearsonCorrelation(
          observations,

          function (
            observation
          ) {
            return (
              observation.components.role
            );
          },

          actualAccessor
        ),

      production:
        pearsonCorrelation(
          observations,

          function (
            observation
          ) {
            return (
              observation.components.production
            );
          },

          actualAccessor
        ),

      matchup:
        pearsonCorrelation(
          observations,

          function (
            observation
          ) {
            return (
              observation.components.matchup
            );
          },

          actualAccessor
        )
    },

    regression:
      linearRegression(
        observations,
        scoringKey
      )
  };
}

function combinedAnalysis(
  observations
) {
  return {
    standard:
      analyzeScoringSystem(
        observations,
        "standard"
      ),

    halfPPR:
      analyzeScoringSystem(
        observations,
        "halfPPR"
      ),

    ppr:
      analyzeScoringSystem(
        observations,
        "ppr"
      )
  };
}

function average(
  values
) {
  const clean =
    values.filter(
      function (
        value
      ) {
        return (
          nullableNum(
            value
          ) !==
          null
        );
      }
    );

  if (
    clean.length ===
    0
  ) {
    return null;
  }

  return (
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
    ) /
    clean.length
  );
}

function scoreBandDefinitions() {
  return [
    {
      key:
        "85_plus",

      label:
        "85+",

      min:
        85,

      max:
        Infinity
    },

    {
      key:
        "75_to_84_9",

      label:
        "75-84.9",

      min:
        75,

      max:
        84.999999
    },

    {
      key:
        "65_to_74_9",

      label:
        "65-74.9",

      min:
        65,

      max:
        74.999999
    },

    {
      key:
        "55_to_64_9",

      label:
        "55-64.9",

      min:
        55,

      max:
        64.999999
    },

    {
      key:
        "45_to_54_9",

      label:
        "45-54.9",

      min:
        45,

      max:
        54.999999
    },

    {
      key:
        "35_to_44_9",

      label:
        "35-44.9",

      min:
        35,

      max:
        44.999999
    },

    {
      key:
        "below_35",

      label:
        "Below 35",

      min:
        -Infinity,

      max:
        34.999999
    }
  ];
}

function aggregateScoreBands(
  observations
) {
  return scoreBandDefinitions()
    .map(
      function (
        definition
      ) {
        const rows =
          observations.filter(
            function (
              observation
            ) {
              const score =
                nullableNum(
                  observation.sageScore
                );

              return (
                score !==
                  null &&
                score >=
                  definition.min &&
                score <=
                  definition.max
              );
            }
          );

        return {
          key:
            definition.key,

          label:
            definition.label,

          count:
            rows.length,

          averageSageScore:
            rows.length
              ? round(
                  average(
                    rows.map(
                      function (
                        observation
                      ) {
                        return (
                          observation.sageScore
                        );
                      }
                    )
                  ),
                  1
                )
              : null,

          averageActualFantasyPoints: {
            standard:
              rows.length
                ? round(
                    average(
                      rows.map(
                        function (
                          observation
                        ) {
                          return (
                            observation.actual.standard
                          );
                        }
                      )
                    ),
                    2
                  )
                : null,

            halfPPR:
              rows.length
                ? round(
                    average(
                      rows.map(
                        function (
                          observation
                        ) {
                          return (
                            observation.actual.halfPPR
                          );
                        }
                      )
                    ),
                    2
                  )
                : null,

            ppr:
              rows.length
                ? round(
                    average(
                      rows.map(
                        function (
                          observation
                        ) {
                          return (
                            observation.actual.ppr
                          );
                        }
                      )
                    ),
                    2
                  )
                : null
          }
        };
      }
    );
}

function weeklySummary(
  validation
) {
  const population =
    validation.population ||
    {};

  const correlations =
    validation.correlations ||
    {};

  return {
    week:
      validation.targetWeek,

    activeForecasts:
      nullableNum(
        population.sageActivePlayers
      ),

    outcomesMatched:
      nullableNum(
        population.outcomesMatched
      ),

    byeExcluded:
      nullableNum(
        population.byeExcluded
      ),

    didNotPlayExcluded:
      nullableNum(
        population.didNotPlayExcluded
      ),

    failures:
      nullableNum(
        population.failures
      ),

    standard: {
      pearson:
        nullableNum(
          correlations.standard &&
          correlations.standard
            .sageVsFantasyPoints &&
          correlations.standard
            .sageVsFantasyPoints
            .pearson
        ),

      spearman:
        nullableNum(
          correlations.standard &&
          correlations.standard
            .sageVsFantasyPoints &&
          correlations.standard
            .sageVsFantasyPoints
            .spearman
        )
    },

    halfPPR: {
      pearson:
        nullableNum(
          correlations.halfPPR &&
          correlations.halfPPR
            .sageVsFantasyPoints &&
          correlations.halfPPR
            .sageVsFantasyPoints
            .pearson
        ),

      spearman:
        nullableNum(
          correlations.halfPPR &&
          correlations.halfPPR
            .sageVsFantasyPoints &&
          correlations.halfPPR
            .sageVsFantasyPoints
            .spearman
        )
    },

    ppr: {
      pearson:
        nullableNum(
          correlations.ppr &&
          correlations.ppr
            .sageVsFantasyPoints &&
          correlations.ppr
            .sageVsFantasyPoints
            .pearson
        ),

      spearman:
        nullableNum(
          correlations.ppr &&
          correlations.ppr
            .sageVsFantasyPoints &&
          correlations.ppr
            .sageVsFantasyPoints
            .spearman
        )
    }
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

    const seasonType =
      String(
        query.seasonType ||
        DEFAULT_SEASON_TYPE
      );

    const requestedStartWeek =
      integerOrNull(
        query.startWeek
      );

    const requestedEndWeek =
      integerOrNull(
        query.endWeek
      );

    const requestedConcurrency =
      integerOrNull(
        query.concurrency
      );

    const startWeek =
      requestedStartWeek ||
      DEFAULT_START_WEEK;

    const endWeek =
      requestedEndWeek ||
      DEFAULT_END_WEEK;

    const concurrency =
      clamp(
        requestedConcurrency ||
        DEFAULT_CONCURRENCY,
        1,
        MAX_CONCURRENCY
      );

    if (
      !Number.isInteger(
        startWeek
      ) ||
      !Number.isInteger(
        endWeek
      ) ||
      startWeek <
        2 ||
      endWeek >
        17 ||
      startWeek >
        endWeek
    ) {
      return jsonResponse(
        400,
        {
          error:
            "startWeek and endWeek must be integers from 2 through 17, with startWeek <= endWeek."
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

      const weeks =
        buildWeeks(
          startWeek,
          endWeek
        );

      /*
        STEP 1
        ------
        Retrieve each weekly QB validation result.

        Keep week-level concurrency deliberately low because each
        weekly validation endpoint already retrieves many player-season
        outcome records.
      */
      const weekResults =
        await mapWithConcurrency(
          weeks,
          concurrency,
          function (
            week
          ) {
            return fetchValidationWeek({
              baseUrl,
              season,
              week,
              seasonType
            });
          }
        );

      const validations =
        [];

      const retrievalFailures =
        [];

      for (
        const result of
        weekResults
      ) {
        if (
          result &&
          result.ok &&
          result.data
        ) {
          validations.push(
            result.data
          );
        } else {
          retrievalFailures.push({
            week:
              result &&
              result.week
                ? result.week
                : null,

            status:
              result &&
              result.status
                ? result.status
                : null,

            error:
              result &&
              result.error
                ? result.error
                : "Unknown validation retrieval failure."
          });
        }
      }

      validations.sort(
        function (
          a,
          b
        ) {
          return (
            a.targetWeek -
            b.targetWeek
          );
        }
      );

      /*
        STEP 2
        ------
        Build one clean QB player-week dataset.
      */
      const observations =
        [];

      const weeksSummary =
        [];

      const unreadyWeeks =
        [];

      let totalBye =
        0;

      let totalDNP =
        0;

      let totalFailures =
        0;

      for (
        const validation of
        validations
      ) {
        const week =
          validation.targetWeek;

        weeksSummary.push(
          weeklySummary(
            validation
          )
        );

        const population =
          validation.population ||
          {};

        totalBye +=
          nullableNum(
            population.byeExcluded
          ) ||
          0;

        totalDNP +=
          nullableNum(
            population.didNotPlayExcluded
          ) ||
          0;

        totalFailures +=
          nullableNum(
            population.failures
          ) ||
          0;

        const records =
          Array.isArray(
            validation.validation
          )
            ? validation.validation
            : [];

        for (
          const record of
          records
        ) {
          const observation =
            observationFromRecord(
              record,
              week
            );

          /*
            A clean backtest observation requires:
              SAGE score
              Role
              Production
              Matchup
              all three actual scoring results

            This should normally already be true because weekly
            validation only includes played QBs.
          */
          if (
            observation.sageScore ===
              null ||
            observation.components.role ===
              null ||
            observation.components.production ===
              null ||
            observation.components.matchup ===
              null ||
            observation.actual.standard ===
              null ||
            observation.actual.halfPPR ===
              null ||
            observation.actual.ppr ===
              null
          ) {
            continue;
          }

          observations.push(
            observation
          );
        }

        const validationFailures =
          Array.isArray(
            validation.failures
          )
            ? validation.failures
            : [];

        const ready =
          validation.nextStep &&
          validation.nextStep.ready ===
            true;

        if (
          !ready ||
          validationFailures.length >
            0
        ) {
          unreadyWeeks.push({
            week,

            failures:
              validationFailures.length,

            reason:
              validation.nextStep &&
              validation.nextStep.reason
                ? validation.nextStep.reason
                : "Weekly validation was not ready."
          });
        }
      }

      /*
        STEP 3
        ------
        Analyze combined player-week sample.
      */
      const analysis =
        combinedAnalysis(
          observations
        );

      const scoreBands =
        aggregateScoreBands(
          observations
        );

      const ready =
        validations.length ===
          weeks.length &&
        retrievalFailures.length ===
          0 &&
        unreadyWeeks.length ===
          0 &&
        totalFailures ===
          0 &&
        observations.length >
          0;

      return jsonResponse(
        200,
        {
          evidenceType:
            "weekly-sage-qb-backtest",

          schemaVersion:
            1,

          generatedAt:
            new Date()
              .toISOString(),

          season,

          seasonType,

          requestedWindow: {
            startWeek,

            endWeek,

            weeks
          },

          methodology: {
            modelVersion:
              "qb-sage-v1",

            unitOfObservation:
              "One QB player-week in which the player actually participated in the target-week game.",

            prediction:
              "Frozen pre-game Weekly SAGE QB score.",

            outcome:
              "Actual target-week fantasy points.",

            leakageProtection:
              "This endpoint consumes weekly-sage-qb-validation results. Target-week actual performance never feeds back into the historical SAGE prediction.",

            exclusions: [
              "Bye weeks",
              "Did Not Play",
              "Validation retrieval failures",
              "Incomplete player-week observations"
            ],

            correlation:
              "Pearson measures linear association. Spearman measures ranking association.",

            regression:
              "Simple ordinary least squares regression of actual fantasy points on pre-game QB SAGE Score.",

            componentAnalysis:
              "Role, Production, and Matchup are correlated independently against actual outcomes before any weight optimization is attempted.",

            important:
              "This backtest measures historical predictive relationship. It does not optimize QB weights or create recommendation thresholds. QB weights (55/40/5) remain the Phase 1 placeholder until this backtest has actually been run and reviewed."
          },

          population: {
            weeksRequested:
              weeks.length,

            weeksRetrieved:
              validations.length,

            cleanPlayerWeekObservations:
              observations.length,

            byeExcluded:
              totalBye,

            didNotPlayExcluded:
              totalDNP,

            weeklyFailures:
              totalFailures,

            retrievalFailures:
              retrievalFailures.length,

            concurrency
          },

          weeklyResults:
            weeksSummary,

          combinedAnalysis:
            analysis,

          scoreBands,

          observations,

          diagnostics: {
            retrievalFailures,

            unreadyWeeks
          },

          recommendationThresholds:
            null,

          nextStep: {
            ready,

            reason:
              ready
                ? "The multi-week QB forecast-vs-actual dataset is clean. Review combined SAGE correlations, Role / Production / Matchup relationships, regression fit, and score-band calibration before running QB weight sensitivity."
                : "Resolve retrieval failures or unready validation weeks before interpreting the QB backtest or changing SAGE weights."
          },

          architecture: {
            modelVersion:
              "qb-sage-v1",

            validationSource:
              VALIDATION_FUNCTION,

            recalculatesHistoricalSage:
              false,

            optimizesWeights:
              false,

            directTank01Calls:
              0
          },

          provenance: {
            weeklyValidation:
              VALIDATION_FUNCTION,

            prediction:
              "weekly-sage-qb-leaderboard",

            outcomes:
              "weekly-sage-player-season",

            roleAndProduction:
              "weekly-sage-qb-component-scores",

            confidence:
              "weekly-sage-qb-confidence",

            matchup:
              "weekly-sage-player-matchup"
          }
        },

        CACHE_CONTROL
      );
    } catch (
      error
    ) {
      console.error(
        "weekly-sage-qb-backtest failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not build Weekly SAGE QB multi-week backtest.",

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
