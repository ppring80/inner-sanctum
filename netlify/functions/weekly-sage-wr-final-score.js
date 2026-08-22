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
// FIRST-PASS WR FINAL WEIGHTS
// ---------------------------
//
//   Role        50%
//   Production  40%
//   Matchup     10%
//
// IMPORTANT
// ---------
// These final WR weights are PROVISIONAL.
//
// They are a starting hypothesis for historical validation,
// not a locked methodology.
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

const MATCHUP_FUNCTION =
  "weekly-sage-player-matchup";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

const WR_WEIGHTS = {
  role: 0.50,
  production: 0.40,
  matchup: 0.10
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

function normalizeTeam(
  value
) {
  return String(
    value ||
    ""
  )
    .trim()
    .toUpperCase();
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
  playerID
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
      "weekly-sage-player-matchup"
  ) {
    throw new Error(
      "Unexpected Weekly SAGE matchup schema."
    );
  }

  return data;
}

function matchupScoreFromEvidence(
  matchup
) {
  const directCandidates = [
    matchup &&
      matchup.matchup &&
      matchup.matchup.score,

    matchup &&
      matchup.matchup &&
      matchup.matchup.matchupScore,

    matchup &&
      matchup.score,

    matchup &&
      matchup.matchupScore,

    matchup &&
      matchup.sage &&
      matchup.sage.score
  ];

  for (
    const candidate of
    directCandidates
  ) {
    const value =
      nullableNum(
        candidate
      );

    if (
      value !==
      null
    ) {
      return clamp(
        value,
        0,
        100
      );
    }
  }

  return null;
}

function matchupSignal(
  matchup
) {
  const candidates = [
    matchup &&
      matchup.matchup &&
      matchup.matchup.signal,

    matchup &&
      matchup.signal,

    matchup &&
      matchup.matchup &&
      matchup.matchup.label,

    matchup &&
      matchup.label
  ];

  for (
    const candidate of
    candidates
  ) {
    if (
      candidate !==
      null &&
      candidate !==
      undefined &&
      String(
        candidate
      ).trim()
    ) {
      return String(
        candidate
      )
        .trim()
        .toLowerCase();
    }
  }

  return null;
}

function matchupLabel(
  matchup
) {
  const candidates = [
    matchup &&
      matchup.matchup &&
      matchup.matchup.label,

    matchup &&
      matchup.label,

    matchup &&
      matchup.matchup &&
      matchup.matchup.signal,

    matchup &&
      matchup.signal
  ];

  for (
    const candidate of
    candidates
  ) {
    if (
      candidate !==
      null &&
      candidate !==
      undefined &&
      String(
        candidate
      ).trim()
    ) {
      return String(
        candidate
      ).trim();
    }
  }

  return null;
}

function matchupExplanation(
  matchup
) {
  const candidates = [
    matchup &&
      matchup.matchup &&
      matchup.matchup.explanation,

    matchup &&
      matchup.explanation,

    matchup &&
      matchup.sage &&
      matchup.sage.explanation
  ];

  for (
    const candidate of
    candidates
  ) {
    if (
      candidate !==
      null &&
      candidate !==
      undefined &&
      String(
        candidate
      ).trim()
    ) {
      return String(
        candidate
      ).trim();
    }
  }

  return null;
}

function matchupOpponent(
  matchup
) {
  const candidates = [
    matchup &&
      matchup.upcomingGame &&
      matchup.upcomingGame.opponent,

    matchup &&
      matchup.matchup &&
      matchup.matchup.opponent,

    matchup &&
      matchup.opponent
  ];

  for (
    const candidate of
    candidates
  ) {
    const team =
      normalizeTeam(
        candidate
      );

    if (
      team
    ) {
      return team;
    }
  }

  return null;
}

function upcomingGameFromMatchup(
  matchup
) {
  const game =
    matchup &&
    matchup.upcomingGame
      ? matchup.upcomingGame
      : null;

  if (
    !game
  ) {
    return null;
  }

  return {
    team:
      normalizeTeam(
        game.team
      ) ||
      null,

    position:
      game.position ||
      POSITION,

    opponent:
      normalizeTeam(
        game.opponent
      ) ||
      null,

    location:
      game.location ||
      null,

    gameID:
      game.gameID ||
      null,

    gameDate:
      game.gameDate ||
      null,

    gameTime:
      game.gameTime ||
      null
  };
}

