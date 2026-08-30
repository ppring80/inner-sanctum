// netlify/functions/weekly-sage-def-leaderboard.js
//
// WEEKLY SAGE — DEF/ST LEADERBOARD
//
// PURPOSE
// -------
// Build the customer-facing Weekly SAGE DEF leaderboard for one
// target week, entirely from already-cached evidence.
//
// SOURCES (both cache-only, both fail-fast on a miss)
// ----------------------------------------------------
//   def-snapshot              (weekly-sage-def-snapshot.js's own
//                               output, written by
//                               refresh-def-snapshot.js)
//   weekly-sage-schedule       (for this week's opponent per team)
//
// This function makes ZERO direct Tank01 calls, and does NOT call
// weekly-sage-def-snapshot.js's builder itself -- if the cache is
// missing, this fails fast (503) rather than rebuilding live. That
// rebuild remains available only via refresh-def-snapshot.js's own
// manual/future-scheduled path -- never from a customer request.
//
// COMPOSITE SCORE
// -----------------
// Scoring prevention (45%) and defensive disruption (30%) are
// already fully computed on each snapshot record. Opponent
// environment (25%) is inherently CURRENT-WEEK-specific -- it
// depends on which team this DEF unit actually faces -- so it is
// resolved here, at leaderboard build time, by looking up the
// current week's opponent's own ownOffenseYardsPerGame (already
// computed in the snapshot for every team) and percentile-ranking it
// against the full league distribution the snapshot also provides.
// This does NOT recalculate scoring prevention or disruption --
// those percentiles are read verbatim from the snapshot.
//
// This function does NOT use the QB/RB/WR/TE or K recommendation
// model -- DEF's own SAGE Take is built locally in this file.
//
// ═══════════════════════════════════════════════════════════════════════

const {
  connectLambda,
  getStore
} = require(
  "@netlify/blobs"
);

const DEFAULT_SEASON_TYPE =
  "reg";

const DEF_SNAPSHOT_STORE =
  "def-snapshot";

const SCHEDULE_STORE =
  "weekly-sage-schedule";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

const DEFAULT_TEAMS =
  12;

const OPPONENT_ENVIRONMENT_WEIGHT =
  0.25;

const SCORING_PREVENTION_WEIGHT =
  0.45;

const DISRUPTION_WEIGHT =
  0.30;

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

function normalizeTeam(value) {
  const raw =
    String(value || "")
      .trim()
      .toUpperCase();

  const aliases = {
    JAC: "JAX",
    GBP: "GB",
    KAN: "KC",
    LVR: "LV",
    NEP: "NE",
    NOR: "NO",
    SFO: "SF",
    TBB: "TB",
    WAS: "WSH"
  };

  return aliases[raw] || raw;
}

async function readDefSnapshot({
  season,
  targetWeek,
  seasonType
}) {
  const key =
    `week:${season}:${targetWeek}:${seasonType}`;

  let cached =
    null;

  try {
    const store =
      getStore({
        name:
          DEF_SNAPSHOT_STORE
      });

    cached =
      await store.get(
        key,
        {
          type: "json"
        }
      );
  } catch (error) {
    const err =
      new Error(
        "DEF snapshot cache could not be read."
      );

    err.statusCode = 503;
    err.detail = error && error.message;
    throw err;
  }

  if (
    !cached ||
    cached.evidenceType !==
      "weekly-sage-def-snapshot"
  ) {
    const err =
      new Error(
        `No cached DEF snapshot found for ${key}. Run refresh-def-snapshot first.`
      );

    err.statusCode = 503;
    throw err;
  }

  return cached;
}

async function readSchedule({
  season,
  targetWeek,
  seasonType
}) {
  const key =
    `week:${season}:${targetWeek}:${seasonType}`;

  let cached =
    null;

  try {
    const store =
      getStore({
        name:
          SCHEDULE_STORE
      });

    cached =
      await store.get(
        key,
        {
          type: "json"
        }
      );
  } catch (error) {
    const err =
      new Error(
        "Weekly SAGE schedule cache could not be read."
      );

    err.statusCode = 503;
    err.detail = error && error.message;
    throw err;
  }

  if (
    !cached ||
    cached.evidenceType !==
      "weekly-sage-schedule"
  ) {
    const err =
      new Error(
        `No cached Weekly SAGE schedule found for ${key}. Run refresh-weekly-sage-schedule first.`
      );

    err.statusCode = 503;
    throw err;
  }

  return cached;
}

