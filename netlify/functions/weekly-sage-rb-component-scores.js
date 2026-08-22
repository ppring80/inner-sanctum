// netlify/functions/weekly-sage-rb-component-scores.js
//
// WEEKLY SAGE — RB ROLE + PRODUCTION COMPONENT SCORES
//
// PURPOSE
// -------
// Consume the validated RB percentile benchmark layer:
//
//   weekly-sage-rb-benchmarks
//
// and convert the individual league-relative percentiles into:
//
//   RB Role Score       0-100
//   RB Production Score 0-100
//
// IMPORTANT
// ---------
// This function DOES NOT:
// - calculate the final SAGE score
// - create START/SIT recommendations
// - change matchup scoring
// - change underlying player evidence
//
// SAGE COMPONENT PHILOSOPHY
// -------------------------
//
// ROLE SCORE
//   40% Opportunities/Game
//   25% Offensive Snap %
//   20% Carries/Game
//   15% Targets/Game
//
// PRODUCTION SCORE
//   35% Scrimmage Yards/Game
//   20% Rushing Yards/Game
//   15% Receiving Yards/Game
//   10% Yards/Carry
//   20% Total TD/Game
//
// These weights are explicit SAGE v1 assumptions to be validated.
//
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_SEASON_TYPE =
  "reg";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

const RB_ROLE_WEIGHTS = {
  opportunitiesPerGame: 0.40,
  offensiveSnapPct: 0.25,
  carriesPerGame: 0.20,
  targetsPerGame: 0.15
};

const RB_PRODUCTION_WEIGHTS = {
  scrimmageYardsPerGame: 0.35,
  rushingYardsPerGame: 0.20,
  receivingYardsPerGame: 0.15,
  yardsPerCarry: 0.10,
  totalTDPerGame: 0.20
};

function num(value) {
  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : 0;
}

