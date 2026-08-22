// netlify/functions/weekly-sage-rb-final-score.js
//
// WEEKLY SAGE — RB FINAL SCORE COMPOSITION
//
// PURPOSE
// -------
// Compose the three independently validated Weekly SAGE RB components:
//
//   ROLE        45%
//   PRODUCTION  35%
//   MATCHUP     20%
//
// into the first complete Weekly SAGE player score.
//
// IMPORTANT
// ---------
// This function DOES NOT:
// - create START / FLEX / SIT recommendations
// - modify weekly.html
// - recalculate Role
// - recalculate Production
// - recalculate Matchup
//
// It only composes already-validated component scores.
//
// Recommendation thresholds will be designed and validated separately.
//
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_SEASON_TYPE =
  "reg";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

const FINAL_WEIGHTS = {
  role: 0.45,
  production: 0.35,
  matchup: 0.20
};

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

async function fetchRBComponentScores({
  baseUrl,
  season,
  week,
  playerID,
  seasonType
}) {
  const url =
    `${baseUrl}/.netlify/functions/weekly-sage-rb-component-scores` +
    `?season=${encodeURIComponent(season)}` +
    `&week=${encodeURIComponent(week)}` +
    `&playerID=${encodeURIComponent(playerID)}` +
    `&seasonType=${encodeURIComponent(seasonType)}`;

  const data =
    await fetchJson(
      url
    );

  if (
    !data ||
    data.evidenceType !==
      "weekly-sage-rb-component-scores"
  ) {
    throw new Error(
      "Unexpected RB component-score schema."
    );
  }

  return data;
}

async function fetchPlayerEvidence({
  baseUrl,
  season,
  week,
  playerID,
  seasonType
}) {
  const url =
    `${baseUrl}/.netlify/functions/weekly-sage-player-evidence` +
    `?season=${encodeURIComponent(season)}` +
    `&week=${encodeURIComponent(week)}` +
    `&playerID=${encodeURIComponent(playerID)}` +
    `&seasonType=${encodeURIComponent(seasonType)}`;

  const data =
    await fetchJson(
      url
    );

  if (
    !data ||
    data.evidenceType !==
      "weekly-sage-player-evidence"
  ) {
    throw new Error(
      "Unexpected player-evidence schema."
    );
  }

  return data;
}

function finalScoreLabel(score) {
  if (
    score === null ||
    score === undefined
  ) {
    return null;
  }

  if (score >= 90) {
    return "Elite";
  }

  if (score >= 80) {
    return "Very Strong";
  }

  if (score >= 70) {
    return "Strong";
  }

  if (score >= 60) {
    return "Above Average";
  }

  if (score >= 40) {
    return "Average";
  }

  if (score >= 25) {
    return "Below Average";
  }

  return "Weak";
}

function buildContribution(
  score,
  weight
) {
  if (
    !Number.isFinite(
      score
    )
  ) {
    return null;
  }

  return round(
    score *
    weight,
    2
  );
}

