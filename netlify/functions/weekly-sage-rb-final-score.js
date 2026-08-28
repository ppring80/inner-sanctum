// netlify/functions/weekly-sage-rb-final-score.js
//
// WEEKLY SAGE — FINAL RB SCORE
//
// PURPOSE
// -------
// Compose the validated Weekly SAGE RB components:
//
//   ROLE        55%
//   PRODUCTION  40%
//   MATCHUP      5%
//
// RB SAGE v2
// ----------
// Selected after historical sensitivity testing on the frozen
// 2025 Weeks 5-17 RB backtest (124 clean player-week observations).
//
// RB SAGE v1 remains preserved as the historical baseline:
//   ROLE        45%
//   PRODUCTION  35%
//   MATCHUP     20%
//
// v2 status:
//   Provisional pending broader multi-season / out-of-sample validation.
//
// using confidence-adjusted component scores.
//
// ARCHITECTURE
// ------------
//
// weekly-sage-rb-snapshot
//          ↓
// weekly-sage-rb-benchmarks
//          ↓
// weekly-sage-rb-component-scores
//          ↓
// weekly-sage-rb-confidence
//          ↓
// THIS FUNCTION
//
// Matchup comes from:
//
// weekly-sage-player-matchup
//
// RECOMMENDATIONS
// ---------------
// RB SAGE v2 consumer recommendation thresholds:
//
//   START  SAGE >= 65
//   FLEX   SAGE >= 55 and < 65
//   SIT    SAGE < 55
//
// Selected after historical recommendation validation on the frozen
// 2025 Weeks 5-17 RB backtest (124 clean player-week observations).
//
// Recommendation status:
//   Provisional pending broader multi-season / out-of-sample validation.
//
// IMPORTANT
// ---------
// SAGE Score and lineup recommendation remain separate concepts.
//
// The SAGE Score measures the strength of the underlying evidence.
// START / FLEX / SIT provides a simple consumer interpretation of
// that score.
//
// This function DOES NOT:
// - rebuild the RB population
// - call Tank01 for the entire RB universe
// - change Role or Production methodology
//
// PRINCIPLE
// ---------
// Score what the evidence says.
// Weight how much SAGE trusts the evidence.
//
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_SEASON_TYPE = "reg";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

const SAGE_MODEL_VERSION =
  "rb-sage-v2";

const FINAL_WEIGHTS = {
  role: 0.55,
  production: 0.40,
  matchup: 0.05
};

const RECOMMENDATION_THRESHOLDS = {
  start: 65,
  flex: 55
};

const RECOMMENDATION_VERSION =
  "rb-sage-recommendations-v1";

const PREVIOUS_WEIGHTS = {
  version: "rb-sage-v1",
  role: 0.45,
  production: 0.35,
  matchup: 0.20
};

const CONFIDENCE_FUNCTION =
  "weekly-sage-rb-confidence";

const MATCHUP_FUNCTION =
  "weekly-sage-player-matchup";

const {
  buildRbConfidence
} = require(
  "./weekly-sage-rb-confidence"
);

const {
  buildPlayerMatchup
} = require(
  "./weekly-sage-player-matchup"
);

const NEUTRAL_BASELINE = 50;

function num(value) {
  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

function round(
  value,
  digits = 1
) {
  const n =
    Number(value);

  if (
    !Number.isFinite(n)
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
    ) / factor
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

async function fetchJson(url) {
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

  if (!response.ok) {
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
          String(week),
        seasonType,
        playerID
      }
    });

  const data =
    await fetchJson(url);

  if (
    !data ||
    data.evidenceType !==
      "weekly-sage-rb-confidence"
  ) {
    throw new Error(
      "Unexpected RB confidence schema."
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
          String(week),
        seasonType,
        team,
        position
      }
    });

  const data =
    await fetchJson(url);

  if (
    !data ||
    data.evidenceType !==
      "weekly-sage-player-matchup"
  ) {
    throw new Error(
      "Unexpected player-matchup schema."
    );
  }

  return data;
}

