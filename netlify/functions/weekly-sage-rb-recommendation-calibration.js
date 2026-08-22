// netlify/functions/weekly-sage-rb-recommendation-calibration.js
//
// WEEKLY SAGE — RB RECOMMENDATION CALIBRATION
//
// PURPOSE
// -------
// Analyze how deployed RB SAGE scores translate into actual
// fantasy-football outcomes.
//
// This endpoint consumes:
//
//   weekly-sage-rb-backtest
//
// It DOES NOT:
// - recalculate SAGE
// - call Tank01 directly
// - modify SAGE weights
// - activate START / FLEX / SIT recommendations
// - assume the current SAGE population is the full NFL RB universe
//
// IMPORTANT
// ---------
// The existing RB backtest contains validated SAGE player-weeks,
// not a complete league-wide RB fantasy leaderboard.
//
// Therefore this endpoint DOES NOT label outcomes as:
//
//   RB1
//   RB2
//   RB3
//
// until we have full weekly league-wide RB outcome populations.
//
// Instead, it measures:
//
//   - actual fantasy-point distributions by SAGE range
//   - median outcomes
//   - percentile outcomes
//   - probability of clearing useful fantasy-point levels
//   - probability of poor outcomes
//   - consistency / downside risk
//
// This provides evidence for future START / FLEX / SIT calibration
// without inventing recommendation thresholds.
//
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_SEASON_TYPE =
  "reg";

const DEFAULT_START_WEEK =
  5;

const DEFAULT_END_WEEK =
  17;

const BACKTEST_FUNCTION =
  "weekly-sage-rb-backtest";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

/*
  Diagnostic SAGE ranges.

  These are NOT recommendation thresholds.

  They are deliberately narrower than the current consumer labels
  so we can inspect where outcome behavior actually changes.
*/
const SAGE_BANDS = [
  {
    key: "85_plus",
    label: "85+",
    min: 85,
    max: Infinity
  },
  {
    key: "75_to_84_9",
    label: "75-84.9",
    min: 75,
    max: 84.999999
  },
  {
    key: "65_to_74_9",
    label: "65-74.9",
    min: 65,
    max: 74.999999
  },
  {
    key: "55_to_64_9",
    label: "55-64.9",
    min: 55,
    max: 64.999999
  },
  {
    key: "45_to_54_9",
    label: "45-54.9",
    min: 45,
    max: 54.999999
  },
  {
    key: "35_to_44_9",
    label: "35-44.9",
    min: 35,
    max: 44.999999
  },
  {
    key: "below_35",
    label: "Below 35",
    min: -Infinity,
    max: 34.999999
  }
];

/*
  Diagnostic fantasy-point outcome levels.

  These are NOT START / FLEX / SIT definitions.

  They simply let us ask:

    How often does a SAGE range produce:
      10+ points?
      15+ points?
      20+ points?

  across Standard / Half-PPR / PPR.

  We also track poor outcomes below 5 and below 8.
*/
const OUTCOME_LEVELS = [
  {
    key: "gte_20",
    label: "20+",
    comparator: "gte",
    value: 20
  },
  {
    key: "gte_15",
    label: "15+",
    comparator: "gte",
    value: 15
  },
  {
    key: "gte_12",
    label: "12+",
    comparator: "gte",
    value: 12
  },
  {
    key: "gte_10",
    label: "10+",
    comparator: "gte",
    value: 10
  },
  {
    key: "gte_8",
    label: "8+",
    comparator: "gte",
    value: 8
  },
  {
    key: "lt_8",
    label: "Below 8",
    comparator: "lt",
    value: 8
  },
  {
    key: "lt_5",
    label: "Below 5",
    comparator: "lt",
    value: 5
  }
];

function nullableNum(value) {
  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

function round(
  value,
  digits = 2
) {
  const n =
    Number(value);

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

async function fetchJsonWithStatus(url) {
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
    return (
      "Unknown backtest retrieval failure."
    );
  }

  const data =
    result.data || {};

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

async function fetchBacktest({
  baseUrl,
  season,
  startWeek,
  endWeek,
  seasonType
}) {
  const url =
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

        seasonType
      }
    });

  const result =
    await fetchJsonWithStatus(
      url
    );

  if (!result.ok) {
    throw new Error(
      errorMessage(
        result
      )
    );
  }

  if (
    !result.data ||
    result.data.evidenceType !==
      "weekly-sage-rb-backtest"
  ) {
    throw new Error(
      "Unexpected Weekly SAGE RB backtest schema."
    );
  }

  return result.data;
}

