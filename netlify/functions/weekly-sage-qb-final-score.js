// netlify/functions/weekly-sage-qb-final-score.js
//
// WEEKLY SAGE — QB FINAL SCORE
//
// PURPOSE
// -------
// Compose the first complete Weekly SAGE score for QBs.
//
// SOURCES
// -------
//
//   weekly-sage-qb-confidence
//   weekly-sage-player-matchup
//
// FIRST-PASS QB FINAL WEIGHTS
// ---------------------------
//
//   Role        55%
//   Production  40%
//   Matchup      5%
//
// IMPORTANT
// ---------
// These final QB weights are PROVISIONAL.
//
// They are a starting hypothesis for historical validation, not a
// QB-calibrated or backtested result.
//
// We will validate:
//
//   - Role / Production / Matchup weight sensitivity
//   - relationship between SAGE score and actual fantasy outcome
//   - ranking quality
//   - score calibration
//   - recommendation thresholds
//
// The final score uses CONFIDENCE-ADJUSTED Role and Production.
//
// Matchup remains a separate contextual adjustment.
//
// This endpoint DOES NOT:
// - call Tank01 directly
// - rebuild the QB population
// - change QB component formulas
// - change QB confidence methodology
// - create START / FLEX / SIT recommendations yet
//
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_SEASON_TYPE =
  "reg";

const POSITION =
  "QB";

const CONFIDENCE_FUNCTION =
  "weekly-sage-qb-confidence";

/*
  weekly-sage-qb-confidence's core computation (buildQbConfidence) is
  required directly, in-process, rather than invoked over HTTP.

  This lets an optional prebuilt snapshot be forwarded down through
  the QB scoring chain -- no serialization, no self-fetch.

  fetchMatchup()/weekly-sage-player-matchup remains separate because
  matchup evidence has no dependency on the QB population snapshot.
*/
const {
  buildQbConfidence
} = require(
  "./weekly-sage-qb-confidence.js"
);

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

const MATCHUP_FUNCTION =
  "weekly-sage-player-matchup";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

/*
  PROVISIONAL QB V1 FINAL COMPOSITION.

  Frozen before historical QB validation.

  Do not tune these weights in response to individual historical
  players or weeks. Revisit only after the QB validation/backtest
  evidence set is complete.
*/
const QB_WEIGHTS = {
  role:
    0.55,

  production:
    0.40,

  matchup:
    0.05
};

