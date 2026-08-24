// netlify/functions/weekly-sage-wr-final-score.js
//
// WEEKLY SAGE — WR FINAL SCORE
//
// PURPOSE
// -------
// Compose the first complete Weekly SAGE score for WRs.
//
// SOURCES
// -------
//
//   weekly-sage-wr-confidence
//   weekly-sage-player-matchup
//
// WR SAGE v1 FINAL WEIGHTS
// ------------------------
//
//   Role        50%
//   Production  40%
//   Matchup     10%
//
// IMPORTANT
// ---------
// WR SAGE v1 weights have been validated as predictive via a completed
// 2025 Weeks 3-8 historical backtest (423 clean WR player-week
// observations across 6 independent weekly environments): pooled PPR
// Pearson ~0.398, Spearman ~0.425, with positive Role and Production
// component correlations.
//
// These weights have NOT been through held-out robustness testing
// (predetermined train/test splits with a decision bar) or formal
// weight-sensitivity comparison against alternative configurations.
// 50/40/10 is the original configuration, not a result selected by
// comparison -- do not describe it as robustness-validated or as the
// output of a weight-optimization process.
//
// The final score uses CONFIDENCE-ADJUSTED Role and Production.
//
// Matchup remains a separate contextual adjustment.
//
// This endpoint DOES NOT:
// - call Tank01 directly
// - rebuild the WR population
// - change WR component formulas
// - change WR confidence methodology
// - create START / FLEX / SIT recommendations yet
//
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_SEASON_TYPE =
  "reg";

const POSITION =
  "WR";

const CONFIDENCE_FUNCTION =
  "weekly-sage-wr-confidence";

/*
  weekly-sage-wr-confidence's core computation (buildWrConfidence) is
  required directly, in-process, rather than invoked over HTTP (see
  fetchConfidence() below, now unused but left in place for
  reference). This lets an optional prebuilt snapshot be forwarded
  down through it -- no serialization, no self-fetch.

  fetchMatchup()/weekly-sage-player-matchup is deliberately left
  UNCHANGED -- matchup evidence has no dependency on the WR
  population snapshot, so there is nothing to share there, and that
  file is outside the scope of this fix.
*/
const {
  buildWrConfidence
} = require(
  "./weekly-sage-wr-confidence.js"
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

const WR_WEIGHTS = {
  role:
    0.50,

  production:
    0.40,

  matchup:
    0.10
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
      "weekly-sage-wr-confidence"
  ) {
    throw new Error(
      "Unexpected Weekly SAGE WR confidence schema."
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
      WR_WEIGHTS.role
    ) +
    (
      productionValue *
      WR_WEIGHTS.production
    ) +
    (
      matchupValue *
      WR_WEIGHTS.matchup
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
    `${name} has a Weekly SAGE WR Score of ${finalScore}. ` +
    `The confidence-adjusted components are ${roleAdjusted} for Role, ` +
    `${productionAdjusted} for Production, and ${matchupAdjusted} ` +
    `for the matchup against ${opponent}. ` +
    `This WR model weights Role at 50%, ` +
    `Production at 40%, and Matchup at 10%, validated as predictive ` +
    `via a completed 2025 Weeks 3-8 historical backtest.`
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
        await buildWrFinalScore({
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
        "weekly-sage-wr-final-score failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not calculate Weekly SAGE WR final score.",

          detail:
            error.message
        }
      );
    }
  };

/*
  Core Weekly SAGE WR final-score computation, extracted additively.
  exports.handler above is now a thin wrapper around this function
  and produces byte-identical GET output to before this extraction.
  Mirrors weekly-sage-wr-benchmarks.js's own statusError()/
  prebuiltSnapshot pattern exactly.

  prebuiltSnapshot is OPTIONAL and forwarded to buildWrConfidence()
  only -- fetchMatchup() below is unrelated to the snapshot and
  stays exactly as it was.
*/
async function buildWrFinalScore({
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
        Retrieve confidence-adjusted WR Role and Production.
      */
      const confidence =
        await buildWrConfidence({
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
              "WR final scoring requires a WR.",

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
          "WR confidence evidence did not include team."
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
              "One or more WR SAGE components are not ready for final composition.",

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
        Weighted first-pass WR SAGE composition.
      */
      const roleContribution =
        contribution(
          adjustedRoleScore,
          WR_WEIGHTS.role
        );

      const productionContribution =
        contribution(
          adjustedProductionScore,
          WR_WEIGHTS.production
        );

      const matchupContribution =
        contribution(
          adjustedMatchupScore,
          WR_WEIGHTS.matchup
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
            "weekly-sage-wr-final-score",

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
              "wr-sage-v1",

            status:
              "WR SAGE v1 weights are validated as predictive via a completed 2025 Weeks 3-8 historical backtest. No held-out robustness testing or formal weight optimization has been performed.",

            weights:
              WR_WEIGHTS,

            neutralBaseline:
              NEUTRAL_BASELINE,

            philosophy:
              "Role establishes the opportunity baseline, Production measures conversion of opportunity, and Matchup adjusts the target-week outlook.",

            confidencePrinciple:
              "Score what the evidence says. Weight how much SAGE trusts the evidence.",

            important:
              "The final score uses confidence-adjusted Role, Production, and Matchup components. WR weights (50/40/10) have demonstrated real predictive signal in a completed historical backtest but have not been evaluated via held-out robustness testing or formal weight-sensitivity comparison against alternative configurations."
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
                WR_WEIGHTS.role,

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
                WR_WEIGHTS.production,

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
                WR_WEIGHTS.matchup,

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
              "WR weights have backtest-confirmed predictive signal, but this endpoint does not itself assign START / FLEX / SIT recommendations -- see weekly-sage-wr-leaderboard for calibrated thresholds."
          },

          nextStep: {
            ready:
              true,

            reason:
              "WR weights (50/40/10) are backtest-validated as predictive. They have not undergone held-out robustness testing or formal optimization against alternative configurations -- treat as stable but revisitable pending that additional evidence."
          },

          architecture: {
            modelVersion:
              "wr-sage-v1",

            populationSource:
              "weekly-sage-wr-snapshot",

            benchmarkSource:
              "weekly-sage-wr-benchmarks",

            componentSource:
              "weekly-sage-wr-component-scores",

            confidenceSource:
              "weekly-sage-wr-confidence",

            matchupSource:
              "weekly-sage-player-matchup",

            populationRebuiltForThisPlayer:
              false,

            directTank01Calls:
              0
          },

          provenance: {
            modelVersion:
              "wr-sage-v1",

            rawRoleAndProduction:
              "weekly-sage-wr-component-scores",

            sampleConfidence:
              "weekly-sage-wr-confidence",

            matchup:
              "weekly-sage-player-matchup",

            peerPopulation:
              "weekly-sage-wr-snapshot",

            activeWeights:
              WR_WEIGHTS
          }
        };
}

exports.buildWrFinalScore =
  buildWrFinalScore;
