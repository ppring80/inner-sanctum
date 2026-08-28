// netlify/functions/refresh-weekly-sage-defense.js
//
// WEEKLY SAGE — SHARED WEEKLY DEFENSE CACHE WRITER
//
// PURPOSE
// -------
// Build one completed week's Weekly SAGE defensive evidence
// and persist the validated result in Netlify Blobs.
//
// This first production version deliberately consumes the existing
// weekly-sage-defense-week endpoint rather than duplicating or changing
// any defensive methodology.
//
// One scheduled build therefore pays the existing evidence cost once:
//
//   1 getNFLGamesForWeek
//   + 1 getNFLBoxScore per completed game
//
// Downstream SAGE consumers can then reuse the persisted evidence.
//
// MANUAL / HISTORICAL
// -------------------
// Example:
//
//   ?season=2025&week=7&seasonType=reg
//
// IMPORTANT — WEEK RESOLUTION
// ---------------------------
// Defensive evidence used for a target SAGE week must come from
// COMPLETED PRIOR weeks.
//
// Therefore, when invoked automatically on Tuesday after Week W
// completes, this writer caches completed Week W defensive evidence.
//
// The automatic resolver uses Tuesday as the production boundary
// because the Weekly SAGE pipeline runs Tuesday morning after
// Monday Night Football.
//
// Example:
//
//   Tuesday after Week 7 completes -> cache completed Week 7 defense
//   evidence for the upcoming Week 8 SAGE build.
//
// Explicit ?week= always wins for historical/manual testing.
//
// BLOBS
// -----
// Store:
//   weekly-sage-defense
//
// Key:
//   week:${season}:${week}:${seasonType}
//
// Strong consistency is intentionally NOT requested.
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

const STORE_NAME =
  "weekly-sage-defense";

/*
  Resolve the Weekly SAGE target week for the Tuesday production
  pipeline.

  The first Tuesday pipeline after 2026 Week 1 is September 15, 2026.
  That Tuesday prepares recommendations for Week 2.

  Each following Tuesday advances the target week by one.

  Before that first post-Week-1 Tuesday, return Week 1.

  UPDATE firstWeek2PipelineTuesday for future NFL seasons.
*/
function getCurrentNFLWeek() {
  const firstWeek2PipelineTuesday =
    new Date(
      "2026-09-15T00:00:00Z"
    );

  const now =
    new Date();

  if (
    now <
    firstWeek2PipelineTuesday
  ) {
    return 1;
  }

  const diffDays =
    Math.floor(
      (
        now -
        firstWeek2PipelineTuesday
      ) /
      (
        1000 *
        60 *
        60 *
        24
      )
    );

  return Math.max(
    2,
    Math.min(
      18,
      Math.floor(
        diffDays /
        7
      ) + 2
    )
  );
}