function mean(values) {
  const clean =
    values
      .map(
        nullableNum
      )
      .filter(
        value =>
          value !== null
      );

  if (
    clean.length === 0
  ) {
    return null;
  }

  return round(
    clean.reduce(
      (
        sum,
        value
      ) =>
        sum + value,
      0
    ) /
    clean.length,
    2
  );
}

function percentile(
  values,
  percentileValue
) {
  const clean =
    values
      .map(
        nullableNum
      )
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
    return null;
  }

  if (
    clean.length === 1
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
    percentileValue;

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

  const weight =
    position -
    lowerIndex;

  const value =
    clean[
      lowerIndex
    ] *
    (
      1 -
      weight
    ) +
    clean[
      upperIndex
    ] *
    weight;

  return round(
    value,
    2
  );
}

function standardDeviation(values) {
  const clean =
    values
      .map(
        nullableNum
      )
      .filter(
        value =>
          value !== null
      );

  if (
    clean.length <
    2
  ) {
    return null;
  }

  const avg =
    clean.reduce(
      (
        sum,
        value
      ) =>
        sum + value,
      0
    ) /
    clean.length;

  const variance =
    clean.reduce(
      (
        sum,
        value
      ) =>
        sum +
        Math.pow(
          value -
          avg,
          2
        ),
      0
    ) /
    clean.length;

  return round(
    Math.sqrt(
      variance
    ),
    2
  );
}

function rate(
  values,
  comparator,
  threshold
) {
  const clean =
    values
      .map(
        nullableNum
      )
      .filter(
        value =>
          value !== null
      );

  if (
    clean.length ===
    0
  ) {
    return null;
  }

  const hits =
    clean.filter(
      value => {
        if (
          comparator ===
          "gte"
        ) {
          return (
            value >=
            threshold
          );
        }

        if (
          comparator ===
          "lt"
        ) {
          return (
            value <
            threshold
          );
        }

        return false;
      }
    ).length;

  return {
    hits,

    total:
      clean.length,

    rate:
      round(
        hits /
        clean.length,
        3
      ),

    percent:
      round(
        (
          hits /
          clean.length
        ) *
        100,
        1
      )
  };
}

function valuesForScoring(
  observations,
  scoringKey
) {
  return observations
    .map(
      observation =>
        nullableNum(
          observation &&
          observation.actual &&
          observation.actual[
            scoringKey
          ]
        )
    )
    .filter(
      value =>
        value !== null
    );
}

function summarizeScoring(
  observations,
  scoringKey
) {
  const values =
    valuesForScoring(
      observations,
      scoringKey
    );

  const outcomeRates =
    {};

  for (
    const level of
    OUTCOME_LEVELS
  ) {
    outcomeRates[
      level.key
    ] =
      rate(
        values,
        level.comparator,
        level.value
      );
  }

  return {
    count:
      values.length,

    average:
      mean(
        values
      ),

    median:
      percentile(
        values,
        0.50
      ),

    distribution: {
      min:
        values.length
          ? round(
              Math.min(
                ...values
              ),
              2
            )
          : null,

      p10:
        percentile(
          values,
          0.10
        ),

      p25:
        percentile(
          values,
          0.25
        ),

      median:
        percentile(
          values,
          0.50
        ),

      p75:
        percentile(
          values,
          0.75
        ),

      p90:
        percentile(
          values,
          0.90
        ),

      max:
        values.length
          ? round(
              Math.max(
                ...values
              ),
              2
            )
          : null
    },

    volatility: {
      standardDeviation:
        standardDeviation(
          values
        )
    },

    outcomeRates
  };
}

function observationsInBand(
  observations,
  band
) {
  return observations.filter(
    observation => {
      const sageScore =
        nullableNum(
          observation &&
          observation.sageScore
        );

      return (
        sageScore !== null &&
        sageScore >=
          band.min &&
        sageScore <=
          band.max
      );
    }
  );
}

