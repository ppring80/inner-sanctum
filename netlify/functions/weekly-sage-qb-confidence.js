// netlify/functions/weekly-sage-qb-confidence.js
//
// WEEKLY SAGE — QB CONFIDENCE ADJUSTMENT
//
// PURPOSE
// -------
// Apply evidence maturity to the provisional raw QB Role and Production
// component scores without changing what the observed evidence says.
//
// SOURCE
// ------
//
//   weekly-sage-qb-component-scores
//
// PRINCIPLE
// ---------
// Score what the evidence says.
// Weight how much SAGE trusts the evidence.
//
// Confidence is NOT a second performance score.
// It measures how mature the pre-game evidence sample is.
//
// ADJUSTMENT
// ----------
//
//   adjustedScore =
//     rawScore * confidence
//     +
//     neutralBaseline * (1 - confidence)
//
// A mature sample leaves the observed score unchanged.
// A smaller sample pulls the observed score modestly toward neutral (50).
//
// QB SAMPLE MATURITY — V1 HYPOTHESIS
// ---------------------------------
// Role should stabilize relatively quickly because passing volume,
// rushing involvement and offensive snap share become visible early.
//
// Production receives a slightly more conservative maturity curve because
// touchdowns, efficiency and rushing scoring can still swing in small samples.
//
// ROLE CONFIDENCE
//   2 games  0.75
//   3 games  0.85
//   4 games  0.92
//   5 games  0.97
//   6+ games 1.00
//
// PRODUCTION CONFIDENCE
//   2 games  0.70
//   3 games  0.80
//   4 games  0.88
//   5 games  0.94
//   6 games  0.97
//   7+ games 1.00
//
// IMPORTANT
// ---------
// These confidence curves are provisional and intentionally simple.
// They will be validated during the QB historical backtest.
//
// This endpoint DOES NOT:
// - call Tank01 directly
// - rebuild the QB population
// - change QB component formulas
// - define final Role / Production / Matchup weights
// - create START / FLEX / SIT recommendations
//
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_SEASON_TYPE =
  "reg";

const POSITION =
  "QB";

const COMPONENT_FUNCTION =
  "weekly-sage-qb-component-scores";

