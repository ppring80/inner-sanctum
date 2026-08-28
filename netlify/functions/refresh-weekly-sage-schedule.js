// netlify/functions/refresh-weekly-sage-schedule.js
//
// WEEKLY SAGE — SHARED SCHEDULE CACHE WRITER
//
// PURPOSE
// -------
// Build normalized Weekly SAGE schedule evidence once for a
// season/week/seasonType and persist the completed result in
// Netlify Blobs.
//
// The production schedule calculation is NOT duplicated here.
//
// This function calls:
//
//   weekly-sage-schedule.js
//     -> buildWeeklySchedule()
//
// IN PROCESS.
//
// MANUAL / HISTORICAL
// -------------------
// Explicit requests remain supported:
//
//   ?season=2025&week=8&seasonType=reg
//
// AUTOMATIC WEEK RESOLUTION
// -------------------------
// Scheduled Netlify invocations do not provide query parameters.
//
// When no explicit week is supplied, this function resolves the
// current NFL week using the same 2026 season convention already
// established by the positional snapshot refreshers.
//
// IMPORTANT
// ---------
// Unlike positional Weekly SAGE snapshots, shared schedule
// evidence supports Week 1.
//
// A Week 2 SAGE build needs Week 1 schedule evidence, so rejecting
// Week 1 here would make the shared evidence architecture incomplete.
//
// COMPLETENESS GATE
// -----------------
// A schedule is written only when:
//
//   - evidenceType === "weekly-sage-schedule"
//   - season matches
//   - week matches
//   - seasonType matches
//   - games is an array
//   - activeTeams is an array
//   - byeTeams is an array
//   - gamesReturned matches games.length
//
// If validation fails, NOTHING is written.
//
// BLOBS
// -----
// Store:
//   weekly-sage-schedule
//
// Key:
//   week:${season}:${week}:${seasonType}
//
// Netlify Lambda compatibility requires:
//
//   connectLambda(event)
//
// before:
//
//   getStore()
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

const {
  buildWeeklySchedule
} = require(
  "./weekly-sage-schedule.js"
);

const DEFAULT_SEASON_TYPE =
  "reg";

const STORE_NAME =
  "weekly-sage-schedule";

/*
  Current NFL week calculator.

  Same 2026 convention used by the positional snapshot
  refreshers.

  Before the regular season begins it returns Week 1.

  During the regular season it advances one week for every
  seven days from the 2026 season-start anchor and caps the
  result at Week 18.

  UPDATE seasonStart for future NFL seasons.
*/
function getCurrentNFLWeek() {
  const seasonStart =
    new Date(
      "2026-09-09"
    );

  const now =
    new Date();

  if (
    now <
    seasonStart
  ) {
    return 1;
  }

  const diffDays =
    Math.floor(
      (
        now -
        seasonStart
      ) /
      (
        1000 *
        60 *
        60 *
        24
      )
    );

  return Math.max(
    1,
    Math.min(
      18,
      Math.floor(
        diffDays /
        7
      ) + 1
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

/*
  Validate only structural completeness.

  This function does NOT recalculate or second-guess schedule
  evidence, team normalization, or bye classification.
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
      Explicit week wins.

      Scheduled Netlify invocations do not provide query.week,
      so automatically resolve the current NFL week.
    */
    const week =
      query.week
        ? Number(
            query.week
          )
        : getCurrentNFLWeek();

    const seasonType =
      String(
        query.seasonType ||
        DEFAULT_SEASON_TYPE
      )
        .trim()
        .toLowerCase();

    /*
      Shared schedule evidence intentionally supports Week 1.
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
            "week must be an integer from 1 through 18.",

          resolvedWeek:
            week,

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
      /*
        Build schedule evidence IN PROCESS.

        This is the same production builder used by
        weekly-sage-schedule's HTTP handler.
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
          `refresh-weekly-sage-schedule: build for ${key} was incomplete, NOT caching. Problems: ${problems.join(" | ")}`
        );

        /*
          Do not touch Blobs.

          Any previously cached known-good schedule for this
          key remains unchanged.
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
        `refresh-weekly-sage-schedule: cached ${key} -- ${schedule.games.length} game(s), ${schedule.activeTeams.length} active team(s), ${schedule.byeTeams.length} bye team(s).`
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
        `refresh-weekly-sage-schedule failed for ${key}:`,
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
