// netlify/functions/weekly-sage-defense-season.js
//
// WEEKLY SAGE — SEASON-TO-DATE DEFENSIVE EVIDENCE
//
// Given:
//   season=2025
//   week=8
//
// this endpoint aggregates Weekly SAGE defensive evidence from:
//   Weeks 1 through 7
//
// Week 8 itself is EXCLUDED so SAGE does not use future/current-week
// results when making a Week 8 lineup recommendation.
//
// This function consumes validated weekly defensive evidence from:
//   Netlify Blob store: weekly-sage-defense
//
// It does NOT call Tank01 directly.
// It does NOT rebuild missing weekly evidence on demand.
// It does NOT contain SAGE recommendation logic.
//
// ═══════════════════════════════════════════════════════════════════════

const {
  connectLambda,
  getStore
} = require("@netlify/blobs");

const DEFAULT_SEASON_TYPE = "reg";

const STORE_NAME =
  "weekly-sage-defense";

const CACHE_CONTROL =
  "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400";

function numberValue(value) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : 0;
}

function emptyDefenseProfile(team) {
  return {
    team,

    games: 0,

    runDefense: {
      attemptsAllowed: 0,
      yardsAllowed: 0,
      touchdownsAllowed: 0,
      yardsPerCarryAllowed: 0
    },

    passDefense: {
      attemptsAllowed: 0,
      completionsAllowed: 0,
      yardsAllowed: 0,
      touchdownsAllowed: 0,
      interceptions: 0,
      sacks: 0,
      yardsPerAttemptAllowed: 0,
      completionPctAllowed: 0
    },

    totalDefense: {
      yardsAllowed: 0,
      playsFaced: 0,
      yardsPerPlayAllowed: 0
    },

    gamesUsed: []
  };
}

function ensureDefense(map, team) {
  if (!map[team]) {
    map[team] =
      emptyDefenseProfile(team);
  }

  return map[team];
}

function mergeWeeklyDefense(
  seasonProfile,
  weeklyProfile
) {
  seasonProfile.games +=
    numberValue(
      weeklyProfile.games
    );

  seasonProfile
    .runDefense
    .attemptsAllowed +=
      numberValue(
        weeklyProfile
          .runDefense
          .attemptsAllowed
      );

  seasonProfile
    .runDefense
    .yardsAllowed +=
      numberValue(
        weeklyProfile
          .runDefense
          .yardsAllowed
      );

  seasonProfile
    .runDefense
    .touchdownsAllowed +=
      numberValue(
        weeklyProfile
          .runDefense
          .touchdownsAllowed
      );

  seasonProfile
    .passDefense
    .attemptsAllowed +=
      numberValue(
        weeklyProfile
          .passDefense
          .attemptsAllowed
      );

  seasonProfile
    .passDefense
    .completionsAllowed +=
      numberValue(
        weeklyProfile
          .passDefense
          .completionsAllowed
      );

  seasonProfile
    .passDefense
    .yardsAllowed +=
      numberValue(
        weeklyProfile
          .passDefense
          .yardsAllowed
      );

  seasonProfile
    .passDefense
    .touchdownsAllowed +=
      numberValue(
        weeklyProfile
          .passDefense
          .touchdownsAllowed
      );

  seasonProfile
    .passDefense
    .interceptions +=
      numberValue(
        weeklyProfile
          .passDefense
          .interceptions
      );

  seasonProfile
    .passDefense
    .sacks +=
      numberValue(
        weeklyProfile
          .passDefense
          .sacks
      );

  seasonProfile
    .totalDefense
    .yardsAllowed +=
      numberValue(
        weeklyProfile
          .totalDefense
          .yardsAllowed
      );

  seasonProfile
    .totalDefense
    .playsFaced +=
      numberValue(
        weeklyProfile
          .totalDefense
          .playsFaced
      );

  if (
    Array.isArray(
      weeklyProfile.gamesUsed
    )
  ) {
    seasonProfile.gamesUsed.push(
      ...weeklyProfile.gamesUsed
    );
  }
}