function summarizeBand(
  observations,
  band
) {
  const rows =
    observationsInBand(
      observations,
      band
    );

  const sageScores =
    rows
      .map(
        row =>
          nullableNum(
            row.sageScore
          )
      )
      .filter(
        value =>
          value !== null
      );

  return {
    key:
      band.key,

    label:
      band.label,

    playerWeeks:
      rows.length,

    sageScore: {
      average:
        mean(
          sageScores
        ),

      median:
        percentile(
          sageScores,
          0.50
        ),

      min:
        sageScores.length
          ? round(
              Math.min(
                ...sageScores
              ),
              1
            )
          : null,

      max:
        sageScores.length
          ? round(
              Math.max(
                ...sageScores
              ),
              1
            )
          : null
    },

    outcomes: {
      standard:
        summarizeScoring(
          rows,
          "standard"
        ),

      halfPPR:
        summarizeScoring(
          rows,
          "halfPPR"
        ),

      ppr:
        summarizeScoring(
          rows,
          "ppr"
        )
    }
  };
}

function buildScoreBands(
  observations
) {
  return SAGE_BANDS.map(
    band =>
      summarizeBand(
        observations,
        band
      )
  );
}

/*
  Analyze every integer SAGE threshold.

  Example:

    threshold = 70

  Compare actual outcomes for:

    SAGE >= 70
    SAGE < 70

  This helps identify where outcome separation begins to
  materially improve without automatically turning that
  point into a recommendation threshold.
*/
function thresholdAnalysis(
  observations,
  scoringKey
) {
  const results =
    [];

  for (
    let threshold = 30;
    threshold <= 85;
    threshold += 5
  ) {
    const above =
      observations.filter(
        observation => {
          const score =
            nullableNum(
              observation.sageScore
            );

          return (
            score !== null &&
            score >=
              threshold
          );
        }
      );

    const below =
      observations.filter(
        observation => {
          const score =
            nullableNum(
              observation.sageScore
            );

          return (
            score !== null &&
            score <
              threshold
          );
        }
      );

    const aboveValues =
      valuesForScoring(
        above,
        scoringKey
      );

    const belowValues =
      valuesForScoring(
        below,
        scoringKey
      );

    if (
      aboveValues.length ===
        0 ||
      belowValues.length ===
        0
    ) {
      continue;
    }

    const aboveAverage =
      mean(
        aboveValues
      );

    const belowAverage =
      mean(
        belowValues
      );

    const aboveMedian =
      percentile(
        aboveValues,
        0.50
      );

    const belowMedian =
      percentile(
        belowValues,
        0.50
      );

    results.push({
      threshold,

      above: {
        playerWeeks:
          aboveValues.length,

        average:
          aboveAverage,

        median:
          aboveMedian,

        gte10:
          rate(
            aboveValues,
            "gte",
            10
          ),

        gte15:
          rate(
            aboveValues,
            "gte",
            15
          ),

        gte20:
          rate(
            aboveValues,
            "gte",
            20
          ),

        below8:
          rate(
            aboveValues,
            "lt",
            8
          )
      },

      below: {
        playerWeeks:
          belowValues.length,

        average:
          belowAverage,

        median:
          belowMedian
      },

      separation: {
        averagePointDifference:
          (
            aboveAverage !==
              null &&
            belowAverage !==
              null
          )
            ? round(
                aboveAverage -
                belowAverage,
                2
              )
            : null,

        medianPointDifference:
          (
            aboveMedian !==
              null &&
            belowMedian !==
              null
          )
            ? round(
                aboveMedian -
                belowMedian,
                2
              )
            : null
      }
    });
  }

  return results;
}