function buildOpponentMap(schedule) {
  const map =
    new Map();

  const games =
    Array.isArray(
      schedule.games
    )
      ? schedule.games
      : [];

  games.forEach(function (game) {
    const away =
      normalizeTeam(
        game.away
      );

    const home =
      normalizeTeam(
        game.home
      );

    if (away && home) {
      map.set(away, home);
      map.set(home, away);
    }
  });

  const byeTeams =
    Array.isArray(
      schedule.byeTeams
    )
      ? schedule.byeTeams
      : [];

  byeTeams.forEach(function (team) {
    const normalized =
      normalizeTeam(team);

    if (normalized) {
      map.set(normalized, "BYE");
    }
  });

  return map;
}

/*
  Percentile: fraction of the population <= value, 0-100. Same
  convention already used in weekly-sage-def-snapshot.js and
  weekly-sage-k-snapshot.js -- duplicated locally rather than
  imported, matching the established "no shared cross-position
  scoring machinery" discipline.
*/
function percentileRank(value, population) {
  if (!population.length) return 50;

  const countAtOrBelow = population.filter(function (v) {
    return v <= value;
  }).length;

  return Math.round((countAtOrBelow / population.length) * 100);
}

/*
  DEF-specific deterministic SAGE Take -- built locally from the same
  component evidence already resolved for this record. Never routes
  through QB/RB/WR/TE/K take logic. No network/AI call.
*/
function buildDefSageTake(record) {
  try {
    const components =
      record.components ||
      {};

    const signals =
      [
        { key: "scoringPrevention", pct: components.scoringPrevention && components.scoringPrevention.percentile },
        { key: "disruption", pct: components.disruption && components.disruption.percentile },
        { key: "opponentEnvironment", pct: components.opponentEnvironment && components.opponentEnvironment.percentile }
      ].filter(function (s) {
        return typeof s.pct === "number";
      });

    if (!signals.length) {
      return null;
    }

    signals.sort(function (a, b) {
      return Math.abs(b.pct - 50) - Math.abs(a.pct - 50);
    });

    const primary =
      signals[0];

    const phraseFor = {
      scoringPrevention: {
        high: "Allows few points",
        low: "Has been giving up points"
      },
      disruption: {
        high: "Generates consistent pressure and takeaways",
        low: "Limited pressure and takeaways so far"
      },
      opponentEnvironment: {
        high: "Faces a limited offense this week",
        low: "Faces a strong offense this week"
      }
    };

    const direction =
      primary.pct >= 50
        ? "high"
        : "low";

    const lead =
      phraseFor[primary.key][direction];

    const confidenceClause =
      record.sageConfidenceLabel &&
      record.sageConfidenceLabel !== "Full" &&
      record.sageConfidenceLabel !== "High"
        ? " Still a small sample this season."
        : "";

    return (
      lead +
      "." +
      confidenceClause
    );
  } catch (error) {
    return null;
  }
}

