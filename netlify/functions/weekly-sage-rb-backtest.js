// netlify/functions/weekly-sage-rb-backtest.js
//
// WEEKLY SAGE — RB MULTI-WEEK BACKTEST
//
// PURPOSE
// -------
// Aggregate multiple historical Weekly SAGE RB validation weeks
// into one forecast-vs-actual dataset.
//
// This endpoint DOES NOT recalculate SAGE.
//
// It consumes:
//   weekly-sage-rb-validation
//
// Each weekly validation endpoint already guarantees:
//
//   PRE-GAME:
//     SAGE uses only information available before target week.
//
//   POST-GAME:
//     Actual target-week production is used only for validation.
//
//   PARTICIPATION:
//     PLAYED -> included
//     BYE -> excluded
//     DNP -> excluded
//     unresolved -> blocks clean backtest
//     failure -> blocks clean backtest
//
// This function calculates:
//
//   - combined player-week sample
//   - Pearson correlation
//   - Spearman correlation
//   - simple linear regression
//   - R-squared
//   - MAE
//   - RMSE
//   - aggregate SAGE score bands
//   - Role / Production / Matchup correlations
//   - weekly validation summaries
//
// IMPORTANT
// ---------
// This endpoint is descriptive validation.
//
// It DOES NOT:
//   - change SAGE weights
//   - optimize SAGE weights
//   - create START / FLEX / SIT thresholds
//   - feed outcomes into historical predictions
//
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_SEASON_TYPE =
  "reg";

const DEFAULT_START_WEEK =
  5;

const DEFAULT_END_WEEK =
  8;

const VALIDATION_FUNCTION =
  "weekly-sage-rb-validation";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

function nullableNum(value) {
  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

function round(
  value,
  digits = 3
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
        method:
          "GET",

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
    return "Unknown validation retrieval failure.";
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
          String(week),

        seasonType
      }
    });

  const result =
    await fetchJsonWithStatus(
      url
    );

  if (!result.ok) {
    return {
      ok:
        false,

      week,

      status:
        result.status,

      error:
        errorMessage(result)
    };
  }

  const data =
    result.data;

  if (
    !data ||
    data.evidenceType !==
      "weekly-sage-rb-validation"
  ) {
    return {
      ok:
        false,

      week,

      status:
        502,

      error:
        "Unexpected Weekly SAGE RB validation schema."
    };
  }

  return {
    ok:
      true,

    week,

    data
  };
}

function buildWeeks(
  startWeek,
  endWeek
) {
  const weeks =
    [];

  for (
    let week = startWeek;
    week <= endWeek;
    week++
  ) {
    weeks.push(
      week
    );
  }

  return weeks;
}

/*
  Convert the weekly validation record into a compact
  player-week observation.

  Each row represents one actual NFL game played.
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
          record.actual.fantasyPoints &&
          record.actual.fantasyPoints.standard
        ),

      halfPPR:
        nullableNum(
          record.actual &&
          record.actual.fantasyPoints &&
          record.actual.fantasyPoints.halfPPR
        ),

      ppr:
        nullableNum(
          record.actual &&
          record.actual.fantasyPoints &&
          record.actual.fantasyPoints.ppr
        ),

      scrimmageYards:
        nullableNum(
          record.actual &&
          record.actual.scrimmageYards
        ),

      opportunities:
        nullableNum(
          record.actual &&
          record.actual.opportunities
        ),

      totalTD:
        nullableNum(
          record.actual &&
          record.actual.totalTD
        )
    }
  };
}

/*
  Pearson correlation.
*/
function pearson(
  pairs
) {
  const clean =
    pairs.filter(
      pair =>
        pair.x !== null &&
        pair.y !== null
    );

  if (
    clean.length < 2
  ) {
    return null;
  }

  const meanX =
    clean.reduce(
      (sum, pair) =>
        sum + pair.x,
      0
    ) /
    clean.length;

  const meanY =
    clean.reduce(
      (sum, pair) =>
        sum + pair.y,
      0
    ) /
    clean.length;

  let numerator =
    0;

  let denominatorX =
    0;

  let denominatorY =
    0;

  for (
    const pair of clean
  ) {
    const dx =
      pair.x -
      meanX;

    const dy =
      pair.y -
      meanY;

    numerator +=
      dx * dy;

    denominatorX +=
      dx * dx;

    denominatorY +=
      dy * dy;
  }

  const denominator =
    Math.sqrt(
      denominatorX *
      denominatorY
    );

  if (
    denominator === 0
  ) {
    return null;
  }

  return (
    numerator /
    denominator
  );
}

