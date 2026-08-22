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
// This function consumes the already-deployed:
//   /.netlify/functions/weekly-sage-defense-week
//
// It does NOT call Tank01 directly.
// It does NOT contain SAGE recommendation logic.
//
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_SEASON_TYPE = "reg";

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

function getBaseUrl(event) {
  const proto =
    event.headers &&
    (
      event.headers["x-forwarded-proto"] ||
      event.headers["X-Forwarded-Proto"]
    )
      ? (
          event.headers["x-forwarded-proto"] ||
          event.headers["X-Forwarded-Proto"]
        )
      : "https";

  const host =
    event.headers &&
    (
      event.headers.host ||
      event.headers.Host
    );

  if (!host) {
    throw new Error(
      "Could not determine host for internal Weekly SAGE evidence request."
    );
  }

  return `${proto}://${host}`;
}

async function fetchWeeklyEvidence({
  baseUrl,
  season,
  week,
  seasonType
}) {
  const url =
    `${baseUrl}/.netlify/functions/weekly-sage-defense-week` +
    `?season=${encodeURIComponent(season)}` +
    `&week=${encodeURIComponent(week)}` +
    `&seasonType=${encodeURIComponent(seasonType)}`;

  const response =
    await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });

  let data = null;

  try {
    data = await response.json();
  } catch (err) {
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
      `Week ${week} evidence failed: ${detail}`
    );
  }

  if (
    !data ||
    data.evidenceType !==
      "weekly-sage-defense-week"
  ) {
    throw new Error(
      `Week ${week} returned an unexpected evidence schema.`
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
      const baseUrl =
        getBaseUrl(event);

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
        Fetch a few weekly snapshots at a time.

        Each weekly endpoint is independently CDN-cacheable, so once a
        historical week has been built, this season aggregator should
        generally hit cached responses rather than Tank01 directly.
      */
      const weeklyResults =
        await mapWithConcurrency(
          weeksIncluded,
          3,
          async function (week) {
            try {
              const data =
                await fetchWeeklyEvidence({
                  baseUrl,
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
