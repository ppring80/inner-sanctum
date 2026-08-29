// netlify/functions/refresh-rb-snapshot.js
//
// WEEKLY SAGE — RB SNAPSHOT CACHE WRITER
//
// PURPOSE
// -------
// Build the RB population snapshot for a given season/week/seasonType
// by calling weekly-sage-rb-snapshot.js's buildRbSnapshot() IN PROCESS
// (not over HTTP), and, only if the result is COMPLETE, write it to
// Netlify Blobs so weekly-sage-rb-leaderboard.js can consume the cached
// snapshot instead of paying the full population-build cost on every
// leaderboard request.
//
// This file does NOT change, duplicate, or reimplement any part of
// the Weekly SAGE RB population build. It calls the existing RB
// computation and validates its completed result. buildRbSnapshot()
// itself was added to weekly-sage-rb-snapshot.js as a structural
// extraction ONLY.
//
// AUTOMATIC WEEK RESOLUTION
// -------------------------
// Manual/historical requests may continue to provide:
//
//   ?season=2025&week=8&seasonType=reg
//
// Scheduled Netlify invocations do not provide query parameters.
// When no explicit week is supplied, this function determines the
// current NFL week using the same 2026 season convention already used
// elsewhere in Inner Sanctum.
//
// This allows the Tuesday Netlify schedule to build the appropriate
// Weekly SAGE target week automatically while preserving explicit
// historical/manual week overrides.
//
// IMPORTANT:
// The automatic week resolver returns Week 1 before the 2026 regular
// season begins. Weekly SAGE snapshots require prior-week evidence,
// so the existing Week 2-18 validation remains intentionally intact.
//
// IMPORTANT DEVIATION FROM THE QB/WR/TE PATTERN
// ----------------------------------------------
// QB/WR/TE's completeness gate checks snapshot.nextStep.ready === true.
//
// RB's snapshot object does NOT have a ready field. Its nextStep shape
// does not populate that value, so copying the QB gate verbatim would
// permanently reject every valid RB snapshot.
//
// The RB completeness gate therefore checks every other equivalent
// condition and intentionally omits nextStep.ready.
//
// COMPLETENESS GATE
// -----------------
// A cached snapshot is only written when ALL of the following hold:
//
//   - evidenceType === "weekly-sage-rb-snapshot"
//   - targetWeek matches the requested/resolved week
//   - season matches the requested season
//   - seasonType matches the requested seasonType
//   - population is a non-empty array
//   - failures is an empty array
//
// If any of these fail, NOTHING is written. Any snapshot already
// cached for that season/week/seasonType is left untouched.
//
// BLOBS PATTERN
// -------------
// Same Netlify Blobs Lambda-compatibility pattern already proven
// elsewhere in Inner Sanctum:
//
// connectLambda(event) MUST run before getStore().
//
// Store name:  rb-snapshot
// Key:         week:${season}:${week}:${seasonType}
//
// ═══════════════════════════════════════════════════════════════════════

const {
  connectLambda,
  getStore
} = require(
  "@netlify/blobs"
);

const {
  buildRbSnapshot
} = require(
  "./weekly-sage-rb-snapshot.js"
);

const DEFAULT_SEASON_TYPE =
  "reg";

const STORE_NAME =
  "rb-snapshot";

