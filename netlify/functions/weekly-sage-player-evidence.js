// netlify/functions/weekly-sage-player-evidence.js
//
// WEEKLY SAGE — PLAYER-SPECIFIC EVIDENCE COMPOSITION
//
// PURPOSE
// -------
// Combine the two independently validated Weekly SAGE evidence streams:
//
//   weekly-sage-player-season
//          +
//   weekly-sage-player-matchup
//
// into one player-specific evidence object.
//
// Example:
//   ?season=2025&week=8&playerID=4430807
//
// This function DOES NOT:
// - create a START/SIT recommendation
// - calculate a final SAGE score
// - change matchup weights
// - change player production calculations
// - modify weekly.html
//
// It is an evidence COMPOSITION layer only.
//
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_SEASON_TYPE = "reg";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

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

async function fetchPlayerSeason({
  baseUrl,
  season,
  week,
  playerID,
  seasonType
}) {
  const url =
    `${baseUrl}/.netlify/functions/weekly-sage-player-season` +
    `?season=${encodeURIComponent(season)}` +
    `&week=${encodeURIComponent(week)}` +
    `&playerID=${encodeURIComponent(playerID)}` +
    `&seasonType=${encodeURIComponent(seasonType)}`;

  const data =
    await fetchJson(url);

  if (
    !data ||
    data.evidenceType !==
      "weekly-sage-player-season"
  ) {
    throw new Error(
      "Unexpected player-season evidence schema."
    );
  }

  return data;
}

async function fetchPlayerMatchup({
  baseUrl,
  season,
  week,
  team,
  position,
  seasonType
}) {
  const url =
    `${baseUrl}/.netlify/functions/weekly-sage-player-matchup` +
    `?season=${encodeURIComponent(season)}` +
    `&week=${encodeURIComponent(week)}` +
    `&team=${encodeURIComponent(team)}` +
    `&position=${encodeURIComponent(position)}` +
    `&seasonType=${encodeURIComponent(seasonType)}`;

  const data =
    await fetchJson(url);

  if (
    !data ||
    data.evidenceType !==
      "weekly-sage-player-matchup"
  ) {
    throw new Error(
      "Unexpected player-matchup evidence schema."
    );
  }

  return data;
}

function buildRBProduction(
  playerSeason
) {
  const perGame =
    playerSeason.perGame ||
    {};

  const rushing =
    perGame.rushing ||
    {};

  const receiving =
    perGame.receiving ||
    {};

  return {
    rushing: {
      carriesPerGame:
        num(
          rushing.carriesPerGame
        ),

      yardsPerGame:
        num(
          rushing.yardsPerGame
        ),

      yardsPerCarry:
        num(
          rushing.yardsPerCarry
        ),

      touchdownsPerGame:
        num(
          rushing.touchdownsPerGame
        )
    },

    receiving: {
      targetsPerGame:
        num(
          receiving.targetsPerGame
        ),

      receptionsPerGame:
        num(
          receiving.receptionsPerGame
        ),

      yardsPerGame:
        num(
          receiving.yardsPerGame
        ),

      touchdownsPerGame:
        num(
          receiving.touchdownsPerGame
        )
    },

    scrimmage: {
      yardsPerGame:
        round(
          num(
            rushing.yardsPerGame
          ) +
          num(
            receiving.yardsPerGame
          )
        ),

      opportunitiesPerGame:
        round(
          num(
            rushing.carriesPerGame
          ) +
          num(
            receiving.targetsPerGame
          )
        )
    }
  };
}

function buildQBProduction(
  playerSeason
) {
  const perGame =
    playerSeason.perGame ||
    {};

  const passing =
    perGame.passing ||
    {};

  const rushing =
    perGame.rushing ||
    {};

  return {
    passing: {
      attemptsPerGame:
        num(
          passing.attemptsPerGame
        ),

      completionsPerGame:
        num(
          passing.completionsPerGame
        ),

      yardsPerGame:
        num(
          passing.yardsPerGame
        ),

      yardsPerAttempt:
        num(
          passing.yardsPerAttempt
        ),

      completionPct:
        num(
          passing.completionPct
        ),

      touchdownsPerGame:
        num(
          passing.touchdownsPerGame
        ),

      interceptionsPerGame:
        num(
          passing.interceptionsPerGame
        )
    },

    rushing: {
      carriesPerGame:
        num(
          rushing.carriesPerGame
        ),

      yardsPerGame:
        num(
          rushing.yardsPerGame
        ),

      touchdownsPerGame:
        num(
          rushing.touchdownsPerGame
        )
    }
  };
}