function averageRanks(values) {
  const indexed =
    values.map(
      (
        value,
        index
      ) => ({
        value,
        index
      })
    );

  indexed.sort(
    (a, b) =>
      a.value -
      b.value
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
      i + 1;

    while (
      j <
        indexed.length &&
      indexed[j].value ===
        indexed[i].value
    ) {
      j++;
    }

    const averageRank =
      (
        (i + 1) +
        j
      ) / 2;

    for (
      let k = i;
      k < j;
      k++
    ) {
      ranks[
        indexed[k].index
      ] =
        averageRank;
    }

    i =
      j;
  }

  return ranks;
}

function spearman(
  pairs
) {
  const clean =
    pairs.filter(
      pair =>
        pair.x !== null &&
        pair.y !== null
    );

  if (
    clean.length < 2
  ) {
    return null;
  }

  const xs =
    clean.map(
      pair =>
        pair.x
    );

  const ys =
    clean.map(
      pair =>
        pair.y
    );

  const rankedX =
    averageRanks(xs);

  const rankedY =
    averageRanks(ys);

  const rankedPairs =
    rankedX.map(
      (
        x,
        index
      ) => ({
        x,

        y:
          rankedY[index]
      })
    );

  return pearson(
    rankedPairs
  );
}

/*
  Simple OLS regression:

    actualPoints =
      intercept +
      slope * SAGE

  Returns basic calibration / error measures.
*/
function linearRegression(
  pairs
) {
  const clean =
    pairs.filter(
      pair =>
        pair.x !== null &&
        pair.y !== null
    );

  if (
    clean.length < 2
  ) {
    return {
      n:
        clean.length,

      intercept:
        null,

      slope:
        null,

      rSquared:
        null,

      mae:
        null,

      rmse:
        null
    };
  }

  const n =
    clean.length;

  const meanX =
    clean.reduce(
      (sum, pair) =>
        sum + pair.x,
      0
    ) /
    n;

  const meanY =
    clean.reduce(
      (sum, pair) =>
        sum + pair.y,
      0
    ) /
    n;

  let numerator =
    0;

  let denominator =
    0;

  for (
    const pair of clean
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
    denominator === 0
  ) {
    return {
      n,

      intercept:
        null,

      slope:
        null,

      rSquared:
        null,

      mae:
        null,

      rmse:
        null
    };
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

  let sse =
    0;

  let sst =
    0;

  let absoluteError =
    0;

  for (
    const pair of clean
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

    sse +=
      error *
      error;

    absoluteError +=
      Math.abs(
        error
      );

    sst +=
      Math.pow(
        pair.y -
        meanY,
        2
      );
  }

  const rSquared =
    sst > 0
      ? 1 -
        (
          sse /
          sst
        )
      : null;

  return {
    n,

    intercept:
      round(
        intercept,
        3
      ),

    slope:
      round(
        slope,
        4
      ),

    rSquared:
      round(
        rSquared,
        3
      ),

    mae:
      round(
        absoluteError /
        n,
        2
      ),

    rmse:
      round(
        Math.sqrt(
          sse /
          n
        ),
        2
      ),

    equation:
      `Actual = ${round(intercept, 3)} + ${round(slope, 4)} * SAGE`
  };
}

function buildPairs(
  observations,
  xGetter,
  yGetter
) {
  return observations.map(
    observation => ({
      x:
        nullableNum(
          xGetter(
            observation
          )
        ),

      y:
        nullableNum(
          yGetter(
            observation
          )
        )
    })
  );
}

function formatAnalysis(
  observations,
  scoringKey
) {
  const sagePairs =
    buildPairs(
      observations,

      observation =>
        observation.sageScore,

      observation =>
        observation.actual[
          scoringKey
        ]
    );

  const rolePairs =
    buildPairs(
      observations,

      observation =>
        observation
          .components
          .role,

      observation =>
        observation.actual[
          scoringKey
        ]
    );

  const productionPairs =
    buildPairs(
      observations,

      observation =>
        observation
          .components
          .production,

      observation =>
        observation.actual[
          scoringKey
        ]
    );

  const matchupPairs =
    buildPairs(
      observations,

      observation =>
        observation
          .components
          .matchup,

      observation =>
        observation.actual[
          scoringKey
        ]
    );

  return {
    sage: {
      pearson:
        round(
          pearson(
            sagePairs
          ),
          3
        ),

      spearman:
        round(
          spearman(
            sagePairs
          ),
          3
        ),

      regression:
        linearRegression(
          sagePairs
        )
    },

    componentCorrelations: {
      role: {
        pearson:
          round(
            pearson(
              rolePairs
            ),
            3
          ),

        spearman:
          round(
            spearman(
              rolePairs
            ),
            3
          )
      },

      production: {
        pearson:
          round(
            pearson(
              productionPairs
            ),
            3
          ),

        spearman:
          round(
            spearman(
              productionPairs
            ),
            3
          )
      },

      matchup: {
        pearson:
          round(
            pearson(
              matchupPairs
            ),
            3
          ),

        spearman:
          round(
            spearman(
              matchupPairs
            ),
            3
          )
      }
    }
  };
}

function average(
  values,
  digits = 2
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
    digits
  );
}

