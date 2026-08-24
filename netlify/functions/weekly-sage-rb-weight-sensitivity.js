// netlify/functions/weekly-sage-rb-weight-sensitivity.js
//
// WEEKLY SAGE — RB WEIGHT SENSITIVITY ANALYSIS
//
// PURPOSE
// -------
// Evaluate how alternative Role / Production / Matchup weights
// would have performed on the SAME frozen historical backtest
// observations.
//
// This endpoint consumes:
//
//   weekly-sage-rb-backtest
//
// It DOES NOT:
// - call Tank01 directly
// - rebuild historical player evidence
// - alter the deployed SAGE model
// - optimize weights automatically
// - create START / FLEX / SIT thresholds
//
// It simply asks:
//
//   "If we had combined the exact same frozen components
//    differently, how would the historical forecast-vs-actual
//    relationship have changed?"
//
// IMPORTANT
// ---------
// This is sensitivity analysis, not robustness validation and not a
// final weight selection engine.
//
// It reports how alternative weight combinations would score against
// the SAME frozen historical sample the current weights were also
// evaluated against -- it does not use held-out/train-test splits,
// does not apply a predetermined decision bar, and does not pick a
// winner. A human must review the comparisons and decide.
//
// With a small historical sample, the best-performing weight
// configuration can easily be noise.
//
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_SEASON_TYPE =
  "reg";

const DEFAULT_START_WEEK =
  5;

const DEFAULT_END_WEEK =
  8;

const BACKTEST_FUNCTION =
  "weekly-sage-rb-backtest";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