function buildScoreExplanation({
  player,
  roleScore,
  productionScore,
  matchupScore,
  finalScore,
  matchupEvidence
}) {
  const name =
    player &&
    player.name
      ? player.name
      : "Player";

  const opponent =
    matchupEvidence &&
    matchupEvidence.opponent
      ? matchupEvidence.opponent
      : "the opponent";

  return (
    `${name} has a Weekly SAGE Score of ${finalScore}. ` +
    `The score combines a ${roleScore} Role Score, ` +
    `${productionScore} Production Score, and ` +
    `${matchupScore} matchup score against ${opponent}. ` +
    `Role and Production account for 80% of the model, ` +
    `while Matchup contributes 20%.`
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

      /*
        Fetch the two independently validated evidence paths in parallel.

        COMPONENT SCORES:
          Role + Production

        PLAYER EVIDENCE:
          Player-specific upcoming matchup
      */
      const [
        componentData,
        playerEvidence
      ] =
        await Promise.all([
          fetchRBComponentScores({
            baseUrl,
            season,
            week,
            playerID,
            seasonType
          }),

          fetchPlayerEvidence({
            baseUrl,
            season,
            week,
            playerID,
            seasonType
          })
        ]);

      const player =
        componentData.player ||
        playerEvidence.player ||
        {};

      if (
        player.position !== "RB"
      ) {
        return jsonResponse(
          400,
          {
            error:
              "Step 8A currently supports RB final-score composition only."
          }
        );
      }

      const roleScore =
        num(
          componentData.role &&
          componentData.role.score
        );

      const productionScore =
        num(
          componentData.production &&
          componentData.production.score
        );

      const matchupEvidence =
        playerEvidence.matchupEvidence ||
        {};

      const matchupScore =
        num(
          matchupEvidence.score
        );

      if (
        roleScore === null ||
        productionScore === null ||
        matchupScore === null
      ) {
        return jsonResponse(
          422,
          {
            error:
              "One or more required SAGE components are not ready.",

            components: {
              role:
                roleScore,

              production:
                productionScore,

              matchup:
                matchupScore
            }
          }
        );
      }

      const roleContribution =
        buildContribution(
          roleScore,
          FINAL_WEIGHTS.role
        );

      const productionContribution =
        buildContribution(
          productionScore,
          FINAL_WEIGHTS.production
        );

      const matchupContribution =
        buildContribution(
          matchupScore,
          FINAL_WEIGHTS.matchup
        );

      const finalScore =
        round(
          roleContribution +
          productionContribution +
          matchupContribution,
          1
        );

      return jsonResponse(
        200,
        {
          evidenceType:
            "weekly-sage-rb-final-score",

          schemaVersion:
            1,

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
              player.position ||
              "RB"
          },

          noLookAhead:
            playerEvidence.noLookAhead ||
            componentData.noLookAhead,

          upcomingGame:
            playerEvidence.upcomingGame ||
            null,

          methodology: {
            hierarchy: [
              "role",
              "production",
              "matchup"
            ],

            weights:
              FINAL_WEIGHTS,

            philosophy:
              "Role and Production establish the player's baseline and account for 80% of the Weekly SAGE Score. Matchup adjusts that baseline with a 20% influence.",

            important:
              "This score is not yet mapped to START, FLEX, or SIT recommendations."
          },

          components: {
            role: {
              score:
                roleScore,

              weight:
                FINAL_WEIGHTS.role,

              weightedContribution:
                roleContribution,

              label:
                componentData.role
                  ? componentData
                      .role
                      .label
                  : null,

              explanation:
                componentData.role
                  ? componentData
                      .role
                      .explanation
                  : null
            },

            production: {
              score:
                productionScore,

              weight:
                FINAL_WEIGHTS.production,

              weightedContribution:
                productionContribution,

              label:
                componentData.production
                  ? componentData
                      .production
                      .label
                  : null,

              explanation:
                componentData.production
                  ? componentData
                      .production
                      .explanation
                  : null
            },

            matchup: {
              score:
                matchupScore,

              weight:
                FINAL_WEIGHTS.matchup,

              weightedContribution:
                matchupContribution,

              label:
                matchupEvidence.label ||
                null,

              signal:
                matchupEvidence.signal ||
                null,

              opponent:
                matchupEvidence.opponent ||
                null,

              explanation:
                matchupEvidence.explanation ||
                null
            }
          },

          sage: {
            score:
              finalScore,

            label:
              finalScoreLabel(
                finalScore
              ),

            explanation:
              buildScoreExplanation({
                player,

                roleScore,

                productionScore,

                matchupScore,

                finalScore,

                matchupEvidence
              })
          },

          /*
            Intentionally still null.

            Recommendation mapping is the NEXT validation stage.
          */
          recommendation:
            null,

          recommendationStatus: {
            ready:
              false,

            reason:
              "Validate final SAGE scores across multiple RB archetypes before defining START / FLEX / SIT thresholds."
          },

          provenance: {
            roleAndProduction:
              "weekly-sage-rb-component-scores",

            matchup:
              "weekly-sage-player-evidence",

            roleBenchmark:
              "weekly-sage-rb-benchmarks",

            playerProduction:
              "weekly-sage-player-season",

            defensiveMatchup:
              "weekly-sage-matchup-defense"
          }
        },

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
            "Could not compose Weekly SAGE RB final score.",

          detail:
            error.message
        }
      );
    }
  };