/*
  Current NFL week calculator.

  Aligned to the Tuesday Weekly SAGE production pipeline -- the same
  convention now deployed in refresh-weekly-sage-schedule.js and
  refresh-weekly-sage-defense.js. The prior season-start-based anchor
  rolled its weekly boundary over on Wednesdays, one day after this
  pipeline's actual Tuesday schedule, and resolved Week 1 on
  2026-09-15 when Week 2 was needed.

  Before the first Week 2 production Tuesday it returns Week 1.

  From that Tuesday onward it advances one week for every seven
  days and caps the result at Week 18. Unlike
  refresh-weekly-sage-defense.js, this positional writer needs the
  target week directly -- no -1 offset here.

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

/*
  Validate that a freshly-built RB snapshot is complete enough to
  trust as a cached population.

  This does not alter or second-guess RB eligibility, Role evidence,
  Production evidence, or any scoring methodology. It only verifies
  that the snapshot returned by buildRbSnapshot() is complete and
  corresponds to the exact requested season/week/seasonType.

  RB intentionally does NOT check nextStep.ready.
*/
function validateCompleteSnapshot(
  snapshot,
  {
    season,
    targetWeek,
    seasonType
  }
) {
  const problems =
    [];

  if (
    !snapshot ||
    typeof snapshot !==
      "object"
  ) {
    problems.push(
      "Snapshot build did not return an object."
    );

    return problems;
  }

  if (
    snapshot.evidenceType !==
    "weekly-sage-rb-snapshot"
  ) {
    problems.push(
      `Unexpected evidenceType: ${snapshot.evidenceType}`
    );
  }

  if (
    String(
      snapshot.season
    ) !==
    String(
      season
    )
  ) {
    problems.push(
      `Season mismatch: requested ${season}, got ${snapshot.season}`
    );
  }

  if (
    Number(
      snapshot.targetWeek
    ) !==
    Number(
      targetWeek
    )
  ) {
    problems.push(
      `targetWeek mismatch: requested ${targetWeek}, got ${snapshot.targetWeek}`
    );
  }

  if (
    snapshot.seasonType !==
    seasonType
  ) {
    problems.push(
      `seasonType mismatch: requested ${seasonType}, got ${snapshot.seasonType}`
    );
  }

  if (
    !Array.isArray(
      snapshot.population
    ) ||
    snapshot.population.length ===
      0
  ) {
    problems.push(
      "Population is empty or not an array."
    );
  }

  if (
    !Array.isArray(
      snapshot.failures
    ) ||
    snapshot.failures.length >
      0
  ) {
    problems.push(
      `Snapshot has ${
        Array.isArray(
          snapshot.failures
        )
          ? snapshot.failures.length
          : "unknown"
      } player-game failure(s).`
    );
  }

  /*
    Deliberately NO nextStep.ready check.

    RB's existing snapshot schema does not populate that field.
  */

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

      If Netlify invokes this function from its Tuesday schedule,
      query.week will not exist, so resolve the target NFL week
      automatically instead.
    */
    const targetWeek =
      query.week
        ? Number(
            query.week
          )
        : getCurrentNFLWeek();

    const seasonType =
      String(
        query.seasonType ||
        DEFAULT_SEASON_TYPE
      );

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
            "week must be an integer from 2 through 18.",

          resolvedTargetWeek:
            targetWeek,

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
      `week:${season}:${targetWeek}:${seasonType}`;

    try {
      const baseUrl =
        getBaseUrl(
          event
        );

      /*
        Build the RB snapshot in-process.

        No HTTP self-fetch.
      */
      const snapshot =
        await buildRbSnapshot({
          baseUrl,
          season,
          targetWeek,
          seasonType
        });

      const problems =
        validateCompleteSnapshot(
          snapshot,
          {
            season,
            targetWeek,
            seasonType
          }
        );

      if (
        problems.length >
        0
      ) {
        console.error(
          `refresh-rb-snapshot: build for ${key} was incomplete, NOT caching. Problems: ${problems.join(" | ")}`
        );

        /*
          Do not touch Blobs here.

          Any previously cached known-good RB snapshot for this key
          remains exactly as it was.
        */
        return jsonResponse(
          422,
          {
            cached:
              false,

            season,

            targetWeek,

            seasonType,

            blobStore:
              STORE_NAME,

            blobKey:
              key,

            error:
              "RB snapshot build was incomplete; existing cache (if any) was left untouched.",

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
        snapshot
      );

      console.log(
        `refresh-rb-snapshot: cached ${key} -- ${snapshot.population.length} eligible RB(s), 0 failures.`
      );

      return jsonResponse(
        200,
        {
          cached:
            true,

          season,

          targetWeek,

          seasonType,

          generatedAt:
            snapshot.generatedAt ||
            null,

          eligibleRBPopulation:
            snapshot.population.length,

          failures:
            snapshot.failures.length,

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
        `refresh-rb-snapshot failed for ${key}:`,
        error
      );

      return jsonResponse(
        502,
        {
          cached:
            false,

          season,

          targetWeek,

          seasonType,

          blobStore:
            STORE_NAME,

          blobKey:
            key,

          error:
            "Could not build Weekly SAGE RB snapshot.",

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