function isByeWeek(
  matchup
) {
  const candidates = [
    matchup &&
      matchup.byeWeek,

    matchup &&
      matchup.isBye,

    matchup &&
      matchup.upcomingGame &&
      matchup.upcomingGame.isBye,

    matchup &&
      matchup.schedule &&
      matchup.schedule.isBye
  ];

  if (
    candidates.some(
      function (
        value
      ) {
        return (
          value ===
          true
        );
      }
    )
  ) {
    return true;
  }

  const statusCandidates = [
    matchup &&
      matchup.status,

    matchup &&
      matchup.matchup &&
      matchup.matchup.status,

    matchup &&
      matchup.scheduleStatus
  ];

  return statusCandidates.some(
    function (
      value
    ) {
      return (
        String(
          value ||
          ""
        )
          .trim()
          .toLowerCase() ===
        "bye"
      );
    }
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
    85
  ) {
    return "Elite";
  }

  if (
    value >=
    75
  ) {
    return "Strong";
  }

  if (
    value >=
    65
  ) {
    return "Very Good";
  }

  if (
    value >=
    55
  ) {
    return "Above Average";
  }

  if (
    value >=
    45
  ) {
    return "Average";
  }

  if (
    value >=
    35
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
  roleConfidence,
  productionConfidence
}) {
  const role =
    nullableNum(
      roleConfidence
    );

  const production =
    nullableNum(
      productionConfidence
    );

  if (
    role ===
    null ||
    production ===
    null
  ) {
    return null;
  }

  /*
    Matchup evidence is treated as full confidence once the matchup
    endpoint has successfully returned a valid matchup score.

    Overall confidence therefore mirrors the final model weights.
  */
  return round(
    (
      role *
      WR_WEIGHTS.role
    ) +
    (
      production *
      WR_WEIGHTS.production
    ) +
    WR_WEIGHTS.matchup,
    3
  );
}

function finalScore({
  role,
  production,
  matchup
}) {
  return round(
    (
      role *
      WR_WEIGHTS.role
    ) +
    (
      production *
      WR_WEIGHTS.production
    ) +
    (
      matchup *
      WR_WEIGHTS.matchup
    ),
    1
  );
}