function finalizeDefense(profile) {
  const result =
    JSON.parse(
      JSON.stringify(profile)
    );

  const run =
    result.runDefense;

  const pass =
    result.passDefense;

  const total =
    result.totalDefense;

  run.yardsPerCarryAllowed =
    run.attemptsAllowed > 0
      ? Number(
          (
            run.yardsAllowed /
            run.attemptsAllowed
          ).toFixed(2)
        )
      : 0;

  pass.yardsPerAttemptAllowed =
    pass.attemptsAllowed > 0
      ? Number(
          (
            pass.yardsAllowed /
            pass.attemptsAllowed
          ).toFixed(2)
        )
      : 0;

  pass.completionPctAllowed =
    pass.attemptsAllowed > 0
      ? Number(
          (
            (
              pass.completionsAllowed /
              pass.attemptsAllowed
            ) *
            100
          ).toFixed(1)
        )
      : 0;

  total.yardsPerPlayAllowed =
    total.playsFaced > 0
      ? Number(
          (
            total.yardsAllowed /
            total.playsFaced
          ).toFixed(2)
        )
      : 0;

  result.perGame = {
    rushAttemptsAllowed:
      result.games > 0
        ? Number(
            (
              run.attemptsAllowed /
              result.games
            ).toFixed(1)
          )
        : 0,

    rushYardsAllowed:
      result.games > 0
        ? Number(
            (
              run.yardsAllowed /
              result.games
            ).toFixed(1)
          )
        : 0,

    rushTDAllowed:
      result.games > 0
        ? Number(
            (
              run.touchdownsAllowed /
              result.games
            ).toFixed(2)
          )
        : 0,

    passAttemptsAllowed:
      result.games > 0
        ? Number(
            (
              pass.attemptsAllowed /
              result.games
            ).toFixed(1)
          )
        : 0,

    passYardsAllowed:
      result.games > 0
        ? Number(
            (
              pass.yardsAllowed /
              result.games
            ).toFixed(1)
          )
        : 0,

    passTDAllowed:
      result.games > 0
        ? Number(
            (
              pass.touchdownsAllowed /
              result.games
            ).toFixed(2)
          )
        : 0,

    interceptions:
      result.games > 0
        ? Number(
            (
              pass.interceptions /
              result.games
            ).toFixed(2)
          )
        : 0,

    sacks:
      result.games > 0
        ? Number(
            (
              pass.sacks /
              result.games
            ).toFixed(2)
          )
        : 0,

    totalYardsAllowed:
      result.games > 0
        ? Number(
            (
              total.yardsAllowed /
              result.games
            ).toFixed(1)
          )
        : 0
  };

  return result;
}

async function fetchWeeklyEvidence({
  store,
  season,
  week,
  seasonType
}) {
  const key =
    `week:${season}:${week}:${seasonType}`;

  const data =
    await store.get(
      key,
      {
        type: "json"
      }
    );

  if (!data) {
    throw new Error(
      `Week ${week} cached defensive evidence is missing.`
    );
  }

  if (
    data.evidenceType !==
      "weekly-sage-defense-week"
  ) {
    throw new Error(
      `Week ${week} returned an unexpected evidence schema.`
    );
  }

  if (
    String(data.season) !==
      String(season)
  ) {
    throw new Error(
      `Week ${week} cached season mismatch.`
    );
  }

  if (
    Number(data.week) !==
      Number(week)
  ) {
    throw new Error(
      `Week ${week} cached week mismatch.`
    );
  }

  if (
    data.seasonType !==
      seasonType
  ) {
    throw new Error(
      `Week ${week} cached seasonType mismatch.`
    );
  }

  if (
    !data.schedule ||
    typeof data.schedule !==
      "object"
  ) {
    throw new Error(
      `Week ${week} cached schedule is missing.`
    );
  }

  if (
    Number(
      data.schedule.completedGames
    ) !==
    Number(
      data.schedule.processedGames
    )
  ) {
    throw new Error(
      `Week ${week} cached evidence is incomplete.`
    );
  }

  if (
    !data.defenses ||
    typeof data.defenses !==
      "object" ||
    Array.isArray(data.defenses)
  ) {
    throw new Error(
      `Week ${week} cached defenses are missing.`
    );
  }

  return data;
}