/*
  weekly-sage-qb-component-scores's core computation
  (buildQbComponentScores) is required directly, in-process, rather
  than invoked over HTTP (see fetchComponents() below, now unused
  but left in place for reference). This lets an optional prebuilt
  snapshot be forwarded down through it -- no serialization, no
  self-fetch.
*/
const {
  buildQbComponentScores
} = require(
  "./weekly-sage-qb-component-scores.js"
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

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

const NEUTRAL_BASELINE =
  50;

const ROLE_CONFIDENCE_BY_GAMES = {
  2: 0.75,
  3: 0.85,
  4: 0.92,
  5: 0.97
};

const PRODUCTION_CONFIDENCE_BY_GAMES = {
  2: 0.70,
  3: 0.80,
  4: 0.88,
  5: 0.94,
  6: 0.97
};

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

async function fetchComponents({
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
        COMPONENT_FUNCTION,

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
      "weekly-sage-qb-component-scores"
  ) {
    throw new Error(
      "Unexpected Weekly SAGE QB component-score schema."
    );
  }

  return data;
}

function roleConfidence(
  gamesUsed
) {
  const games =
    Math.floor(
      nullableNum(
        gamesUsed
      ) ||
      0
    );

  if (
    games >= 6
  ) {
    return 1;
  }

  if (
    games <= 1
  ) {
    return 0.55;
  }

  return (
    ROLE_CONFIDENCE_BY_GAMES[
      games
    ] ||
    0.55
  );
}

function productionConfidence(
  gamesUsed
) {
  const games =
    Math.floor(
      nullableNum(
        gamesUsed
      ) ||
      0
    );

  if (
    games >= 7
  ) {
    return 1;
  }

  if (
    games <= 1
  ) {
    return 0.50;
  }

  return (
    PRODUCTION_CONFIDENCE_BY_GAMES[
      games
    ] ||
    0.50
  );
}

function evidenceCompleteness(
  component
) {
  const availableWeight =
    nullableNum(
      component &&
      component.availableWeight
    );

  if (
    availableWeight ===
    null
  ) {
    return 1;
  }

  return clamp(
    availableWeight,
    0,
    1
  );
}

function combineConfidence(
  sampleConfidence,
  completeness
) {
  return round(
    clamp(
      sampleConfidence *
      completeness,
      0,
      1
    ),
    3
  );
}

function confidenceAdjustedScore(
  rawScore,
  confidence,
  baseline = NEUTRAL_BASELINE
) {
  const score =
    nullableNum(
      rawScore
    );

  const weight =
    nullableNum(
      confidence
    );

  if (
    score === null ||
    weight === null
  ) {
    return null;
  }

  const boundedConfidence =
    clamp(
      weight,
      0,
      1
    );

  return round(
    (
      score *
      boundedConfidence
    ) +
    (
      baseline *
      (
        1 -
        boundedConfidence
      )
    ),
    1
  );
}

function confidenceLabel(
  weight
) {
  const value =
    nullableNum(
      weight
    );

  if (
    value === null
  ) {
    return null;
  }

  if (
    value >= 0.95
  ) {
    return "Full";
  }

  if (
    value >= 0.80
  ) {
    return "High";
  }

  if (
    value >= 0.60
  ) {
    return "Moderate";
  }

  if (
    value >= 0.40
  ) {
    return "Limited";
  }

  if (
    value > 0
  ) {
    return "Very Limited";
  }

  return "Insufficient";
}

function buildComponentConfidence({
  rawComponent,
  sampleConfidence
}) {
  const rawScore =
    nullableNum(
      rawComponent &&
      rawComponent.rawScore
    );

  const completeness =
    evidenceCompleteness(
      rawComponent
    );

  const finalConfidence =
    combineConfidence(
      sampleConfidence,
      completeness
    );

  return {
    rawScore,

    confidence: {
      weight:
        finalConfidence,

      label:
        confidenceLabel(
          finalConfidence
        ),

      sampleMaturity:
        round(
          sampleConfidence,
          3
        ),

      evidenceCompleteness:
        round(
          completeness,
          3
        )
    },

    adjustedScore:
      confidenceAdjustedScore(
        rawScore,
        finalConfidence
      )
  };
}

function buildExplanation({
  player,
  gamesUsed,
  role,
  production
}) {
  const name =
    player &&
    player.name
      ? player.name
      : "Player";

  return (
    `${name} has ${gamesUsed} prior games of QB evidence. ` +
    `Role confidence is ${role.confidence.weight} and Production confidence is ${production.confidence.weight}. ` +
    `The raw Role Score of ${role.rawScore} adjusts to ${role.adjustedScore}, ` +
    `while the raw Production Score of ${production.rawScore} adjusts to ${production.adjustedScore}. ` +
    `Lower-confidence observations move modestly toward the neutral SAGE baseline of ${NEUTRAL_BASELINE}.`
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
      targetWeek < 2 ||
      targetWeek > 18
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
        await buildQbConfidence({
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
        "weekly-sage-qb-confidence failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not apply Weekly SAGE QB confidence adjustment.",

          detail:
            error.message
        }
      );
    }
  };

/*
  Core Weekly SAGE QB confidence computation.
  exports.handler above is a thin HTTP wrapper around this function.
  Mirrors weekly-sage-qb-benchmarks.js's statusError()/prebuiltSnapshot
  pattern exactly.

  prebuiltSnapshot is OPTIONAL and forwarded straight through to
  buildQbComponentScores() -- this function does not use it directly
  itself, only passes it one layer further down the chain.
*/
async function buildQbConfidence({
  baseUrl,
  season,
  targetWeek,
  seasonType,
  playerID,
  prebuiltSnapshot
}) {
  const components =
    await buildQbComponentScores({
      baseUrl,
      season,
      targetWeek,
      seasonType,
      playerID,
      prebuiltSnapshot
    });

  const player =
    components.player ||
    {};

  if (
    player.position !==
    POSITION
  ) {
    throw statusError(
      400,
      {
        error:
          "QB confidence adjustment requires a QB.",

        playerID,

        position:
          player.position ||
          null
      }
    );
  }

  const gamesUsed =
    Math.floor(
      nullableNum(
        player.gamesUsed
      ) ||
      0
    );

  const rawRole =
    components.components &&
    components.components.role
      ? components.components.role
      : null;

  const rawProduction =
    components.components &&
    components.components.production
      ? components.components.production
      : null;

  if (
    !rawRole ||
    !rawProduction
  ) {
    throw statusError(
      422,
      {
        error:
          "QB component evidence is incomplete.",

        playerID
      }
    );
  }

  const roleSampleConfidence =
    roleConfidence(
      gamesUsed
    );

  const productionSampleConfidence =
    productionConfidence(
      gamesUsed
    );

  const role =
    buildComponentConfidence({
      rawComponent:
        rawRole,

      sampleConfidence:
        roleSampleConfidence
    });

  const production =
    buildComponentConfidence({
      rawComponent:
        rawProduction,

      sampleConfidence:
        productionSampleConfidence
    });

  if (
    role.adjustedScore ===
      null ||
    production.adjustedScore ===
      null
  ) {
    throw statusError(
      422,
      {
        error:
          "One or more QB confidence-adjusted component scores could not be calculated.",

        role,

        production
      }
    );
  }

  return {
    evidenceType:
      "weekly-sage-qb-confidence",

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

      gamesUsed,

      weeksIncluded:
        player.weeksIncluded ||
        []
    },

    noLookAhead:
      components.noLookAhead ||
      null,

    methodology: {
      position:
        POSITION,

      status:
        "First-pass provisional QB confidence methodology.",

      neutralBaseline:
        NEUTRAL_BASELINE,

      confidencePrinciple:
        "Score what the evidence says. Weight how much SAGE trusts the evidence.",

      adjustmentFormula:
        "adjustedScore = rawScore * confidence + neutralBaseline * (1 - confidence)",

      roleSampleMaturity: {
        oneGame:
          0.55,

        twoGames:
          0.75,

        threeGames:
          0.85,

        fourGames:
          0.92,

        fiveGames:
          0.97,

        sixOrMoreGames:
          1.00
      },

      productionSampleMaturity: {
        oneGame:
          0.50,

        twoGames:
          0.70,

        threeGames:
          0.80,

        fourGames:
          0.88,

        fiveGames:
          0.94,

        sixGames:
          0.97,

        sevenOrMoreGames:
          1.00
      },

      evidenceCompleteness:
        "Component availableWeight is multiplied by sample maturity. With complete component evidence, availableWeight is 1.0 and does not reduce confidence.",

      important:
        "Confidence adjusts trust in the observed component score. It does not change the underlying QB Role or Production methodology."
    },

    role: {
      rawScore:
        role.rawScore,

      confidence:
        role.confidence,

      adjustedScore:
        role.adjustedScore
    },

    production: {
      rawScore:
        production.rawScore,

      confidence:
        production.confidence,

      adjustedScore:
        production.adjustedScore
    },

    explanation:
      buildExplanation({
        player,
        gamesUsed,
        role,
        production
      }),

    recommendation:
      null,

    nextStep: {
      ready:
        true,

      reason:
        "QB Role and Production confidence adjustments are available. Validate mature and smaller-sample QB profiles before composing the first final QB SAGE score."
    },

    architecture: {
      populationSource:
        "weekly-sage-qb-snapshot",

      benchmarkSource:
        "weekly-sage-qb-benchmarks",

      componentSource:
        "weekly-sage-qb-component-scores",

      populationRebuiltForThisPlayer:
        false,

      directTank01Calls:
        0
    },

    provenance: {
      rawRoleAndProduction:
        "weekly-sage-qb-component-scores",

      peerPopulation:
        "weekly-sage-qb-snapshot",

      benchmarkPercentiles:
        "weekly-sage-qb-benchmarks"
    }
  };
}

exports.buildQbConfidence =
  buildQbConfidence;
