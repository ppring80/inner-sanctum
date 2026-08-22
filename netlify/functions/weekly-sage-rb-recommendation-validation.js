// netlify/functions/weekly-sage-rb-recommendation-validation.js
//
// WEEKLY SAGE — RB RECOMMENDATION BOUNDARY VALIDATION
//
// PURPOSE
// -------
// Test candidate consumer-facing RB recommendation boundaries
// against actual historical fantasy outcomes.
//
// This endpoint consumes:
//
//   weekly-sage-rb-backtest
//
// It DOES NOT:
// - recalculate SAGE
// - call Tank01 directly
// - change RB SAGE v2 weights
// - activate START / FLEX / SIT in production
// - optimize recommendation thresholds automatically
//
// CURRENT RB SAGE MODEL
// ---------------------
//
//   RB SAGE v2
//
//   ROLE        55%
//   PRODUCTION  40%
//   MATCHUP      5%
//
// OBJECTIVE
// ---------
// Determine whether simple consumer recommendation tiers:
//
//   START
//   FLEX
//   SIT
//
// are supported by actual historical performance.
//
// Candidate boundaries tested:
//
//   70 / 60
//   65 / 55
//   60 / 50
//
// Example:
//
//   START >= 65
//   FLEX  >= 55 and < 65
//   SIT   < 55
//
// IMPORTANT
// ---------
// These are diagnostic experiments.
//
// This endpoint does NOT automatically select a winner.
//
// It measures:
//
//   - average actual fantasy points
//   - median actual fantasy points
//   - 25th / 75th percentile
//   - 10+ hit rate
//   - 12+ hit rate
//   - 15+ hit rate
//   - 20+ hit rate
//   - below-8 rate
//   - below-5 rate
//
// It also identifies:
//
//   FALSE STARTS
//     SAGE recommended START but actual production was poor.
//
//   FALSE SITS
//     SAGE recommended SIT but actual production was useful/high.
//
// Because scoring formats differ, false-positive / false-negative
// definitions are evaluated independently for:
//
//   Standard
//   Half-PPR
//   PPR
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
  Candidate recommendation structures.

  IMPORTANT:
  We are testing these structures exactly as defined.

  We are NOT searching every possible combination.
*/
const CANDIDATE_BOUNDARIES = [
  {
    key:
      "conservative",

    label:
      "70 / 60",

    startThreshold:
      70,

    flexThreshold:
      60
  },

  {
    key:
      "balanced",

    label:
      "65 / 55",

    startThreshold:
      65,

    flexThreshold:
      55
  },

  {
    key:
      "aggressive",

    label:
      "60 / 50",

    startThreshold:
      60,

    flexThreshold:
      50
  }
];

