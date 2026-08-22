// netlify/functions/weekly-sage-wr-role-volatility.js
//
// WEEKLY SAGE — WR ROLE VOLATILITY ANALYSIS
//
// PURPOSE
// -------
// Test whether WR weekly fantasy outcomes become less predictable
// as Role Score declines.
//
// HYPOTHESIS
// ----------
// High-role WRs receive enough repeatable opportunity that weekly
// fantasy outcomes should be more stable.
//
// Lower-role WRs have fewer opportunities, making individual events
// such as missed throws, touchdowns, explosive plays, penalties,
// coverage decisions, and game flow more influential.
//
// THIS ENDPOINT DOES NOT
// ----------------------
// - change WR SAGE weights
// - change WR component methodology
// - change confidence
// - create recommendation thresholds
// - feed outcomes back into SAGE
//
// SOURCE
// ------
// weekly-sage-wr-backtest
//
// IMPORTANT
// ---------
// This is a diagnostic endpoint only.
//
// It consumes clean historical player-week observations produced by
// the WR backtest and groups them by PRE-GAME adjusted Role Score.
//
// ═══════════════════════════════════════════════════════════════════════

const BACKTEST_FUNCTION =
  "weekly-sage-wr-backtest";

const DEFAULT_SEASON_TYPE =
  "reg";

const DEFAULT_START_WEEK =
  5;

const DEFAULT_END_WEEK =
  17;

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