/*
  Candidate weight configurations.

  CURRENT reflects the deployed RB SAGE v2 production weights
  (55/40/5), selected after an earlier sensitivity pass against this
  same endpoint. It replaced the prior RB SAGE v1 baseline (45/35/20),
  which is no longer deployed and is not labeled "current" here.

  NOTE: because CURRENT is now 55/40/5, it is numerically identical
  to the "minimal_matchup" candidate below. Both entries are kept
  per the existing candidate set -- "minimal_matchup" is left
  unmodified rather than removed or merged, since this file's
  candidate list is otherwise untouched.

  The other configurations are diagnostic alternatives only.
*/
const WEIGHT_SETS = [
  {
    key:
      "current",

    label:
      "Current",

    role:
      0.55,

    production:
      0.40,

    matchup:
      0.05
  },

  {
    key:
      "less_matchup",

    label:
      "Less Matchup",

    role:
      0.50,

    production:
      0.40,

    matchup:
      0.10
  },

  {
    key:
      "minimal_matchup",

    label:
      "Minimal Matchup",

    role:
      0.55,

    production:
      0.40,

    matchup:
      0.05
  },

  {
    key:
      "no_matchup",

    label:
      "No Matchup",

    role:
      0.55,

    production:
      0.45,

    matchup:
      0.00
  },

  {
    key:
      "role_heavy",

    label:
      "Role Heavy",

    role:
      0.60,

    production:
      0.30,

    matchup:
      0.10
  },

  {
    key:
      "production_heavy",

    label:
      "Production Heavy",

    role:
      0.40,

    production:
      0.50,

    matchup:
      0.10
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

/*
  Recalculate the final score using alternative weights.

  IMPORTANT:
  The underlying Role, Production and Matchup components remain
  exactly as they were historically observed.

  Only the final combination changes.
*/
function calculateAlternativeScore(
  observation,
  weights
) {
  const role =
    nullableNum(
      observation &&
      observation.components &&
      observation.components.role
    );

  const production =
    nullableNum(
      observation &&
      observation.components &&
      observation.components.production
    );

  const matchup =
    nullableNum(
      observation &&
      observation.components &&
      observation.components.matchup
    );

  if (
    role === null ||
    production === null ||
    matchup === null
  ) {
    return null;
  }

  return round(
    (
      role *
      weights.role
    ) +
    (
      production *
      weights.production
    ) +
    (
      matchup *
      weights.matchup
    ),
    3
  );
}

function pearson(pairs) {
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
      (
        sum,
        pair
      ) =>
        sum +
        pair.x,
      0
    ) /
    clean.length;

  const meanY =
    clean.reduce(
      (
        sum,
        pair
      ) =>
        sum +
        pair.y,
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

function spearman(pairs) {
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
    averageRanks(
      xs
    );

  const rankedY =
    averageRanks(
      ys
    );

  return pearson(
    rankedX.map(
      (
        x,
        index
      ) => ({
        x,

        y:
          rankedY[index]
      })
    )
  );
}

function linearRegression(pairs) {
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
      (
        sum,
        pair
      ) =>
        sum +
        pair.x,
      0
    ) /
    n;

  const meanY =
    clean.reduce(
      (
        sum,
        pair
      ) =>
        sum +
        pair.y,
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
      )
  };
}

function buildPairs(
  observations,
  scores,
  scoringKey
) {
  return observations.map(
    (
      observation,
      index
    ) => ({
      x:
        nullableNum(
          scores[index]
        ),

      y:
        nullableNum(
          observation &&
          observation.actual &&
          observation.actual[
            scoringKey
          ]
        )
    })
  );
}

function analyzeConfiguration(
  observations,
  weights
) {
  const scores =
    observations.map(
      observation =>
        calculateAlternativeScore(
          observation,
          weights
        )
    );

  const scoringFormats = [
    "standard",
    "halfPPR",
    "ppr"
  ];

  const analysis =
    {};

  for (
    const scoringKey of
    scoringFormats
  ) {
    const pairs =
      buildPairs(
        observations,
        scores,
        scoringKey
      );

    const regression =
      linearRegression(
        pairs
      );

    analysis[
      scoringKey
    ] = {
      pearson:
        round(
          pearson(
            pairs
          ),
          3
        ),

      spearman:
        round(
          spearman(
            pairs
          ),
          3
        ),

      regression
    };
  }

  return {
    key:
      weights.key,

    label:
      weights.label,

    weights: {
      role:
        weights.role,

      production:
        weights.production,

      matchup:
        weights.matchup
    },

    analysis
  };
}

function metricDelta(
  candidate,
  current
) {
  if (
    candidate === null ||
    candidate === undefined ||
    current === null ||
    current === undefined
  ) {
    return null;
  }

  return round(
    candidate -
    current,
    3
  );
}

function buildDeltaVsCurrent(
  candidate,
  current
) {
  const result =
    {};

  for (
    const scoringKey of [
      "standard",
      "halfPPR",
      "ppr"
    ]
  ) {
    const candidateAnalysis =
      candidate.analysis[
        scoringKey
      ];

    const currentAnalysis =
      current.analysis[
        scoringKey
      ];

    result[
      scoringKey
    ] = {
      pearson:
        metricDelta(
          candidateAnalysis
            .pearson,

          currentAnalysis
            .pearson
        ),

      spearman:
        metricDelta(
          candidateAnalysis
            .spearman,

          currentAnalysis
            .spearman
        ),

      rSquared:
        metricDelta(
          candidateAnalysis
            .regression
            .rSquared,

          currentAnalysis
            .regression
            .rSquared
        ),

      /*
        For MAE and RMSE:

        negative delta = improvement
        positive delta = worse
      */
      mae:
        metricDelta(
          candidateAnalysis
            .regression
            .mae,

          currentAnalysis
            .regression
            .mae
        ),

      rmse:
        metricDelta(
          candidateAnalysis
            .regression
            .rmse,

          currentAnalysis
            .regression
            .rmse
        )
    };
  }

  return result;
}

function validateWeights(
  weightSet
) {
  const total =
    weightSet.role +
    weightSet.production +
    weightSet.matchup;

  return (
    Math.abs(
      total -
      1
    ) <
    0.000001
  );
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

    /*
      Defensive configuration validation.

      Every candidate must sum to exactly 1.
    */
    const invalidWeightSets =
      WEIGHT_SETS.filter(
        weightSet =>
          !validateWeights(
            weightSet
          )
      );

    if (
      invalidWeightSets.length >
      0
    ) {
      return jsonResponse(
        500,
        {
          error:
            "One or more weight configurations do not sum to 1.",

          invalidWeightSets
        }
      );
    }

    try {
      const baseUrl =
        getBaseUrl(
          event
        );

      /*
        SINGLE DATA SOURCE
        ------------------

        We deliberately consume the existing backtest rather
        than rebuilding validation data.

        This guarantees that every configuration sees the exact
        same player-week observations.
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
              "Underlying RB backtest is not ready for weight sensitivity analysis.",

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
        2
      ) {
        return jsonResponse(
          422,
          {
            error:
              "Not enough clean backtest observations for sensitivity analysis.",

            observations:
              observations.length
          }
        );
      }

      /*
        Calculate all candidate configurations.
      */
      const configurations =
        WEIGHT_SETS.map(
          weightSet =>
            analyzeConfiguration(
              observations,
              weightSet
            )
        );

      const current =
        configurations.find(
          configuration =>
            configuration.key ===
            "current"
        );

      if (!current) {
        throw new Error(
          "Current SAGE weight configuration is missing."
        );
      }

      /*
        Add comparison against the deployed RB SAGE v2 current
        configuration (55/40/5).

        Current itself receives zeros.
      */
      const comparisons =
        configurations.map(
          configuration => ({
            ...configuration,

            deltaVsCurrent:
              buildDeltaVsCurrent(
                configuration,
                current
              )
          })
        );

      return jsonResponse(
        200,
        {
          evidenceType:
            "weekly-sage-rb-weight-sensitivity",

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

            unitOfObservation:
              "One clean RB player-week from the existing multi-week historical backtest.",

            frozenEvidence:
              "Role, Production, Matchup, Confidence, target-week participation, and actual fantasy outcomes are not recalculated.",

            experiment:
              "Only the final Role / Production / Matchup combination weights are changed.",

            currentWeights: {
              role:
                0.55,

              production:
                0.40,

              matchup:
                0.05
            },

            metrics: [
              "Pearson correlation",
              "Spearman rank correlation",
              "R-squared",
              "MAE",
              "RMSE"
            ],

            deltaInterpretation: {
              pearson:
                "Positive is better.",

              spearman:
                "Positive is better.",

              rSquared:
                "Positive is better.",

              mae:
                "Negative is better.",

              rmse:
                "Negative is better."
            },

            important:
              "This endpoint is sensitivity analysis only, not robustness validation and not a final weight selection engine. It does not recommend or automatically select new SAGE weights."
          },

          population: {
            cleanPlayerWeekObservations:
              observations.length,

            weightConfigurationsTested:
              comparisons.length,

            underlyingBacktestReady:
              true
          },

          currentConfiguration:
            current,

          configurations:
            comparisons,

          recommendation:
            null,

          nextStep: {
            ready:
              true,

            reason:
              "Compare alternative configurations against the current deployed 55/40/5 RB SAGE v2 architecture. This is sensitivity analysis, not robustness-tested or held-out evidence -- treat differences as diagnostic only until a substantially larger historical sample, and a held-out evaluation, are available."
          },

          provenance: {
            backtest:
              "weekly-sage-rb-backtest",

            weeklyValidation:
              "weekly-sage-rb-validation",

            directTank01Calls:
              0
          }
        },

        CACHE_CONTROL
      );
    } catch (error) {
      console.error(
        "weekly-sage-rb-weight-sensitivity failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not run Weekly SAGE RB weight sensitivity analysis.",

          detail:
            error.message
        }
      );
    }
  };