function jsonResponse(
  statusCode,
  body
) {
  return {
    statusCode,

    headers: {
      "Content-Type":
        "application/json",

      "Cache-Control":
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

  return `${proto}://${host}`;
}

async function fetchWeeklyDefense({
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
      await response.json();
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
      `Weekly defense build failed: ${detail}`
    );
  }

  return data;
}

function validateCompleteDefense(
  evidence,
  {
    season,
    week,
    seasonType
  }
) {
  const problems =
    [];

  if (
    !evidence ||
    typeof evidence !==
      "object"
  ) {
    problems.push(
      "Defense build did not return an object."
    );

    return problems;
  }

  if (
    evidence.evidenceType !==
    "weekly-sage-defense-week"
  ) {
    problems.push(
      `Unexpected evidenceType: ${evidence.evidenceType}`
    );
  }

  if (
    String(
      evidence.season
    ) !==
    String(
      season
    )
  ) {
    problems.push(
      `Season mismatch: requested ${season}, got ${evidence.season}`
    );
  }

  if (
    Number(
      evidence.week
    ) !==
    Number(
      week
    )
  ) {
    problems.push(
      `Week mismatch: requested ${week}, got ${evidence.week}`
    );
  }

  if (
    evidence.seasonType !==
    seasonType
  ) {
    problems.push(
      `seasonType mismatch: requested ${seasonType}, got ${evidence.seasonType}`
    );
  }

  if (
    !evidence.schedule ||
    typeof evidence.schedule !==
      "object"
  ) {
    problems.push(
      "schedule is missing."
    );
  }

  if (
    !evidence.defenses ||
    typeof evidence.defenses !==
      "object" ||
    Array.isArray(
      evidence.defenses
    )
  ) {
    problems.push(
      "defenses is missing or invalid."
    );
  }

  if (
    !Array.isArray(
      evidence.gameResults
    )
  ) {
    problems.push(
      "gameResults is not an array."
    );
  }

  if (
    evidence.schedule &&
    Number(
      evidence.schedule.completedGames
    ) !==
    Number(
      evidence.schedule.processedGames
    )
  ) {
    problems.push(
      `Not all completed games were processed: ${evidence.schedule.processedGames} of ${evidence.schedule.completedGames}.`
    );
  }

  if (
    Array.isArray(
      evidence.gameResults
    )
  ) {
    const failedGames =
      evidence.gameResults.filter(
        function (
          game
        ) {
          return (
            !game ||
            game.status !==
              "processed"
          );
        }
      );

    if (
      failedGames.length >
      0
    ) {
      problems.push(
        `${failedGames.length} game result(s) were not processed successfully.`
      );
    }
  }

  return problems;
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

    const currentWeek =
      getCurrentNFLWeek();

    /*
      Explicit historical/manual week wins.

      Automatic execution caches the most recently completed
      week because that is the newest defensive evidence that
      can safely feed the next SAGE recommendation week.

      getCurrentNFLWeek() is aligned to the Tuesday production
      pipeline, so currentWeek - 1 is the week that completed
      the previous night.
    */
    const week =
      query.week
        ? Number(
            query.week
          )
        : currentWeek - 1;

    const seasonType =
      String(
        query.seasonType ||
        DEFAULT_SEASON_TYPE
      )
        .trim()
        .toLowerCase();

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
            "week must be an integer from 1 through 18.",

          resolvedDefenseWeek:
            week,

          currentNFLWeek:
            currentWeek,

          automaticWeekResolution:
            !query.week
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

    const key =
      `week:${season}:${week}:${seasonType}`;

    try {
      const baseUrl =
        getBaseUrl(
          event
        );

      /*
        Build exactly once through the existing production
        weekly defensive-evidence endpoint.
      */
      const evidence =
        await fetchWeeklyDefense({
          baseUrl,
          season,
          week,
          seasonType
        });

      const problems =
        validateCompleteDefense(
          evidence,
          {
            season,
            week,
            seasonType
          }
        );

      if (
        problems.length >
        0
      ) {
        console.error(
          `refresh-weekly-sage-defense: build for ${key} was incomplete, NOT caching. Problems: ${problems.join(" | ")}`
        );

        return jsonResponse(
          422,
          {
            cached:
              false,

            season,

            week,

            seasonType,

            blobStore:
              STORE_NAME,

            blobKey:
              key,

            error:
              "Weekly SAGE defensive evidence was incomplete; existing cache (if any) was left untouched.",

            problems
          }
        );
      }

      const store =
        getStore({
          name:
            STORE_NAME
        });

      await store.setJSON(
        key,
        evidence
      );

      console.log(
        `refresh-weekly-sage-defense: cached ${key} -- ${evidence.schedule.processedGames} completed game(s) processed.`
      );

      return jsonResponse(
        200,
        {
          cached:
            true,

          season,

          week,

          seasonType,

          generatedAt:
            evidence.generatedAt ||
            null,

          gamesReturned:
            evidence.schedule
              .gamesReturned,

          completedGames:
            evidence.schedule
              .completedGames,

          processedGames:
            evidence.schedule
              .processedGames,

          defensesReturned:
            Object.keys(
              evidence.defenses
            ).length,

          blobStore:
            STORE_NAME,

          blobKey:
            key
        }
      );
    } catch (
      error
    ) {
      console.error(
        `refresh-weekly-sage-defense failed for ${key}:`,
        error
      );

      return jsonResponse(
        502,
        {
          cached:
            false,

          season,

          week,

          seasonType,

          blobStore:
            STORE_NAME,

          blobKey:
            key,

          error:
            "Could not build and cache Weekly SAGE defensive evidence.",

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
