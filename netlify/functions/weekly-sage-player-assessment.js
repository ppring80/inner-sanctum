// netlify/functions/weekly-sage-player-assessment.js
//
// WEEKLY SAGE — PLAYER EVIDENCE ASSESSMENT
//
// PURPOSE
// -------
// Consume the validated:
//   weekly-sage-player-evidence
//
// and organize the player's evidence into the SAGE decision hierarchy:
//
//   1. Role / Opportunity
//   2. Production / Efficiency
//   3. Matchup
//
// IMPORTANT
// ---------
// This is NOT yet a START/SIT recommendation.
//
// It intentionally DOES NOT assign a final player score because
// Role and Production do not yet have league-relative positional
// benchmarks.
//
// Matchup already DOES have a validated league-relative 0-100 score.
//
// We will not pretend raw carries/targets/yards are comparable across
// QB/RB/WR/TE until the positional benchmark layer exists.
//
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_SEASON_TYPE = "reg";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

/*
  SAGE V1 decision hierarchy.

  These weights express intended decision influence once all three
  components have league-relative scores.

  They are assumptions to validate, not objective football truths.
*/
const COMPONENT_WEIGHTS = {
  role: 0.45,
  production: 0.35,
  matchup: 0.20
};

function num(value) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : 0;
}

function round(value, digits = 2) {
  const factor =
    Math.pow(10, digits);

  return (
    Math.round(
      (
        num(value) +
        Number.EPSILON
      ) *
      factor
    ) / factor
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

    throw new Error(detail);
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
    await fetchJson(url);

  if (
    !data ||
    data.evidenceType !==
      "weekly-sage-player-evidence"
  ) {
    throw new Error(
      "Unexpected player evidence schema."
    );
  }

  return data;
}

function buildRBRole(evidence) {
  const usage =
    evidence.usageEvidence ||
    {};

  return {
    position:
      "RB",

    metrics: {
      carriesPerGame:
        num(
          usage.carriesPerGame
        ),

      targetsPerGame:
        num(
          usage.targetsPerGame
        ),

      receptionsPerGame:
        num(
          usage.receptionsPerGame
        ),

      opportunitiesPerGame:
        round(
          num(
            usage.carriesPerGame
          ) +
          num(
            usage.targetsPerGame
          )
        ),

      offensiveSnapPct:
        num(
          usage.offensiveSnapPct
        )
    },

    interpretation:
      "RB role will ultimately be benchmarked against other fantasy-relevant RBs using carries, receiving involvement, total opportunities, and offensive snap share."
  };
}

function buildQBRole(evidence) {
  const usage =
    evidence.usageEvidence ||
    {};

  return {
    position:
      "QB",

    metrics: {
      passAttemptsPerGame:
        num(
          usage.passAttemptsPerGame
        ),

      carriesPerGame:
        num(
          usage.carriesPerGame
        ),

      offensiveSnapPct:
        num(
          usage.offensiveSnapPct
        )
    },

    interpretation:
      "QB role will ultimately be benchmarked using passing volume, rushing involvement, and offensive snap participation."
  };
}

function buildReceiverRole(
  evidence,
  position
) {
  const usage =
    evidence.usageEvidence ||
    {};

  return {
    position,

    metrics: {
      targetsPerGame:
        num(
          usage.targetsPerGame
        ),

      receptionsPerGame:
        num(
          usage.receptionsPerGame
        ),

      offensiveSnapPct:
        num(
          usage.offensiveSnapPct
        ),

      carriesPerGame:
        num(
          usage.carriesPerGame
        )
    },

    interpretation:
      `${position} role will ultimately be benchmarked against fantasy-relevant ${position}s using target volume, receptions, snap share, and supplemental rushing involvement.`
  };
}

function buildRoleComponent(
  evidence
) {
  const position =
    evidence.player &&
    evidence.player.position
      ? evidence.player.position
      : null;

  switch (position) {
    case "RB":
      return buildRBRole(
        evidence
      );

    case "QB":
      return buildQBRole(
        evidence
      );

    case "WR":
    case "TE":
      return buildReceiverRole(
        evidence,
        position
      );

    default:
      return {
        position,
        metrics: {},
        interpretation:
          "No role model is defined for this position."
      };
  }
}

function buildRBProduction(
  evidence
) {
  const production =
    evidence.productionEvidence ||
    {};

  const rushing =
    production.rushing ||
    {};

  const receiving =
    production.receiving ||
    {};

  const scrimmage =
    production.scrimmage ||
    {};

  return {
    position:
      "RB",

    metrics: {
      rushingYardsPerGame:
        num(
          rushing.yardsPerGame
        ),

      yardsPerCarry:
        num(
          rushing.yardsPerCarry
        ),

      rushingTDPerGame:
        num(
          rushing.touchdownsPerGame
        ),

      receivingYardsPerGame:
        num(
          receiving.yardsPerGame
        ),

      receivingTDPerGame:
        num(
          receiving.touchdownsPerGame
        ),

      scrimmageYardsPerGame:
        num(
          scrimmage.yardsPerGame
        )
    },

    interpretation:
      "RB production will ultimately be benchmarked using rushing efficiency, rushing production, receiving production, touchdowns, and total scrimmage output."
  };
}

function buildQBProduction(
  evidence
) {
  const production =
    evidence.productionEvidence ||
    {};

  const passing =
    production.passing ||
    {};

  const rushing =
    production.rushing ||
    {};

  return {
    position:
      "QB",

    metrics: {
      passingYardsPerGame:
        num(
          passing.yardsPerGame
        ),

      yardsPerAttempt:
        num(
          passing.yardsPerAttempt
        ),

      passingTDPerGame:
        num(
          passing.touchdownsPerGame
        ),

      interceptionsPerGame:
        num(
          passing.interceptionsPerGame
        ),

      rushingYardsPerGame:
        num(
          rushing.yardsPerGame
        ),

      rushingTDPerGame:
        num(
          rushing.touchdownsPerGame
        )
    },

    interpretation:
      "QB production will ultimately be benchmarked using passing production and efficiency, touchdown production, turnover rate, and rushing contribution."
  };
}

function buildReceiverProduction(
  evidence,
  position
) {
  const production =
    evidence.productionEvidence ||
    {};

  const receiving =
    production.receiving ||
    {};

  const rushing =
    production.rushing ||
    {};

  return {
    position,

    metrics: {
      receivingYardsPerGame:
        num(
          receiving.yardsPerGame
        ),

      yardsPerTarget:
        num(
          receiving.yardsPerTarget
        ),

      yardsPerReception:
        num(
          receiving.yardsPerReception
        ),

      catchRate:
        num(
          receiving.catchRate
        ),

      receivingTDPerGame:
        num(
          receiving.touchdownsPerGame
        ),

      rushingYardsPerGame:
        num(
          rushing.yardsPerGame
        )
    },

    interpretation:
      `${position} production will ultimately be benchmarked using receiving volume converted into yards, efficiency per target/reception, touchdown production, and supplemental rushing output.`
  };
}

function buildProductionComponent(
  evidence
) {
  const position =
    evidence.player &&
    evidence.player.position
      ? evidence.player.position
      : null;

  switch (position) {
    case "RB":
      return buildRBProduction(
        evidence
      );

    case "QB":
      return buildQBProduction(
        evidence
      );

    case "WR":
    case "TE":
      return buildReceiverProduction(
        evidence,
        position
      );

    default:
      return {
        position,
        metrics: {},
        interpretation:
          "No production model is defined for this position."
      };
  }
}

function buildMatchupComponent(
  evidence
) {
  const matchup =
    evidence.matchupEvidence ||
    {};

  return {
    score:
      num(
        matchup.score
      ),

    signal:
      matchup.signal ||
      null,

    label:
      matchup.label ||
      null,

    profileType:
      matchup.profileType ||
      null,

    opponent:
      matchup.opponent ||
      null,

    explanation:
      matchup.explanation ||
      null,

    confidence:
      matchup.confidence ||
      null,

    /*
      Matchup is already league-relative, so unlike Role and
      Production this component has a validated 0-100 score now.
    */
    scoringStatus:
      "ready"
  };
}

function buildScoringReadiness({
  role,
  production,
  matchup
}) {
  return {
    role: {
      ready:
        false,

      reason:
        "Needs league-relative positional benchmarks before assigning a defensible 0-100 Role Score."
    },

    production: {
      ready:
        false,

      reason:
        "Needs league-relative positional benchmarks before assigning a defensible 0-100 Production Score."
    },

    matchup: {
      ready:
        Number.isFinite(
          Number(
            matchup.score
          )
        ),

      reason:
        "Matchup score is already league-relative using the validated defensive percentile model."
    },

    finalSageScore: {
      ready:
        false,

      reason:
        "SAGE will not calculate a final score until Role and Production are normalized relative to positional peers."
    }
  };
}

function buildAssessmentSummary({
  evidence,
  matchup
}) {
  const player =
    evidence.player ||
    {};

  const game =
    evidence.upcomingGame ||
    {};

  return {
    player:
      `${player.name || "Player"} (${player.position || "?"}, ${player.team || "?"})`,

    upcomingGame:
      game.opponent
        ? (
            `${game.location === "home" ? "vs" : "at"} ${game.opponent}`
          )
        : null,

    role:
      evidence.summary
        ? evidence.summary.usage
        : null,

    production:
      evidence.summary
        ? evidence.summary.production
        : null,

    matchup:
      matchup.explanation,

    methodology:
      "Player role establishes the baseline, production evaluates how effectively that role is being converted, and matchup adjusts the outlook rather than defining it."
  };
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
      week < 1 ||
      week > 18
    ) {
      return jsonResponse(
        400,
        {
          error:
            "week must be an integer from 1 through 18."
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

      const evidence =
        await fetchPlayerEvidence({
          baseUrl,
          season,
          week,
          playerID,
          seasonType
        });

      const role =
        buildRoleComponent(
          evidence
        );

      const production =
        buildProductionComponent(
          evidence
        );

      const matchup =
        buildMatchupComponent(
          evidence
        );

      const readiness =
        buildScoringReadiness({
          role,
          production,
          matchup
        });

      return jsonResponse(
        200,
        {
          evidenceType:
            "weekly-sage-player-assessment",

          schemaVersion:
            1,

          generatedAt:
            new Date()
              .toISOString(),

          season,

          targetWeek:
            week,

          seasonType,

          player:
            evidence.player,

          noLookAhead:
            evidence.noLookAhead,

          upcomingGame:
            evidence.upcomingGame,

          methodology: {
            hierarchy: [
              "role",
              "production",
              "matchup"
            ],

            eventualWeights: {
              role:
                COMPONENT_WEIGHTS.role,

              production:
                COMPONENT_WEIGHTS.production,

              matchup:
                COMPONENT_WEIGHTS.matchup
            },

            philosophy:
              "Role and opportunity establish the player's baseline. Production measures how effectively that opportunity is being converted. Matchup adjusts the baseline but does not dominate it.",

            important:
              "No final SAGE player score is calculated until Role and Production can be normalized relative to positional peers."
          },

          components: {
            role: {
              weight:
                COMPONENT_WEIGHTS.role,

              score:
                null,

              scoringStatus:
                "awaiting_positional_benchmark",

              evidence:
                role
            },

            production: {
              weight:
                COMPONENT_WEIGHTS.production,

              score:
                null,

              scoringStatus:
                "awaiting_positional_benchmark",

              evidence:
                production
            },

            matchup: {
              weight:
                COMPONENT_WEIGHTS.matchup,

              score:
                matchup.score,

              scoringStatus:
                "ready",

              evidence:
                matchup
            }
          },

          scoringReadiness:
            readiness,

          evidenceFlags:
            evidence.evidenceFlags,

          summary:
            buildAssessmentSummary({
              evidence,
              matchup
            }),

          finalSageScore:
            null,

          recommendation:
            null,

          provenance: {
            assessment:
              "weekly-sage-player-assessment",

            composedEvidence:
              "weekly-sage-player-evidence",

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
        "weekly-sage-player-assessment failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not build Weekly SAGE player assessment.",

          detail:
            error.message
        }
      );
    }
  };