const NEUTRAL_BASELINE =
  50;

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
      } catch (
        error
      ) {
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

async function fetchConfidence({
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
        CONFIDENCE_FUNCTION,

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

  const data =
    await fetchJson(
      url
    );

  if (
    !data ||
    data.evidenceType !==
      "weekly-sage-qb-confidence"
  ) {
    throw new Error(
      "Unexpected Weekly SAGE QB confidence schema."
    );
  }

  return data;
}

async function fetchMatchup({
  baseUrl,
  season,
  week,
  seasonType,
  team,
  position
}) {
  const url =
    buildUrl({
      baseUrl,

      functionName:
        MATCHUP_FUNCTION,

      params: {
        season,

        week:
          String(
            week
          ),

        seasonType,

        team,

        position
      }
    });

  const data =
    await fetchJson(
      url
    );

  if (
    !data ||
    data.evidenceType !==
      "weekly-sage-player-matchup"
  ) {
    throw new Error(
      "Unexpected Weekly SAGE matchup schema."
    );
  }

  return data;
}

/*
  Apply matchup confidence using the same SAGE uncertainty principle:

    adjusted =
      observed * confidence
      +
      neutral baseline * uncertainty

  Full matchup confidence leaves the score unchanged.
*/
function confidenceAdjustedScore(
  rawScore,
  confidenceWeight,
  baseline = NEUTRAL_BASELINE
) {
  const score =
    nullableNum(
      rawScore
    );

  if (
    score ===
    null
  ) {
    return null;
  }

  const confidence =
    clamp(
      nullableNum(
        confidenceWeight
      ) ??
      1,
      0,
      1
    );

  return round(
    (
      score *
      confidence
    ) +
    (
      baseline *
      (
        1 -
        confidence
      )
    ),
    1
  );
}

function contribution(
  score,
  weight
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

  return round(
    value *
    weight,
    2
  );
}

function sageLabel(
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
    90
  ) {
    return "Elite";
  }

  if (
    value >=
    80
  ) {
    return "Very Strong";
  }

  if (
    value >=
    70
  ) {
    return "Strong";
  }

  if (
    value >=
    60
  ) {
    return "Above Average";
  }

  if (
    value >=
    40
  ) {
    return "Average";
  }

  if (
    value >=
    25
  ) {
    return "Below Average";
  }

  return "Weak";
}

function confidenceLabel(
  weight
) {
  const value =
    nullableNum(
      weight
    );

  if (
    value ===
    null
  ) {
    return null;
  }

  if (
    value >=
    0.95
  ) {
    return "Full";
  }

  if (
    value >=
    0.80
  ) {
    return "High";
  }

  if (
    value >=
    0.60
  ) {
    return "Moderate";
  }

  if (
    value >=
    0.40
  ) {
    return "Limited";
  }

  if (
    value >
    0
  ) {
    return "Very Limited";
  }

  return "Insufficient";
}

function overallConfidence({
  role,
  production,
  matchup
}) {
  const roleValue =
    nullableNum(
      role
    );

  const productionValue =
    nullableNum(
      production
    );

  const matchupValue =
    nullableNum(
      matchup
    );

  if (
    roleValue ===
      null ||
    productionValue ===
      null ||
    matchupValue ===
      null
  ) {
    return null;
  }

  return round(
    (
      roleValue *
      QB_WEIGHTS.role
    ) +
    (
      productionValue *
      QB_WEIGHTS.production
    ) +
    (
      matchupValue *
      QB_WEIGHTS.matchup
    ),
    3
  );
}

function buildExplanation({
  player,
  finalScore,
  roleAdjusted,
  productionAdjusted,
  matchupAdjusted,
  matchup
}) {
  const name =
    player &&
    player.name
      ? player.name
      : "Player";

  const opponent =
    matchup &&
    matchup.opponent
      ? matchup.opponent
      : "the opponent";

  return (
    `${name} has a Weekly SAGE QB Score of ${finalScore}. ` +
    `The confidence-adjusted components are ${roleAdjusted} for Role, ` +
    `${productionAdjusted} for Production, and ${matchupAdjusted} ` +
    `for the matchup against ${opponent}. ` +
    `This provisional QB model weights Role at 55%, ` +
    `Production at 40%, and Matchup at 5%.`
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
        await buildQbFinalScore({
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
        "weekly-sage-qb-final-score failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not calculate Weekly SAGE QB final score.",

          detail:
            error.message
        }
      );
    }
  };

/*
  Core Weekly SAGE QB final-score computation.

  exports.handler above is a thin HTTP wrapper around this function.

  prebuiltSnapshot is OPTIONAL and forwarded to buildQbConfidence()
  only. fetchMatchup() is unrelated to the snapshot and remains
  independently retrieved.
*/
async function buildQbFinalScore({
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
    Retrieve confidence-adjusted QB Role and Production.
  */
  const confidence =
    await buildQbConfidence({
      baseUrl,
      season,
      targetWeek,
      seasonType,
      playerID,
      prebuiltSnapshot
    });

  const player =
    confidence.player ||
    {};

  if (
    player.position !==
    POSITION
  ) {
    throw statusError(
      400,
      {
        error:
          "QB final scoring requires a QB.",

        playerID,

        position:
          player.position ||
          null
      }
    );
  }

  if (
    !player.team
  ) {
    throw new Error(
      "QB confidence evidence did not include team."
    );
  }

  /*
    STEP 2
    ------
    Retrieve target-week matchup evidence.

    IMPORTANT:
    weekly-sage-player-matchup requires TEAM + POSITION.

    Do not pass playerID here.
  */
  const matchupData =
    await fetchMatchup({
      baseUrl,
      season,
      week:
        targetWeek,
      seasonType,
      team:
        player.team,
      position:
        POSITION
    });

  const matchup =
    matchupData
      .matchupEvidence ||
    {};

  /*
    ROLE
  */
  const rawRoleScore =
    nullableNum(
      confidence &&
      confidence.role &&
      confidence.role.rawScore
    );

  const roleConfidence =
    nullableNum(
      confidence &&
      confidence.role &&
      confidence.role.confidence &&
      confidence.role.confidence.weight
    );

  const adjustedRoleScore =
    nullableNum(
      confidence &&
      confidence.role &&
      confidence.role.adjustedScore
    );

  /*
    PRODUCTION
  */
  const rawProductionScore =
    nullableNum(
      confidence &&
      confidence.production &&
      confidence.production.rawScore
    );

  const productionConfidence =
    nullableNum(
      confidence &&
      confidence.production &&
      confidence.production.confidence &&
      confidence.production.confidence.weight
    );

  const adjustedProductionScore =
    nullableNum(
      confidence &&
      confidence.production &&
      confidence.production.adjustedScore
    );

  /*
    MATCHUP
  */
  const rawMatchupScore =
    nullableNum(
      matchup.score
    );

  const matchupConfidence =
    clamp(
      nullableNum(
        matchup &&
        matchup.confidence &&
        matchup.confidence.weight
      ) ??
      1,
      0,
      1
    );

  const adjustedMatchupScore =
    confidenceAdjustedScore(
      rawMatchupScore,
      matchupConfidence
    );

  if (
    adjustedRoleScore ===
      null ||
    adjustedProductionScore ===
      null ||
    adjustedMatchupScore ===
      null
  ) {
    throw statusError(
      422,
      {
        error:
          "One or more QB SAGE components are not ready for final composition.",

        components: {
          role:
            adjustedRoleScore,

          production:
            adjustedProductionScore,

          matchup:
            adjustedMatchupScore
        }
      }
    );
  }

  /*
    STEP 3
    ------
    Weighted first-pass QB SAGE composition.
  */
  const roleContribution =
    contribution(
      adjustedRoleScore,
      QB_WEIGHTS.role
    );

  const productionContribution =
    contribution(
      adjustedProductionScore,
      QB_WEIGHTS.production
    );

  const matchupContribution =
    contribution(
      adjustedMatchupScore,
      QB_WEIGHTS.matchup
    );

  const finalScore =
    round(
      roleContribution +
      productionContribution +
      matchupContribution,
      1
    );

  const finalConfidence =
    overallConfidence({
      role:
        roleConfidence ??
        0,

      production:
        productionConfidence ??
        0,

      matchup:
        matchupConfidence
    });

  return {
    evidenceType:
      "weekly-sage-qb-final-score",

    schemaVersion:
      1,

    generatedAt:
      new Date()
        .toISOString(),

    season,

    targetWeek,

    seasonType,

    player: {
      playerID:
        player.playerID ||
        playerID,

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
        POSITION,

      gamesUsed:
        player.gamesUsed ||
        null,

      weeksIncluded:
        player.weeksIncluded ||
        []
    },

    noLookAhead:
      confidence.noLookAhead ||
      null,

    upcomingGame:
      matchupData.playerContext ||
      null,

    methodology: {
      modelVersion:
        "qb-sage-v1",

      status:
        "Provisional pending QB historical weight validation.",

      weights:
        QB_WEIGHTS,

      neutralBaseline:
        NEUTRAL_BASELINE,

      philosophy:
        "Role establishes the opportunity baseline, Production measures conversion of opportunity, and Matchup adjusts the target-week outlook.",

      confidencePrinciple:
        "Score what the evidence says. Weight how much SAGE trusts the evidence.",

      important:
        "The final score uses confidence-adjusted Role, Production, and Matchup components. Final QB weights are not yet validated -- 55/40/5 is the Phase 1 provisional starting hypothesis, not a backtested result."
    },

    components: {
      role: {
        rawScore:
          rawRoleScore,

        confidence: {
          weight:
            roleConfidence,

          label:
            confidenceLabel(
              roleConfidence
            )
        },

        adjustedScore:
          adjustedRoleScore,

        weight:
          QB_WEIGHTS.role,

        weightedContribution:
          roleContribution
      },

      production: {
        rawScore:
          rawProductionScore,

        confidence: {
          weight:
            productionConfidence,

          label:
            confidenceLabel(
              productionConfidence
            )
        },

        adjustedScore:
          adjustedProductionScore,

        weight:
          QB_WEIGHTS.production,

        weightedContribution:
          productionContribution
      },

      matchup: {
        rawScore:
          rawMatchupScore,

        confidence: {
          weight:
            matchupConfidence,

          label:
            confidenceLabel(
              matchupConfidence
            )
        },

        adjustedScore:
          adjustedMatchupScore,

        weight:
          QB_WEIGHTS.matchup,

        weightedContribution:
          matchupContribution,

        opponent:
          matchup.opponent ||
          null,

        signal:
          matchup.signal ||
          null,

        label:
          matchup.label ||
          null,

        explanation:
          matchup.explanation ||
          null
      }
    },

    sage: {
      score:
        finalScore,

      label:
        sageLabel(
          finalScore
        ),

      confidence: {
        weight:
          finalConfidence,

        label:
          confidenceLabel(
            finalConfidence
          )
      },

      explanation:
        buildExplanation({
          player,
          finalScore,
          roleAdjusted:
            adjustedRoleScore,
          productionAdjusted:
            adjustedProductionScore,
          matchupAdjusted:
            adjustedMatchupScore,
          matchup
        })
    },

    recommendation:
      null,

    recommendationStatus: {
      ready:
        false,

      reason:
        "Validate QB final-score weights and historical outcomes before mapping scores to START / FLEX / SIT recommendations."
    },

    nextStep: {
      ready:
        true,

      reason:
        "Validate provisional QB SAGE scores against historical outcomes before locking Role / Production / Matchup weights."
    },

    architecture: {
      modelVersion:
        "qb-sage-v1",

      populationSource:
        "weekly-sage-qb-snapshot",

      benchmarkSource:
        "weekly-sage-qb-benchmarks",

      componentSource:
        "weekly-sage-qb-component-scores",

      confidenceSource:
        "weekly-sage-qb-confidence",

      matchupSource:
        "weekly-sage-player-matchup",

      populationRebuiltForThisPlayer:
        false,

      directTank01Calls:
        0
    },

    provenance: {
      modelVersion:
        "qb-sage-v1",

      rawRoleAndProduction:
        "weekly-sage-qb-component-scores",

      sampleConfidence:
        "weekly-sage-qb-confidence",

      matchup:
        "weekly-sage-player-matchup",

      peerPopulation:
        "weekly-sage-qb-snapshot",

      provisionalWeights:
        QB_WEIGHTS
    }
  };
}

exports.buildQbFinalScore =
  buildQbFinalScore;