function nullableNum(value) {
  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

function integerOrNull(value) {
  const n =
    Number(value);

  return Number.isInteger(n)
    ? n
    : null;
}

function round(value, digits = 3) {
  const n =
    Number(value);

  if (!Number.isFinite(n)) {
    return null;
  }

  const factor =
    Math.pow(10, digits);

  return (
    Math.round(
      (n + Number.EPSILON) *
      factor
    ) /
    factor
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

function getBaseUrl(event) {
  const headers =
    event.headers ||
    {};

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

async function fetchJsonWithStatus(url) {
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
      await response.json();
  } catch (error) {
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

function errorMessage(result) {
  if (!result) {
    return "Unknown backtest retrieval failure.";
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

function average(values) {
  const clean =
    values
      .map(nullableNum)
      .filter(
        function (value) {
          return value !== null;
        }
      );

  if (clean.length === 0) {
    return null;
  }

  return (
    clean.reduce(
      function (sum, value) {
        return sum + value;
      },
      0
    ) /
    clean.length
  );
}

function standardDeviation(values) {
  const clean =
    values
      .map(nullableNum)
      .filter(
        function (value) {
          return value !== null;
        }
      );

  if (clean.length < 2) {
    return null;
  }

  const mean =
    average(clean);

  const variance =
    clean.reduce(
      function (sum, value) {
        return (
          sum +
          Math.pow(
            value - mean,
            2
          )
        );
      },
      0
    ) /
    (clean.length - 1);

  return Math.sqrt(
    variance
  );
}

function median(values) {
  const clean =
    values
      .map(nullableNum)
      .filter(
        function (value) {
          return value !== null;
        }
      )
      .sort(
        function (a, b) {
          return a - b;
        }
      );

  if (clean.length === 0) {
    return null;
  }

  const midpoint =
    Math.floor(
      clean.length / 2
    );

  if (
    clean.length % 2 ===
    0
  ) {
    return (
      (
        clean[midpoint - 1] +
        clean[midpoint]
      ) /
      2
    );
  }

  return clean[midpoint];
}

function percentile(values, p) {
  const clean =
    values
      .map(nullableNum)
      .filter(
        function (value) {
          return value !== null;
        }
      )
      .sort(
        function (a, b) {
          return a - b;
        }
      );

  if (clean.length === 0) {
    return null;
  }

  if (clean.length === 1) {
    return clean[0];
  }

  const position =
    (clean.length - 1) *
    p;

  const lower =
    Math.floor(position);

  const upper =
    Math.ceil(position);

  if (lower === upper) {
    return clean[lower];
  }

  const weight =
    position - lower;

  return (
    clean[lower] *
      (1 - weight) +
    clean[upper] *
      weight
  );
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

function getRoleScore(observation) {
  return nullableNum(
    observation &&
    observation.components &&
    observation.components.role
  );
}

function getSageScore(observation) {
  return nullableNum(
    observation &&
    observation.sageScore
  );
}

function getActualPPR(observation) {
  return nullableNum(
    observation &&
    observation.actual &&
    observation.actual.ppr
  );
}

/*
  We cannot directly compare a 0-100 SAGE score with raw PPR points
  as if the units were identical.

  Therefore the primary volatility analysis uses:

    actual PPR distribution
    actual PPR standard deviation
    actual PPR interquartile range
    actual PPR downside / upside rates

  We also calculate within-band deviation from the band's mean actual
  PPR output.

  That gives us a unit-consistent measure of weekly volatility.

  SAGE-vs-actual residual analysis is included separately using a
  regression calibration fitted across the full observation sample.
*/

function fitPprRegression(observations) {
  const pairs =
    [];

  for (const observation of observations) {
    const sage =
      getSageScore(
        observation
      );

    const actual =
      getActualPPR(
        observation
      );

    if (
      sage === null ||
      actual === null
    ) {
      continue;
    }

    pairs.push({
      x:
        sage,

      y:
        actual
    });
  }

  if (pairs.length < 2) {
    return null;
  }

  const meanX =
    average(
      pairs.map(
        function (pair) {
          return pair.x;
        }
      )
    );

  const meanY =
    average(
      pairs.map(
        function (pair) {
          return pair.y;
        }
      )
    );

  let numerator =
    0;

  let denominator =
    0;

  for (const pair of pairs) {
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

  if (denominator === 0) {
    return null;
  }

  const slope =
    numerator /
    denominator;

  const intercept =
    meanY -
    slope *
    meanX;

  return {
    observations:
      pairs.length,

    slope,

    intercept
  };
}

function predictedPPR(
  observation,
  regression
) {
  if (!regression) {
    return null;
  }

  const sage =
    getSageScore(
      observation
    );

  if (sage === null) {
    return null;
  }

  return (
    regression.intercept +
    regression.slope *
    sage
  );
}

function percentage(
  numerator,
  denominator
) {
  if (!denominator) {
    return null;
  }

  return (
    numerator /
    denominator *
    100
  );
}

function analyzeRoleBand(
  observations,
  definition,
  regression
) {
  const rows =
    observations.filter(
      function (observation) {
        const role =
          getRoleScore(
            observation
          );

        return (
          role !== null &&
          role >= definition.min &&
          role <= definition.max
        );
      }
    );

  const actualPPR =
    rows
      .map(getActualPPR)
      .filter(
        function (value) {
          return value !== null;
        }
      );

  const sageScores =
    rows
      .map(getSageScore)
      .filter(
        function (value) {
          return value !== null;
        }
      );

  const roleScores =
    rows
      .map(getRoleScore)
      .filter(
        function (value) {
          return value !== null;
        }
      );

  if (rows.length === 0) {
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
          null,

        standardDeviation:
          null,

        p25:
          null,

        p75:
          null,

        interquartileRange:
          null
      },

      withinBandVolatility: {
        meanAbsoluteDeviationFromBandMean:
          null,

        rmseFromBandMean:
          null
      },

      calibratedForecastError: {
        mae:
          null,

        rmse:
          null,

        standardDeviation:
          null,

        within5PPR:
          null
      },

      outcomeRates: {
        below5PPR:
          null,

        below10PPR:
          null,

        atLeast15PPR:
          null,

        atLeast20PPR:
          null,

        atLeast25PPR:
          null
      }
    };
  }

  const meanActual =
    average(
      actualPPR
    );

  const deviationsFromMean =
    actualPPR.map(
      function (value) {
        return (
          value -
          meanActual
        );
      }
    );

  const absoluteDeviations =
    deviationsFromMean.map(
      function (value) {
        return Math.abs(
          value
        );
      }
    );

  const squaredDeviations =
    deviationsFromMean.map(
      function (value) {
        return (
          value *
          value
        );
      }
    );

  const forecastErrors =
    [];

  for (const observation of rows) {
    const actual =
      getActualPPR(
        observation
      );

    const predicted =
      predictedPPR(
        observation,
        regression
      );

    if (
      actual === null ||
      predicted === null
    ) {
      continue;
    }

    forecastErrors.push(
      actual -
      predicted
    );
  }

  const absoluteForecastErrors =
    forecastErrors.map(
      function (value) {
        return Math.abs(
          value
        );
      }
    );

  const squaredForecastErrors =
    forecastErrors.map(
      function (value) {
        return (
          value *
          value
        );
      }
    );

  const within5Count =
    absoluteForecastErrors.filter(
      function (value) {
        return value <= 5;
      }
    ).length;

  const below5Count =
    actualPPR.filter(
      function (value) {
        return value < 5;
      }
    ).length;

  const below10Count =
    actualPPR.filter(
      function (value) {
        return value < 10;
      }
    ).length;

  const atLeast15Count =
    actualPPR.filter(
      function (value) {
        return value >= 15;
      }
    ).length;

  const atLeast20Count =
    actualPPR.filter(
      function (value) {
        return value >= 20;
      }
    ).length;

  const atLeast25Count =
    actualPPR.filter(
      function (value) {
        return value >= 25;
      }
    ).length;

  const p25 =
    percentile(
      actualPPR,
      0.25
    );

  const p75 =
    percentile(
      actualPPR,
      0.75
    );

  return {
    key:
      definition.key,

    label:
      definition.label,

    count:
      rows.length,

    averageRoleScore:
      round(
        average(
          roleScores
        ),
        1
      ),

    averageSageScore:
      round(
        average(
          sageScores
        ),
        1
      ),

    actualPPR: {
      average:
        round(
          meanActual,
          2
        ),

      median:
        round(
          median(
            actualPPR
          ),
          2
        ),

      standardDeviation:
        round(
          standardDeviation(
            actualPPR
          ),
          2
        ),

      p25:
        round(
          p25,
          2
        ),

      p75:
        round(
          p75,
          2
        ),

      interquartileRange:
        (
          p25 !== null &&
          p75 !== null
        )
          ? round(
              p75 - p25,
              2
            )
          : null
    },

    withinBandVolatility: {
      meanAbsoluteDeviationFromBandMean:
        round(
          average(
            absoluteDeviations
          ),
          2
        ),

      rmseFromBandMean:
        round(
          Math.sqrt(
            average(
              squaredDeviations
            )
          ),
          2
        )
    },

    calibratedForecastError: {
      mae:
        absoluteForecastErrors.length
          ? round(
              average(
                absoluteForecastErrors
              ),
              2
            )
          : null,

      rmse:
        squaredForecastErrors.length
          ? round(
              Math.sqrt(
                average(
                  squaredForecastErrors
                )
              ),
              2
            )
          : null,

      standardDeviation:
        forecastErrors.length >
          1
          ? round(
              standardDeviation(
                forecastErrors
              ),
              2
            )
          : null,

      within5PPR:
        forecastErrors.length
          ? round(
              percentage(
                within5Count,
                forecastErrors.length
              ),
              1
            )
          : null
    },

    outcomeRates: {
      below5PPR:
        round(
          percentage(
            below5Count,
            actualPPR.length
          ),
          1
        ),

      below10PPR:
        round(
          percentage(
            below10Count,
            actualPPR.length
          ),
          1
        ),

      atLeast15PPR:
        round(
          percentage(
            atLeast15Count,
            actualPPR.length
          ),
          1
        ),

      atLeast20PPR:
        round(
          percentage(
            atLeast20Count,
            actualPPR.length
          ),
          1
        ),

      atLeast25PPR:
        round(
          percentage(
            atLeast25Count,
            actualPPR.length
          ),
          1
        )
    }
  };
}

function analyzeTrend(
  roleBands
) {
  const populated =
    roleBands.filter(
      function (band) {
        return (
          band.count >
          0
        );
      }
    );

  if (populated.length < 2) {
    return {
      ready:
        false,

      reason:
        "At least two populated Role bands are required."
    };
  }

  const highest =
    populated[0];

  const lowest =
    populated[
      populated.length -
      1
    ];

  return {
    ready:
      true,

    highestPopulatedRoleBand:
      highest.label,

    lowestPopulatedRoleBand:
      lowest.label,

    highRoleActualPPRStandardDeviation:
      highest.actualPPR
        .standardDeviation,

    lowRoleActualPPRStandardDeviation:
      lowest.actualPPR
        .standardDeviation,

    highRoleForecastMAE:
      highest.calibratedForecastError
        .mae,

    lowRoleForecastMAE:
      lowest.calibratedForecastError
        .mae,

    highRoleWithin5PPRPct:
      highest.calibratedForecastError
        .within5PPR,

    lowRoleWithin5PPRPct:
      lowest.calibratedForecastError
        .within5PPR,

    interpretation:
      "Do not infer the hypothesis from this summary alone. Review the progression across all populated Role bands. Evidence is strongest if volatility and forecast error generally increase as Role declines rather than being driven by one extreme band."
  };
}

exports.handler =
  async function (event) {
    if (
      event.httpMethod &&
      event.httpMethod !== "GET"
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

    const startWeek =
      requestedStartWeek ||
      DEFAULT_START_WEEK;

    const endWeek =
      requestedEndWeek ||
      DEFAULT_END_WEEK;

    if (
      !Number.isInteger(startWeek) ||
      !Number.isInteger(endWeek) ||
      startWeek < 2 ||
      endWeek > 17 ||
      startWeek > endWeek
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

      const backtestUrl =
        buildUrl({
          baseUrl,

          functionName:
            BACKTEST_FUNCTION,

          params: {
            season,

            startWeek:
              String(
                startWeek
              ),

            endWeek:
              String(
                endWeek
              ),

            seasonType,

            concurrency:
              "1"
          }
        });

      const result =
        await fetchJsonWithStatus(
          backtestUrl
        );

      if (!result.ok) {
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

      if (
        observations.length ===
        0
      ) {
        return jsonResponse(
          200,
          {
            evidenceType:
              "weekly-sage-wr-role-volatility",

            schemaVersion:
              1,

            generatedAt:
              new Date()
                .toISOString(),

            season,

            seasonType,

            requestedWindow: {
              startWeek,
              endWeek
            },

            population: {
              cleanPlayerWeekObservations:
                0
            },

            roleBands:
              [],

            hypothesisTest: {
              ready:
                false,

              reason:
                "No clean WR player-week observations were returned by the source backtest."
            },

            sourceDiagnostics:
              backtest.diagnostics ||
              null,

            nextStep: {
              ready:
                false,

              reason:
                "Resolve WR backtest retrieval failures before interpreting Role volatility."
            }
          },

          CACHE_CONTROL
        );
      }

      /*
        Fit one PPR calibration across the entire clean sample.

        This lets us measure residual forecast error in PPR units
        without pretending that SAGE's 0-100 scale is itself a
        fantasy-point projection.
      */
      const regression =
        fitPprRegression(
          observations
        );

      const roleBands =
        roleBandDefinitions()
          .map(
            function (definition) {
              return analyzeRoleBand(
                observations,
                definition,
                regression
              );
            }
          );

      const hypothesisTest =
        analyzeTrend(
          roleBands
        );

      const sourceReady =
        Boolean(
          backtest.nextStep &&
          backtest.nextStep.ready === true
        );

      return jsonResponse(
        200,
        {
          evidenceType:
            "weekly-sage-wr-role-volatility",

          schemaVersion:
            1,

          generatedAt:
            new Date()
              .toISOString(),

          season,

          seasonType,

          requestedWindow: {
            startWeek,
            endWeek
          },

          methodology: {
            modelVersion:
              "wr-sage-v1",

            analysisVersion:
              "wr-role-volatility-v1",

            hypothesis:
              "Weekly WR fantasy outcomes become less predictable as pre-game Role Score declines.",

            roleBandBasis:
              "Confidence-adjusted pre-game WR Role Score from the historical SAGE observation.",

            primaryOutcome:
              "Actual target-week PPR fantasy points.",

            volatilityMeasures: [
              "Actual PPR standard deviation",
              "Actual PPR interquartile range",
              "Mean absolute deviation from Role-band mean",
              "RMSE from Role-band mean"
            ],

            calibratedForecastError:
              "A single regression of actual PPR on pre-game SAGE Score is fitted across the full clean sample. Band-level residual error is then measured in PPR points.",

            outcomeRates: [
              "Below 5 PPR",
              "Below 10 PPR",
              "At least 15 PPR",
              "At least 20 PPR",
              "At least 25 PPR"
            ],

            leakageProtection:
              "All grouping variables come from frozen pre-game SAGE evidence. Actual target-week outcomes are used only for retrospective validation.",

            important:
              "This endpoint tests a volatility hypothesis. It does not alter WR SAGE methodology or assume the hypothesis is true."
          },

          population: {
            cleanPlayerWeekObservations:
              observations.length,

            sourceWeeksRequested:
              backtest.population &&
              backtest.population
                .weeksRequested !==
                undefined
                ? backtest.population
                    .weeksRequested
                : null,

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

          pprCalibration: regression
            ? {
                observations:
                  regression.observations,

                slope:
                  round(
                    regression.slope,
                    4
                  ),

                intercept:
                  round(
                    regression.intercept,
                    4
                  ),

                equation:
                  `expectedPPR = ${round(
                    regression.intercept,
                    4
                  )} + (${round(
                    regression.slope,
                    4
                  )} * SAGE)`
              }
            : null,

          roleBands,

          hypothesisTest,

          sourceDiagnostics:
            backtest.diagnostics ||
            null,

          nextStep: {
            ready:
              sourceReady &&
              hypothesisTest.ready,

            reason:
              sourceReady &&
              hypothesisTest.ready
                ? "Review whether actual PPR volatility and calibrated forecast error generally increase as WR Role declines. If the relationship persists across a broad multi-week sample, test whether Role should influence WR recommendation confidence separately from the final SAGE score."
                : "The Role-volatility analysis should not be interpreted until the underlying WR backtest is clean and multiple Role bands are populated."
          },

          architecture: {
            modelVersion:
              "wr-sage-v1",

            analysisVersion:
              "wr-role-volatility-v1",

            source:
              BACKTEST_FUNCTION,

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
    } catch (error) {
      console.error(
        "weekly-sage-wr-role-volatility failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not build Weekly SAGE WR Role volatility analysis.",

          detail:
            error &&
            error.message
              ? error.message
              : String(error)
        }
      );
    }
  };