/*
  Diagnostic outcome levels.

  These are not formal RB1/RB2 definitions.

  They are objective fantasy-point levels used to measure
  upside, floor, and recommendation mistakes.
*/
const OUTCOME_THRESHOLDS = {
  standard: {
    useful:
      10,

    strong:
      15,

    elite:
      20,

    poor:
      8,

    veryPoor:
      5
  },

  halfPPR: {
    useful:
      10,

    strong:
      15,

    elite:
      20,

    poor:
      8,

    veryPoor:
      5
  },

  ppr: {
    useful:
      10,

    strong:
      15,

    elite:
      20,

    poor:
      8,

    veryPoor:
      5
  }
};

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
    clean.length ===
    0
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

  const interpolationWeight =
    position -
    lowerIndex;

  const interpolated =
    clean[
      lowerIndex
    ] *
    (
      1 -
      interpolationWeight
    ) +
    clean[
      upperIndex
    ] *
    interpolationWeight;

  return round(
    interpolated,
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
    return {
      hits:
        0,

      total:
        0,

      rate:
        null,

      percent:
        null
    };
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

function recommendationForScore(
  sageScore,
  boundary
) {
  const score =
    nullableNum(
      sageScore
    );

  if (
    score === null
  ) {
    return null;
  }

  if (
    score >=
    boundary.startThreshold
  ) {
    return "START";
  }

  if (
    score >=
    boundary.flexThreshold
  ) {
    return "FLEX";
  }

  return "SIT";
}

function scoringValue(
  observation,
  scoringKey
) {
  return nullableNum(
    observation &&
    observation.actual &&
    observation.actual[
      scoringKey
    ]
  );
}

function summarizeValues(
  values,
  scoringKey
) {
  const thresholds =
    OUTCOME_THRESHOLDS[
      scoringKey
    ];

  const clean =
    values
      .map(
        nullableNum
      )
      .filter(
        value =>
          value !== null
      );

  return {
    count:
      clean.length,

    average:
      mean(
        clean
      ),

    median:
      percentile(
        clean,
        0.50
      ),

    distribution: {
      min:
        clean.length
          ? round(
              Math.min(
                ...clean
              ),
              2
            )
          : null,

      p10:
        percentile(
          clean,
          0.10
        ),

      p25:
        percentile(
          clean,
          0.25
        ),

      median:
        percentile(
          clean,
          0.50
        ),

      p75:
        percentile(
          clean,
          0.75
        ),

      p90:
        percentile(
          clean,
          0.90
        ),

      max:
        clean.length
          ? round(
              Math.max(
                ...clean
              ),
              2
            )
          : null
    },

    outcomeRates: {
      gte10:
        rate(
          clean,
          "gte",
          thresholds.useful
        ),

      gte12:
        rate(
          clean,
          "gte",
          12
        ),

      gte15:
        rate(
          clean,
          "gte",
          thresholds.strong
        ),

      gte20:
        rate(
          clean,
          "gte",
          thresholds.elite
        ),

      below8:
        rate(
          clean,
          "lt",
          thresholds.poor
        ),

      below5:
        rate(
          clean,
          "lt",
          thresholds.veryPoor
        )
    }
  };
}

/*
  FALSE START
  -----------

  Recommended START, but actual result falls below 8.

  We use below 8 because this represents a meaningful
  consumer disappointment without pretending it is a
  formal universal RB bust threshold.
*/
function isFalseStart(
  observation,
  scoringKey,
  boundary
) {
  const recommendation =
    recommendationForScore(
      observation.sageScore,
      boundary
    );

  const actual =
    scoringValue(
      observation,
      scoringKey
    );

  if (
    recommendation !==
      "START" ||
    actual === null
  ) {
    return false;
  }

  return (
    actual <
    OUTCOME_THRESHOLDS[
      scoringKey
    ].poor
  );
}

/*
  FALSE SIT
  ---------

  Recommended SIT, but actual result reaches 15+.

  This represents a meaningful missed productive game.

  Again, this is diagnostic rather than a universal
  fantasy-football definition.
*/
function isFalseSit(
  observation,
  scoringKey,
  boundary
) {
  const recommendation =
    recommendationForScore(
      observation.sageScore,
      boundary
    );

  const actual =
    scoringValue(
      observation,
      scoringKey
    );

  if (
    recommendation !==
      "SIT" ||
    actual === null
  ) {
    return false;
  }

  return (
    actual >=
    OUTCOME_THRESHOLDS[
      scoringKey
    ].strong
  );
}

function compactObservation(
  observation,
  scoringKey
) {
  return {
    week:
      observation.seasonWeek,

    playerID:
      observation.playerID ||
      null,

    name:
      observation.name ||
      null,

    team:
      observation.team ||
      null,

    opponent:
      observation.opponent ||
      null,

    sageScore:
      nullableNum(
        observation.sageScore
      ),

    actualFantasyPoints:
      scoringValue(
        observation,
        scoringKey
      )
  };
}

function summarizeRecommendationTier(
  observations,
  scoringKey,
  boundary,
  recommendation
) {
  const rows =
    observations.filter(
      observation =>
        recommendationForScore(
          observation.sageScore,
          boundary
        ) ===
        recommendation
    );

  const values =
    rows
      .map(
        observation =>
          scoringValue(
            observation,
            scoringKey
          )
      )
      .filter(
        value =>
          value !== null
      );

  return {
    recommendation,

    playerWeeks:
      rows.length,

    sageRange:
      recommendation ===
      "START"
        ? {
            min:
              boundary.startThreshold,

            max:
              null
          }
        : recommendation ===
          "FLEX"
          ? {
              min:
                boundary.flexThreshold,

              max:
                boundary.startThreshold -
                0.000001
            }
          : {
              min:
                null,

              max:
                boundary.flexThreshold -
                0.000001
            },

    actualOutcomes:
      summarizeValues(
        values,
        scoringKey
      )
  };
}

function validateBoundaryForScoring(
  observations,
  scoringKey,
  boundary
) {
  const start =
    summarizeRecommendationTier(
      observations,
      scoringKey,
      boundary,
      "START"
    );

  const flex =
    summarizeRecommendationTier(
      observations,
      scoringKey,
      boundary,
      "FLEX"
    );

  const sit =
    summarizeRecommendationTier(
      observations,
      scoringKey,
      boundary,
      "SIT"
    );

  const falseStarts =
    observations.filter(
      observation =>
        isFalseStart(
          observation,
          scoringKey,
          boundary
        )
    );

  const falseSits =
    observations.filter(
      observation =>
        isFalseSit(
          observation,
          scoringKey,
          boundary
        )
    );

  const startCount =
    start.playerWeeks;

  const sitCount =
    sit.playerWeeks;

  return {
    scoringFormat:
      scoringKey,

    tiers: {
      start,

      flex,

      sit
    },

    errors: {
      falseStart: {
        definition:
          "Recommended START but actual fantasy points were below 8.",

        count:
          falseStarts.length,

        eligibleStarts:
          startCount,

        rate:
          startCount > 0
            ? round(
                falseStarts.length /
                startCount,
                3
              )
            : null,

        percent:
          startCount > 0
            ? round(
                (
                  falseStarts.length /
                  startCount
                ) *
                100,
                1
              )
            : null,

        examples:
          falseStarts
            .slice(
              0,
              10
            )
            .map(
              observation =>
                compactObservation(
                  observation,
                  scoringKey
                )
            )
      },

      falseSit: {
        definition:
          "Recommended SIT but actual fantasy points were 15 or higher.",

        count:
          falseSits.length,

        eligibleSits:
          sitCount,

        rate:
          sitCount > 0
            ? round(
                falseSits.length /
                sitCount,
                3
              )
            : null,

        percent:
          sitCount > 0
            ? round(
                (
                  falseSits.length /
                  sitCount
                ) *
                100,
                1
              )
            : null,

        examples:
          falseSits
            .slice(
              0,
              10
            )
            .map(
              observation =>
                compactObservation(
                  observation,
                  scoringKey
                )
            )
      }
    },

    separation: {
      startVsFlexAverage:
        (
          start.actualOutcomes.average !==
            null &&
          flex.actualOutcomes.average !==
            null
        )
          ? round(
              start.actualOutcomes.average -
              flex.actualOutcomes.average,
              2
            )
          : null,

      flexVsSitAverage:
        (
          flex.actualOutcomes.average !==
            null &&
          sit.actualOutcomes.average !==
            null
        )
          ? round(
              flex.actualOutcomes.average -
              sit.actualOutcomes.average,
              2
            )
          : null,

      startVsSitAverage:
        (
          start.actualOutcomes.average !==
            null &&
          sit.actualOutcomes.average !==
            null
        )
          ? round(
              start.actualOutcomes.average -
              sit.actualOutcomes.average,
              2
            )
          : null,

      startVsFlexMedian:
        (
          start.actualOutcomes.median !==
            null &&
          flex.actualOutcomes.median !==
            null
        )
          ? round(
              start.actualOutcomes.median -
              flex.actualOutcomes.median,
              2
            )
          : null,

      flexVsSitMedian:
        (
          flex.actualOutcomes.median !==
            null &&
          sit.actualOutcomes.median !==
            null
        )
          ? round(
              flex.actualOutcomes.median -
              sit.actualOutcomes.median,
              2
            )
          : null,

      startVsSitMedian:
        (
          start.actualOutcomes.median !==
            null &&
          sit.actualOutcomes.median !==
            null
        )
          ? round(
              start.actualOutcomes.median -
              sit.actualOutcomes.median,
              2
            )
          : null
    }
  };
}

function validateCandidate(
  observations,
  boundary
) {
  return {
    key:
      boundary.key,

    label:
      boundary.label,

    thresholds: {
      start:
        boundary.startThreshold,

      flex:
        boundary.flexThreshold,

      sit:
        `<${boundary.flexThreshold}`
    },

    recommendationLogic: {
      start:
        `SAGE >= ${boundary.startThreshold}`,

      flex:
        `SAGE >= ${boundary.flexThreshold} and < ${boundary.startThreshold}`,

      sit:
        `SAGE < ${boundary.flexThreshold}`
    },

    scoring: {
      standard:
        validateBoundaryForScoring(
          observations,
          "standard",
          boundary
        ),

      halfPPR:
        validateBoundaryForScoring(
          observations,
          "halfPPR",
          boundary
        ),

      ppr:
        validateBoundaryForScoring(
          observations,
          "ppr",
          boundary
        )
    }
  };
}

function buildComparisonTable(
  candidates
) {
  return candidates.map(
    candidate => {
      const standard =
        candidate.scoring.standard;

      const halfPPR =
        candidate.scoring.halfPPR;

      const ppr =
        candidate.scoring.ppr;

      return {
        key:
          candidate.key,

        label:
          candidate.label,

        thresholds:
          candidate.thresholds,

        standard: {
          startPlayerWeeks:
            standard
              .tiers
              .start
              .playerWeeks,

          startAverage:
            standard
              .tiers
              .start
              .actualOutcomes
              .average,

          startMedian:
            standard
              .tiers
              .start
              .actualOutcomes
              .median,

          startBelow8Percent:
            standard
              .tiers
              .start
              .actualOutcomes
              .outcomeRates
              .below8
              .percent,

          falseStartPercent:
            standard
              .errors
              .falseStart
              .percent,

          falseSitPercent:
            standard
              .errors
              .falseSit
              .percent,

          startVsSitMedianSeparation:
            standard
              .separation
              .startVsSitMedian
        },

        halfPPR: {
          startPlayerWeeks:
            halfPPR
              .tiers
              .start
              .playerWeeks,

          startAverage:
            halfPPR
              .tiers
              .start
              .actualOutcomes
              .average,

          startMedian:
            halfPPR
              .tiers
              .start
              .actualOutcomes
              .median,

          startBelow8Percent:
            halfPPR
              .tiers
              .start
              .actualOutcomes
              .outcomeRates
              .below8
              .percent,

          falseStartPercent:
            halfPPR
              .errors
              .falseStart
              .percent,

          falseSitPercent:
            halfPPR
              .errors
              .falseSit
              .percent,

          startVsSitMedianSeparation:
            halfPPR
              .separation
              .startVsSitMedian
        },

        ppr: {
          startPlayerWeeks:
            ppr
              .tiers
              .start
              .playerWeeks,

          startAverage:
            ppr
              .tiers
              .start
              .actualOutcomes
              .average,

          startMedian:
            ppr
              .tiers
              .start
              .actualOutcomes
              .median,

          startBelow8Percent:
            ppr
              .tiers
              .start
              .actualOutcomes
              .outcomeRates
              .below8
              .percent,

          falseStartPercent:
            ppr
              .errors
              .falseStart
              .percent,

          falseSitPercent:
            ppr
              .errors
              .falseSit
              .percent,

          startVsSitMedianSeparation:
            ppr
              .separation
              .startVsSitMedian
        }
      };
    }
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

    try {
      const baseUrl =
        getBaseUrl(
          event
        );

      /*
        Fetch the already-clean deployed RB SAGE v2 backtest.

        No direct Tank01 work occurs here.
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
              "Underlying RB backtest is not ready for recommendation validation.",

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
              "Not enough clean RB player-week observations for recommendation validation.",

            observations:
              observations.length
          }
        );
      }

      /*
        Test the three predefined candidate structures.

        We intentionally do NOT create new thresholds based on
        these results inside this endpoint.
      */
      const candidates =
        CANDIDATE_BOUNDARIES.map(
          boundary =>
            validateCandidate(
              observations,
              boundary
            )
        );

      const comparison =
        buildComparisonTable(
          candidates
        );

      return jsonResponse(
        200,
        {
          evidenceType:
            "weekly-sage-rb-recommendation-validation",

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
            model:
              "RB SAGE v2",

            weights: {
              role:
                0.55,

              production:
                0.40,

              matchup:
                0.05
            },

            source:
              "weekly-sage-rb-backtest",

            unitOfObservation:
              "One clean historical RB player-week with a frozen pre-game SAGE score and actual post-game fantasy outcome.",

            candidateBoundaries:
              CANDIDATE_BOUNDARIES.map(
                boundary => ({
                  label:
                    boundary.label,

                  startThreshold:
                    boundary.startThreshold,

                  flexThreshold:
                    boundary.flexThreshold
                })
              ),

            errorDefinitions: {
              falseStart:
                "SAGE recommendation is START and actual fantasy production is below 8 points.",

              falseSit:
                "SAGE recommendation is SIT and actual fantasy production is 15 points or higher."
            },

            important:
              "This endpoint compares predefined recommendation structures. It does not optimize thresholds or activate recommendations."
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

          candidates,

          comparison,

          selectedRecommendationThresholds:
            null,

          recommendation:
            null,

          nextStep: {
            ready:
              true,

            reason:
              "Compare the predefined 70/60, 65/55, and 60/50 recommendation structures. Evaluate tier separation, false START rate, false SIT rate, downside risk, and scoring-format stability before selecting the first RB consumer recommendation thresholds."
          },

          provenance: {
            backtest:
              "weekly-sage-rb-backtest",

            finalScore:
              "weekly-sage-rb-final-score",

            calibration:
              "weekly-sage-rb-recommendation-calibration",

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
        "weekly-sage-rb-recommendation-validation failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not validate Weekly SAGE RB recommendation boundaries.",

          detail:
            error.message
        }
      );
    }
  };
