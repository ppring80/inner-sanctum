// netlify/functions/refresh-qb-snapshot.js
//
// WEEKLY SAGE — QB SNAPSHOT CACHE WRITER
//
// PURPOSE
// -------
// Build the QB population snapshot for a given season/week/seasonType
// by calling weekly-sage-qb-snapshot.js's buildQbSnapshot() IN PROCESS
// (not over HTTP), and, only if the result is COMPLETE, write it to
// Netlify Blobs so weekly-sage-qb-leaderboard.js can consume the cached
// snapshot instead of paying the full population-build cost on every
// leaderboard request.
//
// This file does NOT change, duplicate, or reimplement any part of
// the Weekly SAGE QB population build. It calls the existing QB
// computation and validates its completed result.
//
// COMPLETENESS GATE
// -----------------
// A cached snapshot is only written when ALL of the following hold:
//
//   - evidenceType === "weekly-sage-qb-snapshot"
//   - targetWeek matches the requested week
//   - season matches the requested season
//   - seasonType matches the requested seasonType
//   - population is a non-empty array
//   - failures is an empty array
//   - nextStep.ready === true
//
// If any of these fail, NOTHING is written. Any snapshot already
// cached for that season/week/seasonType is left untouched.
//
// BLOBS PATTERN
// -------------
// Uses the same Netlify Blobs Lambda-compatibility pattern already
// proven elsewhere in Inner Sanctum:
//
// connectLambda(event) MUST run before getStore().
//
// Store name:  qb-snapshot
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
  buildQbSnapshot
} = require(
  "./weekly-sage-qb-snapshot.js"
);

const DEFAULT_SEASON_TYPE =
  "reg";

const STORE_NAME =
  "qb-snapshot";

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
  Validate that a freshly-built QB snapshot is complete enough to
  trust as a cached population.

  This does not alter or second-guess QB eligibility, Role evidence,
  Production evidence, or any scoring methodology. It only verifies
  that the snapshot returned by buildQbSnapshot() is complete and
  corresponds to the exact requested season/week/seasonType.
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
    "weekly-sage-qb-snapshot"
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

  if (
    !snapshot.nextStep ||
    snapshot.nextStep.ready !==
      true
  ) {
    problems.push(
      "nextStep.ready is not true."
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

    const targetWeek =
      Number(
        query.week
      );

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

    const key =
      `week:${season}:${targetWeek}:${seasonType}`;

    try {
      const baseUrl =
        getBaseUrl(
          event
        );

      /*
        Build the QB snapshot in-process.

        No HTTP self-fetch.
      */
      const snapshot =
        await buildQbSnapshot({
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
          `refresh-qb-snapshot: build for ${key} was incomplete, NOT caching. Problems: ${problems.join(" | ")}`
        );

        /*
          Do not touch Blobs here.

          Any previously cached known-good QB snapshot for this key
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
              "QB snapshot build was incomplete; existing cache (if any) was left untouched.",

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
        `refresh-qb-snapshot: cached ${key} -- ${snapshot.population.length} eligible QB(s), 0 failures.`
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

          eligibleQBPopulation:
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
        `refresh-qb-snapshot failed for ${key}:`,
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
            "Could not build Weekly SAGE QB snapshot.",

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