function buildReceiverProduction(
  playerSeason
) {
  const perGame =
    playerSeason.perGame ||
    {};

  const receiving =
    perGame.receiving ||
    {};

  const rushing =
    perGame.rushing ||
    {};

  return {
    receiving: {
      targetsPerGame:
        num(
          receiving.targetsPerGame
        ),

      receptionsPerGame:
        num(
          receiving.receptionsPerGame
        ),

      yardsPerGame:
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

      touchdownsPerGame:
        num(
          receiving.touchdownsPerGame
        )
    },

    rushing: {
      carriesPerGame:
        num(
          rushing.carriesPerGame
        ),

      yardsPerGame:
        num(
          rushing.yardsPerGame
        )
    }
  };
}

function buildProductionEvidence(
  position,
  playerSeason
) {
  switch (position) {
    case "RB":
      return buildRBProduction(
        playerSeason
      );

    case "QB":
      return buildQBProduction(
        playerSeason
      );

    case "WR":
    case "TE":
      return buildReceiverProduction(
        playerSeason
      );

    default:
      return {};
  }
}

function usageDescription({
  position,
  usage
}) {
  if (!usage) {
    return null;
  }

  switch (position) {
    case "RB":
      return (
        `${num(
          usage.carriesPerGame
        ).toFixed(1)} carries and ` +
        `${num(
          usage.targetsPerGame
        ).toFixed(1)} targets per game ` +
        `with ${num(
          usage.offensiveSnapPct
        ).toFixed(1)}% offensive snap share.`
      );

    case "QB":
      return (
        `${num(
          usage.passAttemptsPerGame
        ).toFixed(1)} pass attempts per game ` +
        `with ${num(
          usage.carriesPerGame
        ).toFixed(1)} rushing attempts and ` +
        `${num(
          usage.offensiveSnapPct
        ).toFixed(1)}% offensive snap share.`
      );

    case "WR":
    case "TE":
      return (
        `${num(
          usage.targetsPerGame
        ).toFixed(1)} targets and ` +
        `${num(
          usage.receptionsPerGame
        ).toFixed(1)} receptions per game ` +
        `with ${num(
          usage.offensiveSnapPct
        ).toFixed(1)}% offensive snap share.`
      );

    default:
      return null;
  }
}

function productionDescription({
  position,
  production
}) {
  if (!production) {
    return null;
  }

  switch (position) {
    case "RB":
      return (
        `${num(
          production.rushing
            .yardsPerGame
        ).toFixed(1)} rushing yards and ` +
        `${num(
          production.receiving
            .yardsPerGame
        ).toFixed(1)} receiving yards per game, ` +
        `${num(
          production.scrimmage
            .yardsPerGame
        ).toFixed(1)} total yards from scrimmage per game.`
      );

    case "QB":
      return (
        `${num(
          production.passing
            .yardsPerGame
        ).toFixed(1)} passing yards per game at ` +
        `${num(
          production.passing
            .yardsPerAttempt
        ).toFixed(2)} yards per attempt, plus ` +
        `${num(
          production.rushing
            .yardsPerGame
        ).toFixed(1)} rushing yards per game.`
      );

    case "WR":
    case "TE":
      return (
        `${num(
          production.receiving
            .yardsPerGame
        ).toFixed(1)} receiving yards per game on ` +
        `${num(
          production.receiving
            .targetsPerGame
        ).toFixed(1)} targets per game at ` +
        `${num(
          production.receiving
            .yardsPerTarget
        ).toFixed(2)} yards per target.`
      );

    default:
      return null;
  }
}

function buildEvidenceSummary({
  playerSeason,
  playerMatchup,
  productionEvidence
}) {
  const player =
    playerSeason.player ||
    {};

  const matchup =
    playerMatchup
      .matchupEvidence ||
    {};

  const context =
    playerMatchup
      .playerContext ||
    {};

  const usage =
    playerSeason
      .usageProfile ||
    {};

  return {
    usage:
      usageDescription({
        position:
          player.position,

        usage
      }),

    production:
      productionDescription({
        position:
          player.position,

        production:
          productionEvidence
      }),

    matchup:
      matchup.explanation ||
      null,

    upcomingGame:
      context.opponent
        ? (
            `${player.team} ${
              context.location === "home"
                ? "hosts"
                : "visits"
            } ${context.opponent}.`
          )
        : null
  };
}