/*
  Matchup already provides its own evidence-confidence weight.

  Apply the same SAGE uncertainty principle:

    adjusted =
      observed × confidence
      +
      neutral baseline × uncertainty

  If confidence is full (1.0), nothing changes.

  If matchup confidence is lower, the matchup moves toward 50
  rather than being allowed to over-influence the final score.
*/
function confidenceAdjustedScore(
  rawScore,
  confidenceWeight,
  baseline = NEUTRAL_BASELINE
) {
  const score =
    num(rawScore);

  if (
    score === null
  ) {
    return null;
  }

  const confidence =
    clamp(
      num(confidenceWeight) ??
      1,
      0,
      1
    );

  return round(
    score * confidence +
    baseline *
      (
        1 -
        confidence
      ),
    1
  );
}

function contribution(
  score,
  weight
) {
  const value =
    num(score);

  if (
    value === null
  ) {
    return null;
  }

  return round(
    value *
    weight,
    2
  );
}

function scoreLabel(score) {
  const value =
    num(score);

  if (
    value === null
  ) {
    return null;
  }

  if (
    value >= 90
  ) {
    return "Elite";
  }

  if (
    value >= 80
  ) {
    return "Very Strong";
  }

  if (
    value >= 70
  ) {
    return "Strong";
  }

  if (
    value >= 60
  ) {
    return "Above Average";
  }

  if (
    value >= 40
  ) {
    return "Average";
  }

  if (
    value >= 25
  ) {
    return "Below Average";
  }

  return "Weak";
}

function recommendationFromScore(score) {
  const value =
    num(score);

  if (
    value === null
  ) {
    return null;
  }

  if (
    value >=
    RECOMMENDATION_THRESHOLDS.start
  ) {
    return {
      recommendation:
        "START",

      threshold:
        RECOMMENDATION_THRESHOLDS.start,

      explanation:
        `SAGE Score ${value} meets the validated START threshold of ${RECOMMENDATION_THRESHOLDS.start}.`
    };
  }

  if (
    value >=
    RECOMMENDATION_THRESHOLDS.flex
  ) {
    return {
      recommendation:
        "FLEX",

      threshold:
        RECOMMENDATION_THRESHOLDS.flex,

      explanation:
        `SAGE Score ${value} falls in the validated FLEX range of ${RECOMMENDATION_THRESHOLDS.flex} through ${RECOMMENDATION_THRESHOLDS.start - 0.1}.`
    };
  }

  return {
    recommendation:
      "SIT",

    threshold:
      RECOMMENDATION_THRESHOLDS.flex,

    explanation:
      `SAGE Score ${value} is below the validated FLEX threshold of ${RECOMMENDATION_THRESHOLDS.flex}.`
  };
}

