// netlify/functions/weekly-sage-te-final-score.js
//
// WEEKLY SAGE — TE FINAL SCORE
//
// PURPOSE
// -------
// Compose the first complete Weekly SAGE score for WRs.
//
// SOURCES
// -------
//
//   weekly-sage-te-confidence
//   weekly-sage-player-matchup
//
// TE SAGE v1 FINAL WEIGHTS
// ------------------------
//
//   Role        55%
//   Production  40%
//   Matchup      5%
//
// IMPORTANT
// ---------
// These weights have been validated as predictive via a completed
// 2025 regular-season historical backtest: Weeks 8-17 (10 weeks; the
// requested Weeks 5-7 failed at retrieval time due to a missing
// weekly-sage-te-snapshot Blobs cache entry for those weeks and were
// excluded, not silently zero-filled), 381 clean TE player-week
// observations, via weekly-sage-te-backtest.
//
// Results: pooled SAGE-vs-actual correlation of Pearson ~0.36-0.42 and
// Spearman ~0.41-0.45 depending on scoring system (standard/half-PPR/
// PPR), with positive Role and Production component correlations
// (~0.33-0.40) and a smaller positive Matchup correlation (~0.14).
//
// This backtest does NOT constitute held-out robustness testing (no
// train/test splits, no decision bar) and does NOT represent weight
// optimization -- no alternative Role/Production/Matchup combination
// has been evaluated against this or any other TE data. 55/40/5 is
// confirmed predictive, not confirmed optimal. Do not describe these
// weights as robustness-validated or as superior to any untested
// alternative.
//
// The final score uses CONFIDENCE-ADJUSTED Role and Production.
//
// Matchup remains a separate contextual adjustment.
//
// This endpoint DOES NOT:
// - call Tank01 directly
// - rebuild the TE population
// - change TE component formulas
// - change TE confidence methodology
// - create START / FLEX / SIT recommendations yet
//
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_SEASON_TYPE =
  "reg";

const POSITION =
  "TE";

const CONFIDENCE_FUNCTION =
  "weekly-sage-te-confidence";