function buildEvidenceFlags({
  playerSeason,
  playerMatchup
}) {
  const matchup =
    playerMatchup
      .matchupEvidence ||
    {};

  const usage =
    playerSeason
      .usageProfile ||
    {};

  const flags = [];

  if (
    num(
      usage.offensiveSnapPct
    ) >= 70
  ) {
    flags.push({
      type:
        "usage",

      direction:
        "positive",

      code:
        "high_snap_share",

      message:
        "Player has been on the field for at least 70% of offensive snaps."
    });
  }

  if (
    playerSeason.player &&
    playerSeason.player
      .position === "RB"
  ) {
    if (
      num(
        usage.carriesPerGame
      ) >= 15
    ) {
      flags.push({
        type:
          "usage",

        direction:
          "positive",

        code:
          "strong_rushing_volume",

        message:
          "Player is averaging at least 15 rushing attempts per game."
      });
    }

    if (
      num(
        usage.targetsPerGame
      ) >= 4
    ) {
      flags.push({
        type:
          "usage",

        direction:
          "positive",

        code:
          "receiving_involvement",

        message:
          "Player has meaningful involvement in the receiving game."
      });
    }
  }

  if (
    matchup.signal ===
      "strong_positive"
  ) {
    flags.push({
      type:
        "matchup",

      direction:
        "positive",

      code:
        "strong_matchup",

      message:
        "Opponent matchup is among the most favorable in the league."
    });
  } else if (
    matchup.signal ===
      "positive"
  ) {
    flags.push({
      type:
        "matchup",

      direction:
        "positive",

      code:
        "favorable_matchup",

      message:
        "Opponent matchup is favorable relative to the league."
    });
  } else if (
    matchup.signal ===
      "strong_negative"
  ) {
    flags.push({
      type:
        "matchup",

      direction:
        "negative",

      code:
        "very_difficult_matchup",

      message:
        "Opponent matchup is among the most difficult in the league."
    });
  } else if (
    matchup.signal ===
      "negative"
  ) {
    flags.push({
      type:
        "matchup",

      direction:
        "negative",

      code:
        "difficult_matchup",

      message:
        "Opponent matchup is difficult relative to the league."
    });
  }

  /*
    IMPORTANT:
    Evidence flags are descriptive observations.

    They are NOT additive scoring bonuses or penalties.
    They must not be interpreted as a START/SIT recommendation.
  */

  return flags;
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

      /*
        First retrieve validated player identity + production evidence.

        We deliberately do this first because team and position should
        come from the player evidence source rather than being supplied
        independently by the caller.
      */
      const playerSeason =
        await fetchPlayerSeason({
          baseUrl,
          season,
          week,
          playerID,
          seasonType
        });

      const player =
        playerSeason.player ||
        {};

      if (
        !player.team ||
        !player.position
      ) {
        throw new Error(
          "Player evidence did not contain team and position."
        );
      }

      /*
        Now route that ACTUAL team + position through the already
        validated player-matchup layer.
      */
      const playerMatchup =
        await fetchPlayerMatchup({
          baseUrl,
          season,
          week,
          team:
            player.team,
          position:
            player.position,
          seasonType
        });

      const productionEvidence =
        buildProductionEvidence(
          player.position,
          playerSeason
        );

      const summary =
        buildEvidenceSummary({
          playerSeason,
          playerMatchup,
          productionEvidence
        });

      const flags =
        buildEvidenceFlags({
          playerSeason,
          playerMatchup
        });

      return jsonResponse(
        200,
        {
          evidenceType:
            "weekly-sage-player-evidence",

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
              null
          },

          noLookAhead:
            playerSeason
              .noLookAhead,

          sample: {
            gamesUsed:
              playerSeason
                .gamesUsed,

            weeksIncluded:
              playerSeason
                .noLookAhead
                ? playerSeason
                    .noLookAhead
                    .weeksIncluded
                : []
          },

          upcomingGame:
            playerMatchup
              .playerContext,

          usageEvidence:
            playerSeason
              .usageProfile,

          productionEvidence,

          matchupEvidence:
            playerMatchup
              .matchupEvidence,

          evidenceFlags:
            flags,

          summary,

          /*
            Preserve provenance so later SAGE recommendation logic can
            know exactly where every component originated.
          */
          provenance: {
            playerProduction:
              "weekly-sage-player-season",

            upcomingOpponent:
              "weekly-sage-schedule",

            defensiveMatchup:
              "weekly-sage-matchup-defense",

            matchupRouting:
              "weekly-sage-player-matchup"
          }
        },

        CACHE_CONTROL
      );
    } catch (error) {
      console.error(
        "weekly-sage-player-evidence failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not compose Weekly SAGE player evidence.",

          detail:
            error.message
        }
      );
    }
  };