function buildExplanation({
  player,
  score,
  role,
  production,
  matchup,
  opponent
}) {
  const name =
    player &&
    player.name
      ? player.name
      : "Player";

  const opponentText =
    opponent
      ? ` against ${opponent}`
      : "";

  return (
    `${name} has a Weekly SAGE WR Score of ${score}. ` +
    `The confidence-adjusted components are ${role} for Role, ` +
    `${production} for Production, and ${matchup} for the matchup${opponentText}. ` +
    `This provisional WR model weights Role at 50%, Production at 40%, ` +
    `and Matchup at 10%.`
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

      /*
        STEP 1
        ------
        Retrieve confidence-adjusted WR Role and Production.
      */
      const confidence =
        await fetchConfidence({
          baseUrl,
          season,
          week:
            targetWeek,
          seasonType,
          playerID
        });

      const player =
        confidence.player ||
        {};

      if (
        player.position !==
        POSITION
      ) {
        return jsonResponse(
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

      /*
        STEP 2
        ------
        Retrieve target-week matchup evidence.
      */
      const matchupEvidence =
        await fetchMatchup({
          baseUrl,
          season,
          week:
            targetWeek,
          seasonType,
          playerID
        });

      /*
        STEP 3
        ------
        Protect against bye weeks.

        A player without a target-week game should not receive a
        normal Weekly SAGE forecast.
      */
      if (
        isByeWeek(
          matchupEvidence
        )
      ) {
        return jsonResponse(
          200,
          {
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

            player,

            status:
              "bye",

            upcomingGame:
              null,

            sage:
              null,

            recommendation:
              null,

            recommendationStatus: {
              ready:
                false,

              reason:
                "Player team is on bye in the target week."
            }
          },

          CACHE_CONTROL
        );
      }

      const roleAdjusted =
        nullableNum(
          confidence &&
          confidence.role &&
          confidence.role.adjustedScore
        );

      const productionAdjusted =
        nullableNum(
          confidence &&
          confidence.production &&
          confidence.production.adjustedScore
        );

      const roleRaw =
        nullableNum(
          confidence &&
          confidence.role &&
          confidence.role.rawScore
        );

      const productionRaw =
        nullableNum(
          confidence &&
          confidence.production &&
          confidence.production.rawScore
        );

      const roleConfidence =
        nullableNum(
          confidence &&
          confidence.role &&
          confidence.role.confidence &&
          confidence.role.confidence.weight
        );

      const productionConfidence =
        nullableNum(
          confidence &&
          confidence.production &&
          confidence.production.confidence &&
          confidence.production.confidence.weight
        );

      const matchupRaw =
        matchupScoreFromEvidence(
          matchupEvidence
        );

      if (
        roleAdjusted ===
          null ||
        productionAdjusted ===
          null
      ) {
        return jsonResponse(
          422,
          {
            error:
              "WR confidence-adjusted component evidence is incomplete.",

            playerID,

            roleAdjusted,

            productionAdjusted
          }
        );
      }

      if (
        matchupRaw ===
        null
      ) {
        return jsonResponse(
          422,
          {
            error:
              "WR matchup score could not be resolved from matchup evidence.",

            playerID,

            matchupEvidenceType:
              matchupEvidence &&
              matchupEvidence.evidenceType
                ? matchupEvidence.evidenceType
                : null,

            detail:
              "Inspect weekly-sage-player-matchup output before changing final-score logic."
          }
        );
      }

      const matchupAdjusted =
        matchupRaw;

      const score =
        finalScore({
          role:
            roleAdjusted,

          production:
            productionAdjusted,

          matchup:
            matchupAdjusted
        });

      const combinedConfidence =
        overallConfidence({
          roleConfidence,

          productionConfidence
        });

      const opponent =
        matchupOpponent(
          matchupEvidence
        );

      const upcomingGame =
        upcomingGameFromMatchup(
          matchupEvidence
        );

      return jsonResponse(
        200,
        {
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

          upcomingGame,

          methodology: {
            modelVersion:
              "wr-sage-v1",

            status:
              "Provisional pending WR historical weight validation.",

            weights:
              WR_WEIGHTS,

            neutralBaseline:
              NEUTRAL_BASELINE,

            philosophy:
              "Role establishes the opportunity baseline, Production measures conversion of opportunity, and Matchup adjusts the target-week outlook.",

            confidencePrinciple:
              "Score what the evidence says. Weight how much SAGE trusts the evidence.",

            important:
              "The final score uses confidence-adjusted Role and Production. Matchup is a contextual target-week adjustment. Final WR weights are not yet validated."
          },

          components: {
            role: {
              rawScore:
                roleRaw,

              confidence: {
                weight:
                  roleConfidence,

                label:
                  confidenceLabel(
                    roleConfidence
                  )
              },

              adjustedScore:
                roleAdjusted,

              weight:
                WR_WEIGHTS.role,

              weightedContribution:
                round(
                  roleAdjusted *
                  WR_WEIGHTS.role,
                  2
                )
            },

            production: {
              rawScore:
                productionRaw,

              confidence: {
                weight:
                  productionConfidence,

                label:
                  confidenceLabel(
                    productionConfidence
                  )
              },

              adjustedScore:
                productionAdjusted,

              weight:
                WR_WEIGHTS.production,

              weightedContribution:
                round(
                  productionAdjusted *
                  WR_WEIGHTS.production,
                  2
                )
            },

            matchup: {
              rawScore:
                matchupRaw,

              confidence: {
                weight:
                  1,

                label:
                  "Full"
              },

              adjustedScore:
                matchupAdjusted,

              weight:
                WR_WEIGHTS.matchup,

              weightedContribution:
                round(
                  matchupAdjusted *
                  WR_WEIGHTS.matchup,
                  2
                ),

              opponent,

              signal:
                matchupSignal(
                  matchupEvidence
                ),

              label:
                matchupLabel(
                  matchupEvidence
                ),

              explanation:
                matchupExplanation(
                  matchupEvidence
                )
            }
          },

          sage: {
            score,

            label:
              sageLabel(
                score
              ),

            confidence: {
              weight:
                combinedConfidence,

              label:
                confidenceLabel(
                  combinedConfidence
                )
            },

            explanation:
              buildExplanation({
                player,
                score,
                role:
                  roleAdjusted,
                production:
                  productionAdjusted,
                matchup:
                  matchupAdjusted,
                opponent
              })
          },

          recommendation:
            null,

          recommendationStatus: {
            ready:
              false,

            reason:
              "Validate WR final-score weights and historical outcomes before mapping scores to START / FLEX / SIT recommendations."
          },

          nextStep: {
            ready:
              true,

            reason:
              "Generate WR historical player-week observations and compare provisional SAGE scores against actual fantasy outcomes before locking final weights."
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

            provisionalWeights:
              WR_WEIGHTS
          }
        },

        CACHE_CONTROL
      );
    } catch (
      error
    ) {
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