/*
  weekly-sage-te-confidence's core computation (buildTeConfidence) is
  required directly, in-process, rather than invoked over HTTP (see
  fetchConfidence() below, now unused but left in place for
  reference). This lets an optional prebuilt snapshot be forwarded
  down through it -- no serialization, no self-fetch.

  fetchMatchup()/weekly-sage-player-matchup is deliberately left
  UNCHANGED -- matchup evidence has no dependency on the TE
  population snapshot, so there is nothing to share there, and that
  file is outside the scope of this fix.
*/
const {
  buildTeConfidence
} = require(
  "./weekly-sage-te-confidence.js"
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

// Validated as predictive via a completed 2025 regular-season backtest
// (Weeks 8-17, 381 clean observations). See the header comment above.
// Not held-out robustness tested and not weight-optimized -- no
// alternative Role/Production/Matchup combination has been evaluated.
const TE_WEIGHTS = {
  role:
    0.55,

  production:
    0.40,

  matchup:
    0.05
};

/*
  Validation evidence for the TE SAGE v1 weights, sourced directly
  from a weekly-sage-te-backtest run against the 2025 regular season.
  Weeks 5-7 failed at retrieval time (missing weekly-sage-te-snapshot
  cache entry for those weeks) and are excluded here, not silently
  zero-filled -- the evaluated window is Weeks 8-17 only. This is
  descriptive backtest evidence, not held-out robustness testing and
  not a weight-optimization result.
*/
const TE_VALIDATION_EVIDENCE = {
  method:
    "weekly-sage-te-backtest",

  season:
    "2025",

  seasonType:
    "reg",

  weeksRequested:
    "5-17",

  weeksEvaluated:
    "8-17",

  weeksExcluded: {
    weeks:
      "5-7",

    reason:
      "Missing weekly-sage-te-snapshot cache entry for these weeks at retrieval time."
  },

  observations:
    381,

  correlations: {
    standard: {
      pearson:
        0.364,

      spearman:
        0.414
    },

    halfPPR: {
      pearson:
        0.4,

      spearman:
        0.432
    },

    ppr: {
      pearson:
        0.422,

      spearman:
        0.446
    }
  },

  componentCorrelations: {
    role:
      "0.335-0.396 across scoring systems",

    production:
      "0.354-0.400 across scoring systems",

    matchup:
      "0.141-0.145 across scoring systems"
  },

  robustnessTestingPerformed:
    false,

  weightOptimizationPerformed:
    false
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
    const detail =
      data &&
      (
        data.detail ||
        data.error
      )
        ? (
            data.detail ||
            data.error
          )
        : `HTTP ${response.status}`;

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
      "weekly-sage-te-confidence"
  ) {
    throw new Error(
      "Unexpected Weekly SAGE TE confidence schema."
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
  Apply matchup confidence the same way SAGE handles uncertainty
  elsewhere:

    adjusted =
      observed * confidence
      +
      neutral baseline * uncertainty

  If matchup confidence is full, the score is unchanged.
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
      TE_WEIGHTS.role
    ) +
    (
      productionValue *
      TE_WEIGHTS.production
    ) +
    (
      matchupValue *
      TE_WEIGHTS.matchup
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
    `${name} has a Weekly SAGE TE Score of ${finalScore}. ` +
    `The confidence-adjusted components are ${roleAdjusted} for Role, ` +
    `${productionAdjusted} for Production, and ${matchupAdjusted} ` +
    `for the matchup against ${opponent}. ` +
    `This TE model weights Role at 55%, ` +
    `Production at 40%, and Matchup at 5%, validated as predictive ` +
    `via a completed 2025 Weeks 8-17 historical backtest.`
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
        await buildTeFinalScore({
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
        "weekly-sage-te-final-score failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not calculate Weekly SAGE TE final score.",

          detail:
            error.message
        }
      );
    }
  };

/*
  Core Weekly SAGE TE final-score computation, extracted additively.
  exports.handler above is now a thin wrapper around this function
  and produces byte-identical GET output to before this extraction.
  Mirrors weekly-sage-te-benchmarks.js's own statusError()/
  prebuiltSnapshot pattern exactly.

  prebuiltSnapshot is OPTIONAL and forwarded to buildTeConfidence()
  only -- fetchMatchup() below is unrelated to the snapshot and
  stays exactly as it was.
*/
async function buildTeFinalScore({
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
        Retrieve confidence-adjusted TE Role and Production.
      */
      const confidence =
        await buildTeConfidence({
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
              "TE final scoring requires a TE.",

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
          "TE confidence evidence did not include team."
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
              "One or more TE SAGE components are not ready for final composition.",

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
        Weighted first-pass TE SAGE composition.
      */
      const roleContribution =
        contribution(
          adjustedRoleScore,
          TE_WEIGHTS.role
        );

      const productionContribution =
        contribution(
          adjustedProductionScore,
          TE_WEIGHTS.production
        );

      const matchupContribution =
        contribution(
          adjustedMatchupScore,
          TE_WEIGHTS.matchup
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
            "weekly-sage-te-final-score",

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
              "te-sage-v1",

            status:
              "Validated as predictive via a completed 2025 regular-season historical backtest (Weeks 8-17, 381 clean observations). No held-out robustness testing or weight optimization has been performed.",

            weights:
              TE_WEIGHTS,

            neutralBaseline:
              NEUTRAL_BASELINE,

            philosophy:
              "Role establishes the opportunity baseline, Production measures conversion of opportunity, and Matchup adjusts the target-week outlook.",

            confidencePrinciple:
              "Score what the evidence says. Weight how much SAGE trusts the evidence.",

            important:
              "The final score uses confidence-adjusted Role, Production, and Matchup components. TE weights (55/40/5) are supported by a completed 2025 Weeks 8-17 historical backtest (381 clean observations) confirming a positive predictive relationship. This does not represent held-out robustness testing, weight optimization, or evidence that 55/40/5 outperforms any untested alternative."
          },

          validationEvidence:
            TE_VALIDATION_EVIDENCE,

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
                TE_WEIGHTS.role,

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
                TE_WEIGHTS.production,

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
                TE_WEIGHTS.matchup,

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
              "TE weights have backtest-confirmed predictive signal (2025 Weeks 8-17), but this endpoint does not itself assign START / FLEX / SIT recommendations -- see weekly-sage-te-leaderboard for threshold status."
          },

          nextStep: {
            ready:
              true,

            reason:
              "TE weights (55/40/5) are backtest-validated as predictive. They have not undergone held-out robustness testing or weight optimization against alternative configurations -- treat as stable but revisitable pending that additional evidence."
          },

          architecture: {
            modelVersion:
              "te-sage-v1",

            populationSource:
              "weekly-sage-te-snapshot",

            benchmarkSource:
              "weekly-sage-te-benchmarks",

            componentSource:
              "weekly-sage-te-component-scores",

            confidenceSource:
              "weekly-sage-te-confidence",

            matchupSource:
              "weekly-sage-player-matchup",

            populationRebuiltForThisPlayer:
              false,

            directTank01Calls:
              0
          },

          provenance: {
            modelVersion:
              "te-sage-v1",

            rawRoleAndProduction:
              "weekly-sage-te-component-scores",

            sampleConfidence:
              "weekly-sage-te-confidence",

            matchup:
              "weekly-sage-player-matchup",

            peerPopulation:
              "weekly-sage-te-snapshot",

            activeWeights:
              TE_WEIGHTS
          }
        };
}

exports.buildTeFinalScore =
  buildTeFinalScore;