function confidenceLabel(
  weight
) {
  const value =
    num(weight);

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

function overallConfidence({
  role,
  production,
  matchup
}) {
  /*
    Confidence follows the same 55 / 40 / 5 influence
    structure as the SAGE score itself.

    This is NOT another score adjustment.

    It is simply a user-facing measure of how mature the
    evidence behind the final score is.
  */

  const value =
    (
      role *
      FINAL_WEIGHTS.role
    ) +
    (
      production *
      FINAL_WEIGHTS.production
    ) +
    (
      matchup *
      FINAL_WEIGHTS.matchup
    );

  return round(
    value,
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
    `${name} has a Weekly SAGE Score of ${finalScore}. ` +
    `The confidence-adjusted components are ` +
    `${roleAdjusted} for Role, ` +
    `${productionAdjusted} for Production, and ` +
    `${matchupAdjusted} for the matchup against ${opponent}. ` +
    `Role and Production account for 95% of the model, ` +
    `while matchup contributes 5%.`
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


async function buildRbFinalScore({
  baseUrl,
  season,
  week,
  seasonType = DEFAULT_SEASON_TYPE,
  playerID,
  prebuiltSnapshot = null,
  prebuiltScheduleContext = null,
  prebuiltSchedule = null,
  prebuiltMatchupDefense = null
}) {
      /*
        STEP 1
        ------
        Fetch confidence-adjusted Role + Production.

        This path now uses the snapshot-backed benchmark layer,
        so it does NOT rebuild the 68-player RB universe.
      */
      const confidence =
        await buildRbConfidence({
          baseUrl,
          season,
          week,
          seasonType,
          playerID,
          prebuiltSnapshot,
          prebuiltScheduleContext
        });

      const player =
        confidence.player ||
        {};

      if (
        player.position !==
        "RB"
      ) {
        const error = new Error(
          "Final RB SAGE scoring requires an RB."
        );
        error.rbFinalScoreStatusCode = 400;
        throw error;
      }

      if (
        !player.team
      ) {
        throw new Error(
          "RB confidence evidence did not include team."
        );
      }

      /*
        STEP 2
        ------
        Fetch only this player's Week matchup.

        No RB-universe population rebuild occurs here.
      */
      const matchupData =
        await buildPlayerMatchup({
          baseUrl,
          season,
          week,
          seasonType,
          team:
            player.team,
          position:
            player.position,
          prebuiltSchedule,
          prebuiltMatchupDefense
        });

      const matchup =
        matchupData
          .matchupEvidence ||
        {};

      /*
        ROLE
      */
      const rawRoleScore =
        num(
          confidence.role &&
          confidence.role.rawScore
        );

      const roleConfidence =
        num(
          confidence.role &&
          confidence.role.confidence &&
          confidence.role.confidence.weight
        );

      const adjustedRoleScore =
        num(
          confidence.role &&
          confidence.role.adjustedScore
        );

      /*
        PRODUCTION
      */
      const rawProductionScore =
        num(
          confidence.production &&
          confidence.production.rawScore
        );

      const productionConfidence =
        num(
          confidence.production &&
          confidence.production.confidence &&
          confidence.production.confidence.weight
        );

      const adjustedProductionScore =
        num(
          confidence.production &&
          confidence.production.adjustedScore
        );

      /*
        MATCHUP
      */
      const rawMatchupScore =
        num(
          matchup.score
        );

      const matchupConfidence =
        clamp(
          num(
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
        adjustedRoleScore === null ||
        adjustedProductionScore === null ||
        adjustedMatchupScore === null
      ) {
        const error = new Error(
          "One or more SAGE components are not ready for final composition."
        );
        error.rbFinalScoreStatusCode = 422;
        error.rbFinalScoreDetails = {
          components: {
            role:
              adjustedRoleScore,
            production:
              adjustedProductionScore,
            matchup:
              adjustedMatchupScore
          }
        };
        throw error;
      }

      /*
        STEP 3
        ------
        Weighted SAGE composition.
      */
      const roleContribution =
        contribution(
          adjustedRoleScore,
          FINAL_WEIGHTS.role
        );

      const productionContribution =
        contribution(
          adjustedProductionScore,
          FINAL_WEIGHTS.production
        );

      const matchupContribution =
        contribution(
          adjustedMatchupScore,
          FINAL_WEIGHTS.matchup
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

      const recommendation =
        recommendationFromScore(
          finalScore
        );

      return {
          evidenceType:
            "weekly-sage-rb-final-score",

          schemaVersion:
            3,

          generatedAt:
            new Date()
              .toISOString(),

          season,

          targetWeek:
            week,

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

            position:
              "RB"
          },

          noLookAhead:
            confidence.noLookAhead,

          upcomingGame:
            matchupData.playerContext ||
            null,

          methodology: {
            modelVersion:
              SAGE_MODEL_VERSION,

            weights:
              FINAL_WEIGHTS,

            previousBaseline:
              PREVIOUS_WEIGHTS,

            validationBasis: {
              season:
                "2025",

              weeks:
                "5-17",

              cleanPlayerWeekObservations:
                124,

              status:
                "Provisional pending broader multi-season / out-of-sample validation."
            },

            neutralBaseline:
              NEUTRAL_BASELINE,

            philosophy:
              "Role establishes the baseline, Production measures conversion of opportunity, and Matchup adjusts the outlook. Confidence determines how strongly SAGE trusts each observed component.",

            confidencePrinciple:
              "Score what the evidence says. Weight how much SAGE trusts the evidence.",

            important:
              "The final score uses confidence-adjusted components. Raw component scores remain preserved for transparency."
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
                FINAL_WEIGHTS.role,

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
                FINAL_WEIGHTS.production,

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
                FINAL_WEIGHTS.matchup,

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
              scoreLabel(
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

          recommendation: {
            label:
              recommendation.recommendation,

            explanation:
              recommendation.explanation
          },

          recommendationStatus: {
            ready:
              true,

            version:
              RECOMMENDATION_VERSION,

            modelVersion:
              SAGE_MODEL_VERSION,

            thresholds: {
              start: {
                minimum:
                  RECOMMENDATION_THRESHOLDS.start,

                logic:
                  `SAGE >= ${RECOMMENDATION_THRESHOLDS.start}`
              },

              flex: {
                minimum:
                  RECOMMENDATION_THRESHOLDS.flex,

                maximumExclusive:
                  RECOMMENDATION_THRESHOLDS.start,

                logic:
                  `SAGE >= ${RECOMMENDATION_THRESHOLDS.flex} and < ${RECOMMENDATION_THRESHOLDS.start}`
              },

              sit: {
                maximumExclusive:
                  RECOMMENDATION_THRESHOLDS.flex,

                logic:
                  `SAGE < ${RECOMMENDATION_THRESHOLDS.flex}`
              }
            },

            validationBasis: {
              season:
                "2025",

              weeks:
                "5-17",

              cleanPlayerWeekObservations:
                124,

              status:
                "Provisional pending broader multi-season / out-of-sample validation."
            }
          },

          architecture: {
            modelVersion:
              SAGE_MODEL_VERSION,

            rbPopulationSource:
              "weekly-sage-rb-snapshot",

            benchmarkSource:
              "weekly-sage-rb-benchmarks",

            componentSource:
              "weekly-sage-rb-component-scores",

            confidenceSource:
              "weekly-sage-rb-confidence",

            matchupSource:
              "weekly-sage-player-matchup",

            populationRebuiltForThisPlayer:
              false
          },

          provenance: {
            modelVersion:
              SAGE_MODEL_VERSION,

            historicalWeightBaseline:
              PREVIOUS_WEIGHTS,

            rawRoleAndProduction:
              "weekly-sage-rb-component-scores",

            sampleConfidence:
              "weekly-sage-rb-confidence",

            matchup:
              "weekly-sage-player-matchup",

            peerPopulation:
              "weekly-sage-rb-snapshot"
          }
        };
}

exports.buildRbFinalScore =
  buildRbFinalScore;

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

    const week =
      Number(
        query.week
      );

    const playerID =
      String(
        query.playerID ||
        ""
      ).trim();

    const seasonType =
      String(
        query.seasonType ||
        DEFAULT_SEASON_TYPE
      );

    if (
      !Number.isInteger(
        week
      ) ||
      week < 2 ||
      week > 18
    ) {
      return jsonResponse(
        400,
        {
          error:
            "week must be an integer from 2 through 18."
        }
      );
    }

    if (!playerID) {
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
        getBaseUrl(event);

      const body =
        await buildRbFinalScore({
          baseUrl,
          season,
          week,
          seasonType,
          playerID
        });

      return jsonResponse(
        200,
        body,
        CACHE_CONTROL
      );
    } catch (error) {
      console.error(
        "weekly-sage-rb-final-score failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not compose final Weekly SAGE RB score.",

          detail:
            error.message
        }
      );
    }
  };
