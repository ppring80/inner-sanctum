// netlify/functions/weekly-sage-rb-confidence.js
//
// WEEKLY SAGE — RB SAMPLE CONFIDENCE
//
// PURPOSE
// -------
// Measure how much confidence SAGE should place in an RB's
// current-season Role and Production evidence.
//
// IMPORTANT
// ---------
// This function does NOT change the underlying Role or Production
// component scores.
//
// It answers a separate question:
//
//   "How much should SAGE trust the current sample?"
//
// This protects SAGE against:
// - rookies with very small samples
// - early-season volatility
// - injury returns
// - backups who recently became starters
// - players whose roles are still developing
//
// PHILOSOPHY
// ----------
// Score what the evidence says.
// Weight how much we trust the evidence.
//
// Role stabilizes faster than Production.
// Matchup confidence remains owned by the matchup layer.
//
// ================================================================

const DEFAULT_SEASON_TYPE = "reg";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

const COMPONENT_FUNCTION =
  "weekly-sage-rb-component-scores";

const PLAYER_SEASON_FUNCTION =
  "weekly-sage-player-season";

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
      (num(value) + Number.EPSILON) *
      factor
    ) / factor
  );
}

function clamp(value, min, max) {
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
          Accept: "application/json"
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

function buildFunctionUrl({
  baseUrl,
  functionName,
  season,
  week,
  seasonType,
  playerID
}) {
  return (
    `${baseUrl}/.netlify/functions/${functionName}` +
    `?season=${encodeURIComponent(season)}` +
    `&week=${encodeURIComponent(week)}` +
    `&seasonType=${encodeURIComponent(seasonType)}` +
    `&playerID=${encodeURIComponent(playerID)}`
  );
}

/*
  ROLE CONFIDENCE
  ---------------

  Role is relatively observable.

  Carries, targets and snap share can establish a useful
  picture fairly quickly.

  Games:
    1 -> 0.45
    2 -> 0.60
    3 -> 0.75
    4 -> 0.85
    5 -> 0.92
    6 -> 0.97
    7+ -> 1.00
*/
function roleGamesConfidence(games) {
  if (games <= 0) return 0;
  if (games === 1) return 0.45;
  if (games === 2) return 0.60;
  if (games === 3) return 0.75;
  if (games === 4) return 0.85;
  if (games === 5) return 0.92;
  if (games === 6) return 0.97;

  return 1;
}

/*
  PRODUCTION CONFIDENCE
  ---------------------

  Production is noisier than Role.

  Yards per carry, touchdowns and explosive plays can move
  dramatically in small samples.

  Therefore Production earns confidence more slowly.

  Games:
    1 -> 0.30
    2 -> 0.40
    3 -> 0.50
    4 -> 0.62
    5 -> 0.74
    6 -> 0.87
    7+ -> 1.00
*/
function productionGamesConfidence(games) {
  if (games <= 0) return 0;
  if (games === 1) return 0.30;
  if (games === 2) return 0.40;
  if (games === 3) return 0.50;
  if (games === 4) return 0.62;
  if (games === 5) return 0.74;
  if (games === 6) return 0.87;

  return 1;
}

/*
  ROLE SAMPLE QUALITY
  -------------------

  Games alone do not tell the entire story.

  A player appearing in three games but receiving almost no
  work should not receive the same confidence as a three-game
  starter.

  We therefore use opportunities and snap share as secondary
  evidence of role stability.

  This does NOT change the Role Score.

  It only affects confidence in the observed role.
*/
function roleSampleQuality({
  opportunitiesPerGame,
  offensiveSnapPct
}) {
  const opportunities =
    num(opportunitiesPerGame);

  const snaps =
    num(offensiveSnapPct);

  let opportunityQuality;

  if (opportunities >= 18) {
    opportunityQuality = 1;
  } else if (opportunities >= 14) {
    opportunityQuality = 0.95;
  } else if (opportunities >= 10) {
    opportunityQuality = 0.90;
  } else if (opportunities >= 7) {
    opportunityQuality = 0.82;
  } else if (opportunities >= 5) {
    opportunityQuality = 0.72;
  } else {
    opportunityQuality = 0.60;
  }

  let snapQuality;

  if (snaps >= 70) {
    snapQuality = 1;
  } else if (snaps >= 60) {
    snapQuality = 0.95;
  } else if (snaps >= 50) {
    snapQuality = 0.90;
  } else if (snaps >= 40) {
    snapQuality = 0.82;
  } else if (snaps >= 25) {
    snapQuality = 0.72;
  } else {
    snapQuality = 0.60;
  }

  /*
    Opportunities are slightly more important because they
    directly represent fantasy-relevant touches + targets.
  */
  return round(
    opportunityQuality * 0.60 +
    snapQuality * 0.40,
    3
  );
}

/*
  Production sample quality currently remains neutral.

  We deliberately do NOT boost confidence because somebody has
  an extreme YPC or TD rate.

  Those are exactly the metrics that can be misleading in a
  small sample.

  Keeping this function explicit gives us a clean place to add
  better stabilization evidence later if desired.
*/
function productionSampleQuality() {
  return 1;
}

function confidenceLabel(weight) {
  if (weight >= 0.95) {
    return "Full";
  }

  if (weight >= 0.80) {
    return "High";
  }

  if (weight >= 0.60) {
    return "Moderate";
  }

  if (weight >= 0.40) {
    return "Limited";
  }

  if (weight > 0) {
    return "Very Limited";
  }

  return "Insufficient";
}

/*
  Confidence-adjusted score.

  IMPORTANT:
  We regress uncertainty toward a neutral positional baseline
  of 50.

  Example:

    score = 94
    confidence = 0.50

    94 * .50 + 50 * .50 = 72

  The raw score remains available and unchanged.
*/
function confidenceAdjustedScore(
  rawScore,
  confidence,
  baseline = 50
) {
  const score =
    num(rawScore);

  const weight =
    clamp(
      num(confidence),
      0,
      1
    );

  return round(
    score * weight +
    baseline * (1 - weight),
    1
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
        new Date().getFullYear()
      );

    const week =
      Number(query.week);

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
      !Number.isInteger(week) ||
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
        COMPONENT SCORES

        These remain untouched.

        We are layering confidence on top of the already
        validated Role and Production scores.
      */
      const componentUrl =
        buildFunctionUrl({
          baseUrl,
          functionName:
            COMPONENT_FUNCTION,
          season,
          week,
          seasonType,
          playerID
        });

      /*
        PLAYER-SEASON EVIDENCE

        Used to verify games/sample information and preserve
        the no-look-ahead provenance.
      */
      const playerSeasonUrl =
        buildFunctionUrl({
          baseUrl,
          functionName:
            PLAYER_SEASON_FUNCTION,
          season,
          week,
          seasonType,
          playerID
        });

      const [
        components,
        playerSeason
      ] =
        await Promise.all([
          fetchJson(componentUrl),
          fetchJson(playerSeasonUrl)
        ]);

      if (
        !components ||
        components.evidenceType !==
          "weekly-sage-rb-component-scores"
      ) {
        throw new Error(
          "Unexpected RB component-score schema."
        );
      }

      if (
        !playerSeason ||
        playerSeason.evidenceType !==
          "weekly-sage-player-season"
      ) {
        throw new Error(
          "Unexpected player-season schema."
        );
      }

      const gamesUsed =
        num(
          playerSeason.gamesUsed
        );

      const roleMetrics =
        components.role &&
        Array.isArray(
          components.role.components
        )
          ? components.role.components
          : [];

      const findRoleMetric =
        metric =>
          roleMetrics.find(
            item =>
              item.metric === metric
          );

      const opportunityMetric =
        findRoleMetric(
          "opportunitiesPerGame"
        );

      const snapMetric =
        findRoleMetric(
          "offensiveSnapPct"
        );

      const opportunitiesPerGame =
        opportunityMetric
          ? num(
              opportunityMetric.value
            )
          : num(
              playerSeason
                .usageProfile &&
              (
                num(
                  playerSeason
                    .usageProfile
                    .carriesPerGame
                ) +
                num(
                  playerSeason
                    .usageProfile
                    .targetsPerGame
                )
              )
            );

      const offensiveSnapPct =
        snapMetric
          ? num(
              snapMetric.value
            )
          : num(
              playerSeason
                .usageProfile &&
              playerSeason
                .usageProfile
                .offensiveSnapPct
            );

      const roleGamesWeight =
        roleGamesConfidence(
          gamesUsed
        );

      const roleQualityWeight =
        roleSampleQuality({
          opportunitiesPerGame,
          offensiveSnapPct
        });

      /*
        Games are the dominant confidence factor.

        Sample quality can modestly reduce confidence when the
        player has not established a substantial role.
      */
      const roleConfidence =
        round(
          clamp(
            roleGamesWeight *
            roleQualityWeight,
            0,
            1
          ),
          3
        );

      const productionGamesWeight =
        productionGamesConfidence(
          gamesUsed
        );

      const productionQualityWeight =
        productionSampleQuality();

      const productionConfidence =
        round(
          clamp(
            productionGamesWeight *
            productionQualityWeight,
            0,
            1
          ),
          3
        );

      const rawRoleScore =
        num(
          components.role &&
          components.role.score
        );

      const rawProductionScore =
        num(
          components.production &&
          components.production.score
        );

      const adjustedRoleScore =
        confidenceAdjustedScore(
          rawRoleScore,
          roleConfidence
        );

      const adjustedProductionScore =
        confidenceAdjustedScore(
          rawProductionScore,
          productionConfidence
        );

      return jsonResponse(
        200,
        {
          evidenceType:
            "weekly-sage-rb-confidence",

          schemaVersion: 1,

          generatedAt:
            new Date().toISOString(),

          season,

          targetWeek: week,

          seasonType,

          player:
            components.player,

          noLookAhead:
            playerSeason.noLookAhead,

          philosophy: {
            principle:
              "Score what the evidence says. Weight how much SAGE trusts the evidence.",

            role:
              "Role stabilizes faster because carries, targets, opportunities, and snap share are directly observable.",

            production:
              "Production stabilizes more slowly because efficiency, touchdowns, and explosive plays are more volatile in small samples.",

            baseline:
              50,

            important:
              "Confidence does not alter the raw component scores. It creates separate confidence-adjusted scores for downstream final composition."
          },

          sample: {
            gamesUsed,

            weeksIncluded:
              playerSeason
                .noLookAhead &&
              Array.isArray(
                playerSeason
                  .noLookAhead
                  .weeksIncluded
              )
                ? playerSeason
                    .noLookAhead
                    .weeksIncluded
                : (
                    playerSeason
                      .noLookAhead &&
                    Array.isArray(
                      playerSeason
                        .noLookAhead
                        .scheduleWeeksQueried
                    )
                      ? playerSeason
                          .noLookAhead
                          .scheduleWeeksQueried
                      : []
                  ),

            opportunitiesPerGame:
              round(
                opportunitiesPerGame
              ),

            offensiveSnapPct:
              round(
                offensiveSnapPct,
                1
              )
          },

          role: {
            rawScore:
              rawRoleScore,

            confidence: {
              weight:
                roleConfidence,

              label:
                confidenceLabel(
                  roleConfidence
                ),

              gamesWeight:
                roleGamesWeight,

              sampleQualityWeight:
                roleQualityWeight
            },

            adjustedScore:
              adjustedRoleScore,

            regressionToBaseline:
              round(
                rawRoleScore -
                adjustedRoleScore,
                1
              )
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
                ),

              gamesWeight:
                productionGamesWeight,

              sampleQualityWeight:
                productionQualityWeight
            },

            adjustedScore:
              adjustedProductionScore,

            regressionToBaseline:
              round(
                rawProductionScore -
                adjustedProductionScore,
                1
              )
          },

          matchup: {
            confidenceSource:
              "weekly-sage matchup layer",

            important:
              "Matchup confidence is not recalculated here."
          },

          scoringReadiness: {
            rawComponentScoresPreserved:
              true,

            confidenceLayerReady:
              true,

            readyForFinalComposition:
              true
          },

          provenance: {
            componentScores:
              "weekly-sage-rb-component-scores",

            sampleEvidence:
              "weekly-sage-player-season",

            confidence:
              "weekly-sage-rb-confidence"
          }
        },

        CACHE_CONTROL
      );
    } catch (error) {
      console.error(
        "weekly-sage-rb-confidence failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not build Weekly SAGE RB confidence evidence.",

          detail:
            error.message
        }
      );
    }
  };