function round(
  value,
  digits = 1
) {
  const factor =
    Math.pow(
      10,
      digits
    );

  return (
    Math.round(
      (
        num(value) +
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

async function fetchRBBenchmarks({
  baseUrl,
  season,
  week,
  playerID,
  seasonType
}) {
  const url =
    `${baseUrl}/.netlify/functions/weekly-sage-rb-benchmarks` +
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
      "weekly-sage-rb-benchmarks"
  ) {
    throw new Error(
      "Unexpected RB benchmark evidence schema."
    );
  }

  return data;
}

function percentileOf(
  benchmarks,
  section,
  metric
) {
  if (
    !benchmarks ||
    !benchmarks[section] ||
    !benchmarks[section][metric]
  ) {
    return null;
  }

  const value =
    Number(
      benchmarks[section]
        [metric]
        .percentile
    );

  return Number.isFinite(
    value
  )
    ? value
    : null;
}

function metricValueOf(
  benchmarks,
  section,
  metric
) {
  if (
    !benchmarks ||
    !benchmarks[section] ||
    !benchmarks[section][metric]
  ) {
    return null;
  }

  const value =
    Number(
      benchmarks[section]
        [metric]
        .value
    );

  return Number.isFinite(
    value
  )
    ? value
    : null;
}

function weightedComponentScore(
  components
) {
  let weightedTotal = 0;
  let weightTotal = 0;

  for (
    const component of
    components
  ) {
    if (
      !Number.isFinite(
        component.percentile
      )
    ) {
      continue;
    }

    weightedTotal +=
      component.percentile *
      component.weight;

    weightTotal +=
      component.weight;
  }

  if (
    weightTotal <= 0
  ) {
    return null;
  }

  return round(
    weightedTotal /
    weightTotal,
    1
  );
}

function scoreLabel(score) {
  if (
    score === null ||
    score === undefined
  ) {
    return null;
  }

  if (score >= 90) {
    return "Elite";
  }

  if (score >= 75) {
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

function buildRoleComponents(
  benchmarks
) {
  return [
    {
      metric:
        "opportunitiesPerGame",

      value:
        metricValueOf(
          benchmarks,
          "role",
          "opportunitiesPerGame"
        ),

      percentile:
        percentileOf(
          benchmarks,
          "role",
          "opportunitiesPerGame"
        ),

      weight:
        RB_ROLE_WEIGHTS
          .opportunitiesPerGame
    },

    {
      metric:
        "offensiveSnapPct",

      value:
        metricValueOf(
          benchmarks,
          "role",
          "offensiveSnapPct"
        ),

      percentile:
        percentileOf(
          benchmarks,
          "role",
          "offensiveSnapPct"
        ),

      weight:
        RB_ROLE_WEIGHTS
          .offensiveSnapPct
    },

    {
      metric:
        "carriesPerGame",

      value:
        metricValueOf(
          benchmarks,
          "role",
          "carriesPerGame"
        ),

      percentile:
        percentileOf(
          benchmarks,
          "role",
          "carriesPerGame"
        ),

      weight:
        RB_ROLE_WEIGHTS
          .carriesPerGame
    },

    {
      metric:
        "targetsPerGame",

      value:
        metricValueOf(
          benchmarks,
          "role",
          "targetsPerGame"
        ),

      percentile:
        percentileOf(
          benchmarks,
          "role",
          "targetsPerGame"
        ),

      weight:
        RB_ROLE_WEIGHTS
          .targetsPerGame
    }
  ];
}

function buildProductionComponents(
  benchmarks
) {
  return [
    {
      metric:
        "scrimmageYardsPerGame",

      value:
        metricValueOf(
          benchmarks,
          "production",
          "scrimmageYardsPerGame"
        ),

      percentile:
        percentileOf(
          benchmarks,
          "production",
          "scrimmageYardsPerGame"
        ),

      weight:
        RB_PRODUCTION_WEIGHTS
          .scrimmageYardsPerGame
    },

    {
      metric:
        "rushingYardsPerGame",

      value:
        metricValueOf(
          benchmarks,
          "production",
          "rushingYardsPerGame"
        ),

      percentile:
        percentileOf(
          benchmarks,
          "production",
          "rushingYardsPerGame"
        ),

      weight:
        RB_PRODUCTION_WEIGHTS
          .rushingYardsPerGame
    },

    {
      metric:
        "receivingYardsPerGame",

      value:
        metricValueOf(
          benchmarks,
          "production",
          "receivingYardsPerGame"
        ),

      percentile:
        percentileOf(
          benchmarks,
          "production",
          "receivingYardsPerGame"
        ),

      weight:
        RB_PRODUCTION_WEIGHTS
          .receivingYardsPerGame
    },

    {
      metric:
        "yardsPerCarry",

      value:
        metricValueOf(
          benchmarks,
          "production",
          "yardsPerCarry"
        ),

      percentile:
        percentileOf(
          benchmarks,
          "production",
          "yardsPerCarry"
        ),

      weight:
        RB_PRODUCTION_WEIGHTS
          .yardsPerCarry
    },

    {
      metric:
        "totalTDPerGame",

      value:
        metricValueOf(
          benchmarks,
          "production",
          "totalTDPerGame"
        ),

      percentile:
        percentileOf(
          benchmarks,
          "production",
          "totalTDPerGame"
        ),

      weight:
        RB_PRODUCTION_WEIGHTS
          .totalTDPerGame
    }
  ];
}

function buildExplanation({
  player,
  roleScore,
  productionScore,
  roleComponents,
  productionComponents
}) {
  const name =
    player &&
    player.name
      ? player.name
      : "Player";

  const opportunities =
    roleComponents.find(
      item =>
        item.metric ===
        "opportunitiesPerGame"
    );

  const snaps =
    roleComponents.find(
      item =>
        item.metric ===
        "offensiveSnapPct"
    );

  const scrimmage =
    productionComponents.find(
      item =>
        item.metric ===
        "scrimmageYardsPerGame"
    );

  const ypc =
    productionComponents.find(
      item =>
        item.metric ===
        "yardsPerCarry"
    );

  return {
    role:
      `${name} has an RB Role Score of ${roleScore}. ` +
      `He is averaging ${num(
        opportunities &&
        opportunities.value
      ).toFixed(1)} opportunities per game ` +
      `with ${num(
        snaps &&
        snaps.value
      ).toFixed(1)}% offensive snap share.`,

    production:
      `${name} has an RB Production Score of ${productionScore}. ` +
      `He is averaging ${num(
        scrimmage &&
        scrimmage.value
      ).toFixed(1)} scrimmage yards per game ` +
      `and ${num(
        ypc &&
        ypc.value
      ).toFixed(2)} yards per carry.`
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

      const benchmarkData =
        await fetchRBBenchmarks({
          baseUrl,
          season,
          week,
          playerID,
          seasonType
        });

      const player =
        benchmarkData.target ||
        {};

      if (
        player.position !==
        "RB"
      ) {
        return jsonResponse(
          400,
          {
            error:
              "RB component scoring requires an RB target."
          }
        );
      }

      const roleComponents =
        buildRoleComponents(
          benchmarkData
            .benchmarks
        );

      const productionComponents =
        buildProductionComponents(
          benchmarkData
            .benchmarks
        );

      const roleScore =
        weightedComponentScore(
          roleComponents
        );

      const productionScore =
        weightedComponentScore(
          productionComponents
        );

      const explanation =
        buildExplanation({
          player,

          roleScore,

          productionScore,

          roleComponents,

          productionComponents
        });

      return jsonResponse(
        200,
        {
          evidenceType:
            "weekly-sage-rb-component-scores",

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
            benchmarkData
              .noLookAhead,

          population: {
            size:
              player.populationSize ||
              benchmarkData
                .populationSummary
                .eligibleRBPopulation,

            rankByOpportunities:
              player
                .populationRankByOpportunities
          },

          methodology: {
            roleWeights:
              RB_ROLE_WEIGHTS,

            productionWeights:
              RB_PRODUCTION_WEIGHTS,

            philosophy:
              "Role measures opportunity and playing-time control. Production measures how effectively the player converts that role into fantasy-relevant output.",

            important:
              "These are SAGE component scores, not a START/SIT recommendation and not yet the final SAGE player score."
          },

          role: {
            score:
              roleScore,

            label:
              scoreLabel(
                roleScore
              ),

            components:
              roleComponents,

            explanation:
              explanation.role
          },

          production: {
            score:
              productionScore,

            label:
              scoreLabel(
                productionScore
              ),

            components:
              productionComponents,

            explanation:
              explanation.production
          },

          matchup: {
            score:
              null,

            reason:
              "Matchup remains in the separate validated Weekly SAGE matchup layer."
          },

          finalSageScore:
            null,

          recommendation:
            null,

          nextStep: {
            readyForFinalComposition:
              (
                Number.isFinite(
                  roleScore
                ) &&
                Number.isFinite(
                  productionScore
                )
              ),

            eventualWeights: {
              role:
                0.45,

              production:
                0.35,

              matchup:
                0.20
            },

            reason:
              "Validate Role and Production component scores before combining them with matchup."
          },

          provenance: {
            benchmarkSource:
              "weekly-sage-rb-benchmarks",

            playerEvidenceSource:
              "weekly-sage-player-season"
          }
        },

        CACHE_CONTROL
      );
    } catch (error) {
      console.error(
        "weekly-sage-rb-component-scores failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not build Weekly SAGE RB component scores.",

          detail:
            error.message
        }
      );
    }
  };