async function mapWithConcurrency(
  items,
  limit,
  worker
) {
  const results =
    new Array(items.length);

  let nextIndex = 0;

  async function runner() {
    while (true) {
      const index =
        nextIndex++;

      if (index >= items.length) {
        return;
      }

      try {
        results[index] =
          await worker(
            items[index],
            index
          );
      } catch (error) {
        results[index] = {
          error
        };
      }
    }
  }

  const runnerCount =
    Math.min(
      limit,
      items.length
    );

  const runners = [];

  for (
    let i = 0;
    i < runnerCount;
    i += 1
  ) {
    runners.push(
      runner()
    );
  }

  await Promise.all(runners);

  return results;
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
        cacheControl || "no-store"
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
    connectLambda(event);

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

    const targetWeek =
      Number(query.week);

    const seasonType =
      String(
        query.seasonType ||
        DEFAULT_SEASON_TYPE
      );

    if (
      !Number.isInteger(targetWeek) ||
      targetWeek < 1 ||
      targetWeek > 18
    ) {
      return jsonResponse(
        400,
        {
          error:
            "week must be an integer from 1 through 18."
        }
      );
    }

    if (
      ![
        "reg",
        "pre",
        "post",
        "all"
      ].includes(seasonType)
    ) {
      return jsonResponse(
        400,
        {
          error:
            "seasonType must be reg, pre, post, or all."
        }
      );
    }

    /*
      Week 1 has no current-season games before it.

      Return a valid empty evidence object rather than treating that as
      an error. Later SAGE logic can explicitly recognize the zero-game
      sample and fall back to preseason/prior-year evidence.
    */
    if (targetWeek === 1) {
      return jsonResponse(
        200,
        {
          evidenceType:
            "weekly-sage-defense-season",

          schemaVersion:
            1,

          generatedAt:
            new Date()
              .toISOString(),

          season:
            season,

          targetWeek:
            targetWeek,

          seasonType:
            seasonType,

          weeksIncluded:
            [],

          weekResults:
            [],

          defenses:
            {}
        },

        CACHE_CONTROL
      );
    }

    try {
      const store =
        getStore({
          name: STORE_NAME
        });

      const weeksIncluded =
        Array.from(
          {
            length:
              targetWeek - 1
          },
          function (_, index) {
            return index + 1;
          }
        );

      /*
        Read a few cached weekly snapshots at a time.

        Missing or incomplete weekly evidence is never rebuilt here.
        The scheduled/shared evidence writer owns creation of each
        weekly defensive snapshot.
      */
      const weeklyResults =
        await mapWithConcurrency(
          weeksIncluded,
          3,
          async function (week) {
            try {
              const data =
                await fetchWeeklyEvidence({
                  store,
                  season,
                  week,
                  seasonType
                });

              return {
                week,
                status:
                  "processed",

                schedule:
                  data.schedule,

                defenses:
                  data.defenses ||
                  {}
              };
            } catch (error) {
              return {
                week,
                status:
                  "error",

                error:
                  error.message,

                defenses:
                  {}
              };
            }
          }
        );

      const failedWeeks =
        weeklyResults.filter(
          function (result) {
            return (
              !result ||
              result.status !==
                "processed"
            );
          }
        );

      /*
        Do not quietly return partial season evidence.

        A missing historical week could materially distort SAGE's
        opponent evaluation. Fail loudly so we never make a recommendation
        from an incomplete sample while presenting it as complete.
      */
      if (failedWeeks.length > 0) {
        return jsonResponse(
          502,
          {
            error:
              "Could not build complete season-to-date defensive evidence.",

            season:
              season,

            targetWeek:
              targetWeek,

            failedWeeks:
              failedWeeks.map(
                function (result) {
                  return {
                    week:
                      result.week,

                    error:
                      result.error ||
                      "Unknown error"
                  };
                }
              )
          }
        );
      }

      const defenseMap = {};

      weeklyResults.forEach(
        function (weekResult) {
          const defenses =
            weekResult.defenses ||
            {};

          Object.keys(
            defenses
          ).forEach(
            function (team) {
              const seasonProfile =
                ensureDefense(
                  defenseMap,
                  team
                );

              mergeWeeklyDefense(
                seasonProfile,
                defenses[team]
              );
            }
          );
        }
      );

      const defenses = {};

      Object
        .keys(defenseMap)
        .sort()
        .forEach(
          function (team) {
            defenses[team] =
              finalizeDefense(
                defenseMap[team]
              );
          }
        );

      const weekResults =
        weeklyResults.map(
          function (result) {
            return {
              week:
                result.week,

              status:
                result.status,

              gamesReturned:
                result.schedule
                  ? result.schedule
                      .gamesReturned
                  : 0,

              completedGames:
                result.schedule
                  ? result.schedule
                      .completedGames
                  : 0,

              processedGames:
                result.schedule
                  ? result.schedule
                      .processedGames
                  : 0
            };
          }
        );

      return jsonResponse(
        200,
        {
          evidenceType:
            "weekly-sage-defense-season",

          schemaVersion:
            1,

          generatedAt:
            new Date()
              .toISOString(),

          season:
            season,

          targetWeek:
            targetWeek,

          seasonType:
            seasonType,

          weeksIncluded:
            weeksIncluded,

          weekResults:
            weekResults,

          defenses:
            defenses
        },

        CACHE_CONTROL
      );
    } catch (error) {
      console.error(
        "weekly-sage-defense-season failed:",
        error
      );

      return jsonResponse(
        502,
        {
          error:
            "Could not build season-to-date Weekly SAGE defensive evidence.",

          detail:
            error.message
        }
      );
    }
  };
