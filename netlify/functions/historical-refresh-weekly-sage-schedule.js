// netlify/functions/historical-refresh-weekly-sage-schedule.js
//
// WEEKLY SAGE — HISTORICAL SCHEDULE REFRESHER (unscheduled)
//
// PURPOSE
// -------
// A thin, ADDITIVE companion to refresh-weekly-sage-schedule.js,
// added for the same reason historical-refresh-rb-snapshot.js was:
// Netlify does not allow a function carrying a `schedule` to be
// invoked directly by URL, so refresh-weekly-sage-schedule's public
// endpoint cannot be used to manually build a specific season/week
// on demand.
//
// This file exists ONLY to build and cache one Weekly SAGE schedule
// evidence Blob via a plain HTTP GET -- without touching, or putting
// at any risk, the existing scheduled production writer or its
// automation.
//
// THIS FILE DOES NOT:
// - carry a `schedule` entry (deliberately -- not present in
//   netlify.toml)
// - modify refresh-weekly-sage-schedule.js or weekly-sage-schedule.js
//   in any way
// - modify weekly-sage-week1-rankings.js in any way
// - change SAGE scoring, weights, confidence, or matchup methodology
// - duplicate or reimplement the schedule build -- it calls the
//   exact same buildWeeklySchedule() export, unmodified
// - use a different completeness gate, Blobs store, or key
//   convention than refresh-weekly-sage-schedule.js already uses
//
// Every constant, the completeness gate, the Blobs store name, and
// the key template below are copied byte-for-byte from the current
// refresh-weekly-sage-schedule.js, specifically so this file's write
// behavior is identical and produces the exact same weekly-sage-
// schedule Blob shape under the exact same key convention
// (week:${season}:${week}:${seasonType}). If refresh-weekly-sage-
// schedule.js's completeness gate is ever revised, this file should
// be revisited to stay in sync -- it is a deliberate, reviewed
// duplication of validation logic, not a shared import, so that this
// file never has any import-time dependency on the scheduled
// function itself.
//
// ═══════════════════════════════════════════════════════════════════════

const {
  connectLambda,
  getStore
} = require(
  "@netlify/blobs"
);

const {
  buildWeeklySchedule
} = require(
  "./weekly-sage-schedule.js"
);

const DEFAULT_SEASON_TYPE =
  "reg";

const STORE_NAME =
  "weekly-sage-schedule";

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

/*
  Validate structural completeness only.

  Copied byte-for-byte from refresh-weekly-sage-schedule.js's own
  validateCompleteSchedule() -- see that file's header comment for
  the full rationale. This does not recalculate or second-guess
  schedule evidence, team normalization, or bye classification.
*/
function validateCompleteSchedule(
  schedule,
  {
    season,
    week,
    seasonType
  }
) {
  const problems =
    [];

  if (
    !schedule ||
    typeof schedule !==
      "object"
  ) {
    problems.push(
      "Schedule build did not return an object."
    );

    return problems;
  }

  if (
    schedule.evidenceType !==
    "weekly-sage-schedule"
  ) {
    problems.push(
      `Unexpected evidenceType: ${schedule.evidenceType}`
    );
  }

  if (
    String(
      schedule.season
    ) !==
    String(
      season
    )
  ) {
    problems.push(
      `Season mismatch: requested ${season}, got ${schedule.season}`
    );
  }

  if (
    Number(
      schedule.week
    ) !==
    Number(
      week
    )
  ) {
    problems.push(
      `Week mismatch: requested ${week}, got ${schedule.week}`
    );
  }

  if (
    schedule.seasonType !==
    seasonType
  ) {
    problems.push(
      `seasonType mismatch: requested ${seasonType}, got ${schedule.seasonType}`
    );
  }

  if (
    !Array.isArray(
      schedule.games
    )
  ) {
    problems.push(
      "games is not an array."
    );
  }

  if (
    !Array.isArray(
      schedule.activeTeams
    )
  ) {
    problems.push(
      "activeTeams is not an array."
    );
  }

  if (
    !Array.isArray(
      schedule.byeTeams
    )
  ) {
    problems.push(
      "byeTeams is not an array."
    );
  }

  if (
    Array.isArray(
      schedule.games
    ) &&
    Number(
      schedule.gamesReturned
    ) !==
      schedule.games.length
  ) {
    problems.push(
      `gamesReturned mismatch: reported ${schedule.gamesReturned}, actual ${schedule.games.length}`
    );
  }

  return problems;
}

exports.handler =
  async function (
    event
  ) {
    /*
      Required for Netlify Blobs in this runtime mode.

      Must execute before any getStore() call.
    */
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

    if (
      !process.env
        .TANK01_API_KEY
    ) {
      return jsonResponse(
        500,
        {
          error:
            "TANK01_API_KEY is not configured."
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

    /*
      Unlike refresh-weekly-sage-schedule.js, this file has no
      automatic current-week resolution -- it exists specifically for
      explicit historical/manual requests, so an explicit week is
      required rather than silently defaulting.
    */
    if (
      !query.week
    ) {
      return jsonResponse(
        400,
        {
          error:
            "week is required (e.g. ?season=2026&week=1&seasonType=reg). This function is for explicit historical/manual refreshes only."
        }
      );
    }

    const week =
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

    /*
      Shared schedule evidence intentionally supports Week 1 -- same
      as refresh-weekly-sage-schedule.js.
    */
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
      /*
        Build schedule evidence in-process.

        Exact same call, exact same function, as
        refresh-weekly-sage-schedule.js uses. No HTTP self-fetch.
      */
      const schedule =
        await buildWeeklySchedule({
          season,
          week,
          seasonType
        });

      const problems =
        validateCompleteSchedule(
          schedule,
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
          `historical-refresh-weekly-sage-schedule: build for ${key} was incomplete, NOT caching. Problems: ${problems.join(" | ")}`
        );

        /*
          Do not touch Blobs here.

          Any previously cached known-good schedule for this key
          remains exactly as it was.
        */
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
              "Weekly SAGE schedule build was incomplete; existing cache (if any) was left untouched.",

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
        schedule
      );

      console.log(
        `historical-refresh-weekly-sage-schedule: cached ${key} -- ${schedule.games.length} game(s), ${schedule.activeTeams.length} active team(s), ${schedule.byeTeams.length} bye team(s).`
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
            schedule.generatedAt ||
            null,

          gamesReturned:
            schedule.games.length,

          activeTeamsReturned:
            schedule.activeTeams.length,

          byeTeamsReturned:
            schedule.byeTeams.length,

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
        `historical-refresh-weekly-sage-schedule failed for ${key}:`,
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
            "Could not build and cache Weekly SAGE schedule evidence.",

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