function aggregateScoreBands(
  observations
) {
  const definitions = [
    {
      key:
        "70_plus",

      label:
        "70+",

      min:
        70,

      max:
        Infinity
    },

    {
      key:
        "60_to_69_9",

      label:
        "60-69.9",

      min:
        60,

      max:
        69.999999
    },

    {
      key:
        "50_to_59_9",

      label:
        "50-59.9",

      min:
        50,

      max:
        59.999999
    },

    {
      key:
        "40_to_49_9",

      label:
        "40-49.9",

      min:
        40,

      max:
        49.999999
    },

    {
      key:
        "below_40",

      label:
        "Below 40",

      min:
        -Infinity,

      max:
        39.999999
    }
  ];

  return definitions.map(
    definition => {
      const rows =
        observations.filter(
          observation =>
            observation.sageScore !==
              null &&
            observation.sageScore >=
              definition.min &&
            observation.sageScore <=
              definition.max
        );

      return {
        key:
          definition.key,

        label:
          definition.label,

        playerWeeks:
          rows.length,

        averageSageScore:
          average(
            rows.map(
              row =>
                row.sageScore
            ),
            1
          ),

        averageActualFantasyPoints: {
          standard:
            average(
              rows.map(
                row =>
                  row.actual.standard
              )
            ),

          halfPPR:
            average(
              rows.map(
                row =>
                  row.actual.halfPPR
              )
            ),

          ppr:
            average(
              rows.map(
                row =>
                  row.actual.ppr
              )
            )
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

    sageActivePlayers:
      nullableNum(
        population.sageActivePlayers
      ),

    outcomesMatched:
      nullableNum(
        population.outcomesMatched
      ),

    bye:
      nullableNum(
        population.bye
      ) || 0,

    didNotPlay:
      nullableNum(
        population.didNotPlay
      ) || 0,

    missingOutcomes:
      nullableNum(
        population.missingOutcomes
      ) || 0,

    failures:
      nullableNum(
        population.failures
      ) || 0,

    correlations: {
      standard:
        correlations.standard ||
        null,

      halfPPR:
        correlations.halfPPR ||
        null,

      ppr:
        correlations.ppr ||
        null
    },

    ready:
      Boolean(
        validation.nextStep &&
        validation.nextStep.ready
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
      startWeek > endWeek
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

      const weeks =
        buildWeeks(
          startWeek,
          endWeek
        );

      /*
        Retrieve each already-validated historical week.
      */
      const results =
        await Promise.all(
          weeks.map(
            week =>
              fetchValidationWeek({
                baseUrl,
                season,
                week,
                seasonType
              })
          )
        );

      const retrievalFailures =
        results
          .filter(
            result =>
              !result.ok
          )
          .map(
            result => ({
              week:
                result.week,

              error:
                result.error
            })
          );

      const validations =
        results
          .filter(
            result =>
              result.ok
          )
          .map(
            result =>
              result.data
          );

      /*
        A weekly validator with missing outcomes or failures
        is not considered clean enough for the aggregate model.
      */
      const unreadyWeeks =
        validations
          .filter(
            validation =>
              !(
                validation.nextStep &&
                validation.nextStep.ready
              )
          )
          .map(
            validation => ({
              week:
                validation.targetWeek,

              population:
                validation.population,

              reason:
                validation.nextStep
                  ? validation
                      .nextStep
                      .reason
                  : "Weekly validation is not ready."
            })
          );

      /*
        Build combined player-week dataset using ONLY actual
        played validation records.

        Bye and DNP players never appear here.
      */
      const observations =
        [];

      for (
        const validation of validations
      ) {
        const records =
          Array.isArray(
            validation.validation
          )
            ? validation.validation
            : [];

        for (
          const record of records
        ) {
          observations.push(
            observationFromRecord(
              record,
              validation.targetWeek
            )
          );
        }
      }

      const analysis = {
        standard:
          formatAnalysis(
            observations,
            "standard"
          ),

        halfPPR:
          formatAnalysis(
            observations,
            "halfPPR"
          ),

        ppr:
          formatAnalysis(
            observations,
            "ppr"
          )
      };

      const scoreBands =
        aggregateScoreBands(
          observations
        );

      const weeksSummary =
        validations
          .map(
            weeklySummary
          )
          .sort(
            (a, b) =>
              a.week -
              b.week
          );

      const totalBye =
        weeksSummary.reduce(
          (
            total,
            week
          ) =>
            total +
            (
              week.bye ||
              0
            ),
          0
        );

      const totalDNP =
        weeksSummary.reduce(
          (
            total,
            week
          ) =>
            total +
            (
              week.didNotPlay ||
              0
            ),
          0
        );

      const totalMissing =
        weeksSummary.reduce(
          (
            total,
            week
          ) =>
            total +
            (
              week.missingOutcomes ||
              0
            ),
          0
        );

      const totalFailures =
        weeksSummary.reduce(
          (
            total,
            week
          ) =>
            total +
            (
              week.failures ||
              0
            ),
          0
        );

      const ready =
        retrievalFailures.length ===
          0 &&
        unreadyWeeks.length ===
          0 &&
        observations.length >
          0;

      return jsonResponse(
        200,
        {
          evidenceType:
            "weekly-sage-rb-backtest",

          schemaVersion:
            1,

          generatedAt:
            new Date()
              .toISOString(),

          season,

          seasonType,

          weekRange: {
            startWeek,
            endWeek,

            weeks
          },

          methodology: {
            unitOfObservation:
              "One RB player-week in which the player actually participated in the target-week game.",

            prediction:
              "Frozen pre-game Weekly SAGE score.",

            outcome:
              "Actual target-week fantasy points.",

            leakageProtection:
              "This endpoint consumes weekly-sage-rb-validation results. Target-week actual performance never feeds back into the historical SAGE prediction.",

            exclusions: [
              "Bye weeks",
              "Did Not Play",
              "Unresolved outcomes",
              "Validation retrieval failures"
            ],

            regression:
              "Simple ordinary least squares regression of actual fantasy points on pre-game SAGE Score.",

            important:
              "This backtest measures historical predictive relationship. It does not optimize weights or create recommendation thresholds."
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

            missingOutcomes:
              totalMissing,

            weeklyFailures:
              totalFailures,

            retrievalFailures:
              retrievalFailures.length
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

          nextStep: {
            ready,

            reason:
              ready
                ? "Multi-week forecast-vs-actual dataset is clean and ready for interpretation. Review combined correlations, regression fit, component relationships, and score-band calibration before changing SAGE or defining recommendation thresholds."
                : "Resolve unready weeks or retrieval failures before interpreting the combined backtest."
          },

          provenance: {
            weeklyValidation:
              "weekly-sage-rb-validation",

            prediction:
              "weekly-sage-rb-leaderboard",

            outcomes:
              "weekly-sage-player-season",

            participation:
              "weekly-sage-schedule"
          }
        },

        CACHE_CONTROL
      );
    } catch (error) {
      console.error(
        "weekly-sage-rb-backtest failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not build Weekly SAGE RB multi-week backtest.",

          detail:
            error.message
        }
      );
    }
  };