function overallSummary(
  observations
) {
  return {
    standard:
      summarizeScoring(
        observations,
        "standard"
      ),

    halfPPR:
      summarizeScoring(
        observations,
        "halfPPR"
      ),

    ppr:
      summarizeScoring(
        observations,
        "ppr"
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
      event
        .queryStringParameters ||
      {};

    const season =
      String(
        query.season ||
        new Date()
          .getFullYear()
      );

    const startWeek =
      Number(
        query.startWeek ||
        DEFAULT_START_WEEK
      );

    const endWeek =
      Number(
        query.endWeek ||
        DEFAULT_END_WEEK
      );

    const seasonType =
      String(
        query.seasonType ||
        DEFAULT_SEASON_TYPE
      );

    if (
      !Number.isInteger(
        startWeek
      ) ||
      !Number.isInteger(
        endWeek
      ) ||
      startWeek < 2 ||
      endWeek > 17 ||
      startWeek >
        endWeek
    ) {
      return jsonResponse(
        400,
        {
          error:
            "startWeek and endWeek must define a valid range from Week 2 through Week 17."
        }
      );
    }

    try {
      const baseUrl =
        getBaseUrl(
          event
        );

      /*
        Consume the deployed SAGE backtest.

        No player evidence or matchup evidence is rebuilt here.
      */
      const backtest =
        await fetchBacktest({
          baseUrl,
          season,
          startWeek,
          endWeek,
          seasonType
        });

      if (
        !backtest.nextStep ||
        !backtest.nextStep.ready
      ) {
        return jsonResponse(
          422,
          {
            error:
              "Underlying RB backtest is not ready for recommendation calibration.",

            backtestStatus:
              backtest.nextStep ||
              null
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
        observations.length <
        10
      ) {
        return jsonResponse(
          422,
          {
            error:
              "Not enough clean RB player-week observations for recommendation calibration.",

            observations:
              observations.length
          }
        );
      }

      const scoreBands =
        buildScoreBands(
          observations
        );

      const overall =
        overallSummary(
          observations
        );

      const thresholds = {
        standard:
          thresholdAnalysis(
            observations,
            "standard"
          ),

        halfPPR:
          thresholdAnalysis(
            observations,
            "halfPPR"
          ),

        ppr:
          thresholdAnalysis(
            observations,
            "ppr"
          )
      };

      return jsonResponse(
        200,
        {
          evidenceType:
            "weekly-sage-rb-recommendation-calibration",

          schemaVersion:
            1,

          generatedAt:
            new Date()
              .toISOString(),

          season,

          seasonType,

          weekRange: {
            startWeek,
            endWeek
          },

          methodology: {
            source:
              "weekly-sage-rb-backtest",

            model:
              "Deployed RB SAGE v2",

            currentWeights: {
              role:
                0.55,

              production:
                0.40,

              matchup:
                0.05
            },

            unitOfObservation:
              "One clean RB player-week in which the player actually participated.",

            objective:
              "Measure how actual fantasy production changes as pre-game SAGE Score increases.",

            calibrationMethod:
              "Analyze actual fantasy-point distributions, downside risk, upside rates, and threshold separation without activating recommendations.",

            outcomeLevels:
              OUTCOME_LEVELS.map(
                level => ({
                  key:
                    level.key,

                  label:
                    level.label,

                  comparator:
                    level.comparator,

                  fantasyPoints:
                    level.value
                })
              ),

            leagueRankLimitation:
              "The current SAGE backtest does not contain the complete weekly NFL RB fantasy population. Therefore RB1 / RB2 / RB3 outcome labels are intentionally not assigned by this endpoint.",

            leakageProtection:
              "This endpoint consumes the frozen historical backtest. Actual outcomes are used only for post-game calibration and never alter the original pre-game SAGE evidence.",

            important:
              "SAGE bands and fantasy-point levels in this endpoint are diagnostic. They are not START / FLEX / SIT recommendations."
          },

          population: {
            cleanPlayerWeekObservations:
              observations.length,

            weeksRequested:
              backtest.population &&
              backtest.population
                .weeksRequested !==
                undefined
                ? backtest.population
                    .weeksRequested
                : null,

            weeksRetrieved:
              backtest.population &&
              backtest.population
                .weeksRetrieved !==
                undefined
                ? backtest.population
                    .weeksRetrieved
                : null,

            missingOutcomes:
              backtest.population &&
              backtest.population
                .missingOutcomes !==
                undefined
                ? backtest.population
                    .missingOutcomes
                : null,

            retrievalFailures:
              backtest.population &&
              backtest.population
                .retrievalFailures !==
                undefined
                ? backtest.population
                    .retrievalFailures
                : null
          },

          overallOutcomeDistribution:
            overall,

          sageBands:
            scoreBands,

          thresholdAnalysis:
            thresholds,

          recommendationThresholds:
            null,

          recommendation:
            null,

          nextStep: {
            ready:
              true,

            reason:
              "Inspect where actual outcome distributions and success rates materially separate by SAGE Score. Use those patterns to design candidate consumer recommendation tiers before activating START / FLEX / SIT."
          },

          provenance: {
            backtest:
              "weekly-sage-rb-backtest",

            finalScore:
              "weekly-sage-rb-final-score",

            modelVersion:
              "rb-sage-v2",

            directTank01Calls:
              0
          }
        },

        CACHE_CONTROL
      );
    } catch (error) {
      console.error(
        "weekly-sage-rb-recommendation-calibration failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not calibrate Weekly SAGE RB recommendations.",

          detail:
            error.message
        }
      );
    }
  };
