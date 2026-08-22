// netlify/functions/weekly-sage-wr-role-reliability.js
//
// WEEKLY SAGE — WR ROLE RELIABILITY
//
// PURPOSE
// -------
// Measure how dependable WR fantasy production is at different
// PRE-GAME Role Score levels.
//
// CORE QUESTION
// -------------
// Does higher WR Role correspond to a more reliable weekly fantasy
// floor and a greater probability of producing a startable result?
//
// SOURCE
// ------
//
//   weekly-sage-wr-backtest
//
// IMPORTANT
// ---------
// This is a DIAGNOSTIC endpoint.
//
// It DOES NOT:
// - change WR SAGE
// - change Role methodology
// - change Production methodology
// - change Matchup methodology
// - change confidence
// - optimize weights
// - create final START / FLEX / SIT thresholds
//
// FIRST-PASS RELIABILITY MEASURES
// -------------------------------
//
// FLOOR / BUST
//   < 5 PPR
//   < 10 PPR
//
// USABLE OUTCOMES
//   >= 10 PPR
//   >= 12 PPR
//   >= 15 PPR
//
// CEILING
//   >= 20 PPR
//   >= 25 PPR
//
// ROLE BANDS
// ----------
//
//   85+
//   75-84.9
//   65-74.9
//   55-64.9
//   45-54.9
//   35-44.9
//   Below 35
//
// ═══════════════════════════════════════════════════════════════════════

const BACKTEST_FUNCTION =
  "weekly-sage-wr-backtest";

const DEFAULT_SEASON_TYPE =
  "reg";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

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