exports.handler =
  async function (
    event
  ) {
    connectLambda(
      event
    );

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
      )
        .trim()
        .toLowerCase();

    const teams =
      Number(
        query.teams
      ) ||
      DEFAULT_TEAMS;

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

    try {
      const [
        snapshot,
        schedule
      ] =
        await Promise.all([
          readDefSnapshot({
            season,
            targetWeek,
            seasonType
          }),

          readSchedule({
            season,
            targetWeek,
            seasonType
          })
        ]);

      const opponentMap =
        buildOpponentMap(
          schedule
        );

      const offenseYardsPopulation =
        Array.isArray(
          snapshot.allOffenseYardsValues
        )
          ? snapshot.allOffenseYardsValues
          : [];

      const byTeam = {};

      snapshot.population.forEach(function (record) {
        byTeam[record.team] = record;
      });

      const scored =
        snapshot.population.map(function (record) {
          const opponent =
            opponentMap.get(
              normalizeTeam(
                record.team
              )
            ) || null;

          let opponentEnvironmentPct =
            50;

          if (
            opponent &&
            opponent !== "BYE"
          ) {
            const opponentRecord =
              byTeam[
                normalizeTeam(
                  opponent
                )
              ];

            if (
              opponentRecord &&
              typeof opponentRecord.ownOffenseYardsPerGame ===
                "number"
            ) {
              // Higher opponent offensive yardage = tougher matchup
              // for THIS defense, so the percentile is inverted --
              // facing the league's most productive offense should
              // score near 0, not near 100.
              opponentEnvironmentPct =
                100 -
                percentileRank(
                  opponentRecord.ownOffenseYardsPerGame,
                  offenseYardsPopulation
                );
            }
          }

          const scoringPreventionPct =
            record.components &&
            record.components.scoringPrevention
              ? record.components.scoringPrevention.percentile
              : 50;

          const disruptionPct =
            record.components &&
            record.components.disruption
              ? record.components.disruption.percentile
              : 50;

          const compositeScore =
            Math.round(
              scoringPreventionPct *
                SCORING_PREVENTION_WEIGHT +
              disruptionPct *
                DISRUPTION_WEIGHT +
              opponentEnvironmentPct *
                OPPONENT_ENVIRONMENT_WEIGHT
            );

          return {
            playerID:
              record.team,

            name:
              record.team,

            team:
              record.team,

            position:
              "DEF",

            opponent:
              opponent,

            sageScore:
              compositeScore,

            sageConfidenceLabel:
              record.sageConfidenceLabel,

            sacks:
              record.sacks,

            interceptions:
              record.interceptions,

            pointsAllowedPerGame:
              record.pointsAllowedPerGame,

            components: {
              scoringPrevention:
                record.components &&
                record.components
                  .scoringPrevention,

              disruption:
                record.components &&
                record.components
                  .disruption,

              opponentEnvironment: {
                percentile:
                  opponentEnvironmentPct
              }
            }
          };
        });

      scored.sort(function (a, b) {
        return (
          (b.sageScore || 0) -
          (a.sageScore || 0)
        );
      });

      const leaderboard =
        scored.map(function (
          record,
          index
        ) {
          const positionRank =
            index + 1;

          const recommendation =
            record.opponent === "BYE"
              ? null
              : (positionRank <= teams
                  ? "START"
                  : "SIT");

          return {
            playerID:
              record.playerID,

            name:
              record.name,

            team:
              record.team,

            position:
              "DEF",

            opponent:
              record.opponent,

            rank:
              positionRank,

            sage: {
              score:
                record.sageScore,

              confidenceLabel:
                record.sageConfidenceLabel
            },

            recommendation:
              recommendation,

            sacks:
              record.sacks,

            interceptions:
              record.interceptions,

            pointsAllowedPerGame:
              record.pointsAllowedPerGame,

            components:
              record.components,

            sageTake:
              buildDefSageTake(
                record
              )
          };
        });

      return jsonResponse(
        200,
        {
          evidenceType:
            "weekly-sage-def-leaderboard",

          schemaVersion:
            1,

          generatedAt:
            new Date()
              .toISOString(),

          season,

          targetWeek,

          seasonType,

          position:
            "DEF",

          methodology: {
            modelVersion:
              "def-sage-v1",

            philosophy:
              "Scoring prevention 45% / Defensive disruption 30% / Opponent environment 25%. DEF-specific -- does not use QB/RB/WR/TE or K methodology, and does not use fumbles, defensive/special-teams touchdowns, safeties, blocked kicks, or return touchdowns.",

            ranking:
              "Descending Weekly SAGE DEF score.",

            recommendationThresholds: {
              starterCount:
                teams,

              definitions: {
                START:
                  `Weekly SAGE DEF rank 1 through ${teams}`,

                SIT:
                  `Weekly SAGE DEF rank ${teams + 1} and beyond`
              }
            }
          },

          architecture: {
            populationSource:
              DEF_SNAPSHOT_STORE,

            scheduleSource:
              SCHEDULE_STORE,

            populationRebuiltByLeaderboard:
              false,

            directTank01Calls:
              0
          },

          leaderboard,

          nextStep: {
            ready:
              leaderboard.length >
              0,

            reason:
              leaderboard.length >
              0
                ? "DEF leaderboard built successfully from cached evidence."
                : "No DEF candidates found in the cached snapshot for this week."
          }
        },

        CACHE_CONTROL
      );
    } catch (error) {
      if (
        typeof (
          error &&
          error.statusCode
        ) ===
        "number"
      ) {
        return jsonResponse(
          error.statusCode,
          {
            error:
              error.message,

            detail:
              error.detail ||
              null
          }
        );
      }

      console.error(
        "weekly-sage-def-leaderboard failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not build Weekly SAGE DEF leaderboard.",

          detail:
            error &&
            error.message
              ? error.message
              : String(
                  error
                )
        }
      );
    }
  };