function median(
  values
) {
  const clean =
    values
      .filter(
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
      )
      .map(
        Number
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

  const midpoint =
    Math.floor(
      clean.length /
      2
    );

  if (
    clean.length %
      2 ===
    0
  ) {
    return (
      clean[
        midpoint -
        1
      ] +
      clean[
        midpoint
      ]
    ) /
    2;
  }

  return clean[
    midpoint
  ];
}

function percentage(
  numerator,
  denominator
) {
  if (
    !denominator
  ) {
    return null;
  }

  return round(
    (
      numerator /
      denominator
    ) *
    100,
    1
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
      "Unknown backtest retrieval failure."
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

function roleBandDefinitions() {
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

function roleScore(
  observation
) {
  return nullableNum(
    observation &&
    observation.components &&
    observation.components.role
  );
}

function sageScore(
  observation
) {
  return nullableNum(
    observation &&
    observation.sageScore
  );
}

function actualPPR(
  observation
) {
  return nullableNum(
    observation &&
    observation.actual &&
    observation.actual.ppr
  );
}

function countWhere(
  values,
  predicate
) {
  return values.filter(
    predicate
  ).length;
}

function analyzeBand(
  observations,
  definition
) {
  const rows =
    observations.filter(
      function (
        observation
      ) {
        const role =
          roleScore(
            observation
          );

        return (
          role !==
            null &&
          role >=
            definition.min &&
          role <=
            definition.max
        );
      }
    );

  const pprValues =
    rows
      .map(
        actualPPR
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

  const roleValues =
    rows
      .map(
        roleScore
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

  const sageValues =
    rows
      .map(
        sageScore
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

  const count =
    pprValues.length;

  if (
    count ===
    0
  ) {
    return {
      key:
        definition.key,

      label:
        definition.label,

      count:
        0,

      averageRoleScore:
        null,

      averageSageScore:
        null,

      actualPPR: {
        average:
          null,

        median:
          null
      },

      reliability: {
        below5:
          null,

        below10:
          null,

        atLeast10:
          null,

        atLeast12:
          null,

        atLeast15:
          null,

        atLeast20:
          null,

        atLeast25:
          null
      },

      reliabilityScore:
        null
    };
  }

  const below5 =
    countWhere(
      pprValues,
      function (
        value
      ) {
        return (
          value <
          5
        );
      }
    );

  const below10 =
    countWhere(
      pprValues,
      function (
        value
      ) {
        return (
          value <
          10
        );
      }
    );

  const atLeast10 =
    countWhere(
      pprValues,
      function (
        value
      ) {
        return (
          value >=
          10
        );
      }
    );

  const atLeast12 =
    countWhere(
      pprValues,
      function (
        value
      ) {
        return (
          value >=
          12
        );
      }
    );

  const atLeast15 =
    countWhere(
      pprValues,
      function (
        value
      ) {
        return (
          value >=
          15
        );
      }
    );

  const atLeast20 =
    countWhere(
      pprValues,
      function (
        value
      ) {
        return (
          value >=
          20
        );
      }
    );

  const atLeast25 =
    countWhere(
      pprValues,
      function (
        value
      ) {
        return (
          value >=
          25
        );
      }
    );

  /*
    FIRST-PASS RELIABILITY SCORE

    This is NOT part of SAGE.

    It is a diagnostic 0-100 summary of how often this Role band
    produces a usable PPR outcome.

    50% weight:
      >= 10 PPR

    30% weight:
      >= 12 PPR

    20% weight:
      avoids < 5 PPR

    The diagnostic is intentionally floor-oriented.

    It must NOT be used as a recommendation score until
    multi-week validation demonstrates that it is useful.
  */
  const pctAtLeast10 =
    percentage(
      atLeast10,
      count
    );

  const pctAtLeast12 =
    percentage(
      atLeast12,
      count
    );

  const pctAvoidBelow5 =
    percentage(
      count -
      below5,
      count
    );

  const reliabilityScore =
    round(
      (
        pctAtLeast10 *
        0.50
      ) +
      (
        pctAtLeast12 *
        0.30
      ) +
      (
        pctAvoidBelow5 *
        0.20
      ),
      1
    );

  return {
    key:
      definition.key,

    label:
      definition.label,

    count,

    averageRoleScore:
      round(
        average(
          roleValues
        ),
        1
      ),

    averageSageScore:
      round(
        average(
          sageValues
        ),
        1
      ),

    actualPPR: {
      average:
        round(
          average(
            pprValues
          ),
          2
        ),

      median:
        round(
          median(
            pprValues
          ),
          2
        )
    },

    reliability: {
      below5: {
        count:
          below5,

        percent:
          percentage(
            below5,
            count
          )
      },

      below10: {
        count:
          below10,

        percent:
          percentage(
            below10,
            count
          )
      },

      atLeast10: {
        count:
          atLeast10,

        percent:
          pctAtLeast10
      },

      atLeast12: {
        count:
          atLeast12,

        percent:
          pctAtLeast12
      },

      atLeast15: {
        count:
          atLeast15,

        percent:
          percentage(
            atLeast15,
            count
          )
      },

      atLeast20: {
        count:
          atLeast20,

        percent:
          percentage(
            atLeast20,
            count
          )
      },

      atLeast25: {
        count:
          atLeast25,

        percent:
          percentage(
            atLeast25,
            count
          )
      }
    },

    reliabilityScore
  };
}

function monotonicComparison(
  bands,
  selector,
  direction
) {
  const populated =
    bands.filter(
      function (
        band
      ) {
        return (
          band.count >
          0 &&
          nullableNum(
            selector(
              band
            )
          ) !==
          null
        );
      }
    );

  if (
    populated.length <
    2
  ) {
    return {
      comparisons:
        0,

      aligned:
        0,

      rate:
        null
    };
  }

  let comparisons =
    0;

  let aligned =
    0;

  for (
    let i =
      0;
    i <
      populated.length -
        1;
    i +=
      1
  ) {
    const higherRole =
      nullableNum(
        selector(
          populated[
            i
          ]
        )
      );

    const lowerRole =
      nullableNum(
        selector(
          populated[
            i +
            1
          ]
        )
      );

    if (
      higherRole ===
        null ||
      lowerRole ===
        null
    ) {
      continue;
    }

    comparisons +=
      1;

    if (
      direction ===
      "higher"
    ) {
      if (
        higherRole >=
        lowerRole
      ) {
        aligned +=
          1;
      }
    } else {
      if (
        higherRole <=
        lowerRole
      ) {
        aligned +=
          1;
      }
    }
  }

  return {
    comparisons,

    aligned,

    rate:
      comparisons >
        0
        ? round(
            aligned /
            comparisons,
            3
          )
        : null,

    percent:
      comparisons >
        0
        ? round(
            (
              aligned /
              comparisons
            ) *
            100,
            1
          )
        : null
  };
}

function buildReliabilityTest(
  bands
) {
  return {
    averagePPRDeclinesWithRole:
      monotonicComparison(
        bands,

        function (
          band
        ) {
          return (
            band.actualPPR
              .average
          );
        },

        "higher"
      ),

    medianPPRDeclinesWithRole:
      monotonicComparison(
        bands,

        function (
          band
        ) {
          return (
            band.actualPPR
              .median
          );
        },

        "higher"
      ),

    tenPlusRateDeclinesWithRole:
      monotonicComparison(
        bands,

        function (
          band
        ) {
          return (
            band.reliability
              .atLeast10
              .percent
          );
        },

        "higher"
      ),

    twelvePlusRateDeclinesWithRole:
      monotonicComparison(
        bands,

        function (
          band
        ) {
          return (
            band.reliability
              .atLeast12
              .percent
          );
        },

        "higher"
      ),

    fifteenPlusRateDeclinesWithRole:
      monotonicComparison(
        bands,

        function (
          band
        ) {
          return (
            band.reliability
              .atLeast15
              .percent
          );
        },

        "higher"
      ),

    bustRateRisesAsRoleDeclines:
      monotonicComparison(
        bands,

        function (
          band
        ) {
          return (
            band.reliability
              .below10
              .percent
          );
        },

        "lower"
      ),

    diagnosticReliabilityScoreDeclinesWithRole:
      monotonicComparison(
        bands,

        function (
          band
        ) {
          return (
            band.reliabilityScore
          );
        },

        "higher"
      )
  };
}

function sampleWarning(
  bands
) {
  const smallBands =
    bands
      .filter(
        function (
          band
        ) {
          return (
            band.count >
              0 &&
            band.count <
              10
          );
        }
      )
      .map(
        function (
          band
        ) {
          return {
            band:
              band.label,

            count:
              band.count
          };
        }
      );

  return {
    minimumPreferredBandSample:
      10,

    bandsBelowPreferredSample:
      smallBands,

    caution:
      smallBands.length >
        0
        ? "One or more Role bands contain fewer than 10 player-week observations. Treat band-level percentages as directional until a broader multi-week sample is available."
        : null
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

    const week =
      Number(
        query.week
      );

    const seasonType =
      String(
        query.seasonType ||
        DEFAULT_SEASON_TYPE
      );

    /*
      Single-week only by design.

      This avoids reproducing the heavy nested multi-week
      validation fan-out that caused 504s.
    */
    if (
      !Number.isInteger(
        week
      ) ||
      week <
        2 ||
      week >
        17
    ) {
      return jsonResponse(
        400,
        {
          error:
            "week must be an integer from 2 through 17."
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

      /*
        Request exactly ONE WR backtest week.
      */
      const url =
        buildUrl({
          baseUrl,

          functionName:
            BACKTEST_FUNCTION,

          params: {
            season,

            startWeek:
              String(
                week
              ),

            endWeek:
              String(
                week
              ),

            seasonType,

            concurrency:
              "1"
          }
        });

      const result =
        await fetchJsonWithStatus(
          url
        );

      if (
        !result.ok
      ) {
        return jsonResponse(
          502,
          {
            error:
              "Could not retrieve Weekly SAGE WR backtest evidence.",

            detail:
              errorMessage(
                result
              ),

            sourceStatus:
              result.status
          }
        );
      }

      const backtest =
        result.data;

      if (
        !backtest ||
        backtest.evidenceType !==
          "weekly-sage-wr-backtest"
      ) {
        return jsonResponse(
          502,
          {
            error:
              "Unexpected Weekly SAGE WR backtest schema."
          }
        );
      }

      const observations =
        Array.isArray(
          backtest.observations
        )
          ? backtest.observations
          : [];

      const sourceReady =
        Boolean(
          backtest.nextStep &&
          backtest.nextStep.ready ===
            true
        );

      if (
        observations.length ===
        0
      ) {
        return jsonResponse(
          200,
          {
            evidenceType:
              "weekly-sage-wr-role-reliability",

            schemaVersion:
              1,

            generatedAt:
              new Date()
                .toISOString(),

            season,

            week,

            seasonType,

            population: {
              cleanPlayerWeekObservations:
                0
            },

            roleBands:
              [],

            reliabilityTest:
              null,

            nextStep: {
              ready:
                false,

              reason:
                "No clean WR player-week observations were returned by the source backtest."
            },

            sourceDiagnostics:
              backtest.diagnostics ||
              null
          },

          CACHE_CONTROL
        );
      }

      const roleBands =
        roleBandDefinitions()
          .map(
            function (
              definition
            ) {
              return analyzeBand(
                observations,
                definition
              );
            }
          );

      const reliabilityTest =
        buildReliabilityTest(
          roleBands
        );

      const sampleSize =
        sampleWarning(
          roleBands
        );

      return jsonResponse(
        200,
        {
          evidenceType:
            "weekly-sage-wr-role-reliability",

          schemaVersion:
            1,

          generatedAt:
            new Date()
              .toISOString(),

          season,

          week,

          seasonType,

          methodology: {
            modelVersion:
              "wr-sage-v1",

            analysisVersion:
              "wr-role-reliability-v1",

            hypothesis:
              "Higher pre-game WR Role should correspond to a more dependable fantasy floor and a greater probability of producing a usable weekly PPR result.",

            roleBandBasis:
              "Confidence-adjusted pre-game WR Role Score.",

            outcome:
              "Actual target-week PPR fantasy points.",

            floorMeasures: [
              "Below 5 PPR",
              "Below 10 PPR"
            ],

            usableOutcomeMeasures: [
              "At least 10 PPR",
              "At least 12 PPR",
              "At least 15 PPR"
            ],

            ceilingMeasures: [
              "At least 20 PPR",
              "At least 25 PPR"
            ],

            diagnosticReliabilityScore:
              "50% >=10 PPR rate + 30% >=12 PPR rate + 20% avoidance of <5 PPR. This score is diagnostic only and is not part of Weekly SAGE.",

            leakageProtection:
              "Role comes from frozen pre-game evidence. Actual target-week PPR is used only for retrospective reliability analysis.",

            important:
              "This analysis measures reliability, not raw statistical variance. A low-role WR can have low variance simply because he consistently scores few fantasy points."
          },

          population: {
            cleanPlayerWeekObservations:
              observations.length,

            sourceWeeksRetrieved:
              backtest.population &&
              backtest.population
                .weeksRetrieved !==
                undefined
                ? backtest.population
                    .weeksRetrieved
                : null,

            sourceRetrievalFailures:
              backtest.population &&
              backtest.population
                .retrievalFailures !==
                undefined
                ? backtest.population
                    .retrievalFailures
                : null
          },

          roleBands,

          reliabilityTest,

          sampleSize,

          sourceDiagnostics:
            backtest.diagnostics ||
            null,

          recommendation:
            null,

          nextStep: {
            ready:
              sourceReady,

            reason:
              sourceReady
                ? "Compare this same Role-reliability analysis across additional weeks. If higher Role repeatedly produces stronger floor and usable-outcome rates, aggregate the compact weekly reliability summaries before deciding whether Role should influence WR recommendation confidence."
                : "The underlying WR backtest is not clean enough to interpret Role reliability."
          },

          architecture: {
            modelVersion:
              "wr-sage-v1",

            analysisVersion:
              "wr-role-reliability-v1",

            source:
              BACKTEST_FUNCTION,

            singleWeekByDesign:
              true,

            changesSageWeights:
              false,

            changesRecommendations:
              false,

            directTank01Calls:
              0
          },

          provenance: {
            historicalObservations:
              BACKTEST_FUNCTION,

            role:
              "weekly-sage-wr-confidence",

            sage:
              "weekly-sage-wr-final-score",

            outcomes:
              "weekly-sage-player-season"
          }
        },

        CACHE_CONTROL
      );
    } catch (
      error
    ) {
      console.error(
        "weekly-sage-wr-role-reliability failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not build Weekly SAGE WR Role reliability analysis.",

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
