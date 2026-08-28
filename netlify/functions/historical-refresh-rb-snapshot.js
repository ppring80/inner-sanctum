// netlify/functions/historical-refresh-rb-snapshot.js
//
// WEEKLY SAGE — HISTORICAL RB SNAPSHOT REFRESHER (unscheduled)
//
// PURPOSE
// -------
// A thin, ADDITIVE companion to refresh-rb-snapshot.js, added solely
// because Netlify does not allow a function carrying a `schedule` to
// be invoked directly by URL (confirmed against Netlify's own current
// docs: "Scheduled functions only run on their schedule for published
// deploys and... you can't invoke them directly with a URL"). Once
// refresh-rb-snapshot was given its production Tuesday schedule
// (5 9 * * 2), its public HTTP endpoint became permanently blocked at
// Netlify's edge for direct/manual/historical requests -- this is why
// historical requests such as ?season=2025&week=8&seasonType=reg,
// which worked before that schedule existed, now return a 403 before
// the function is ever invoked.
//
// This file exists ONLY to restore the ability to run a historical/
// manual RB snapshot refresh via a plain HTTP GET, for validation of
// the refactored RB Weekly SAGE architecture -- without touching, or
// putting at any risk, the existing scheduled production function or
// its Tuesday automation.
//
// THIS FILE DOES NOT:
// - carry a `schedule` entry (deliberately -- see this file's own
//   netlify.toml entry, or lack thereof)
// - modify refresh-rb-snapshot.js or weekly-sage-rb-snapshot.js in
//   any way
// - change SAGE scoring, weights, confidence, matchup methodology,
//   or any no-look-ahead rule
// - duplicate or reimplement the RB population build -- it calls the
//   exact same buildRbSnapshot() export, unmodified
// - use a different completeness gate, Blobs store, or key
//   convention than refresh-rb-snapshot.js already uses
//
// Every constant, the completeness gate, the Blobs store name, and
// the key template below are copied byte-for-byte from the current
// refresh-rb-snapshot.js, specifically so this file's write behavior
// is identical and produces the exact same rb-snapshot Blob shape
// under the exact same key convention (week:${season}:${week}:${seasonType}).
// If refresh-rb-snapshot.js's completeness gate is ever revised, this
// file should be revisited to stay in sync -- it is a deliberate,
// reviewed duplication of validation logic, not a shared import, so
// that this file never has any import-time dependency on the
// scheduled function itself.
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

  Copied byte-for-byte from refresh-rb-snapshot.js's own
  validateCompleteSnapshot() -- see that file's header comment for
  why nextStep.ready is intentionally not checked for RB. This does
  not alter or second-guess RB eligibility, Role evidence, Production
  evidence, or any scoring methodology. It only verifies that the
  snapshot returned by buildRbSnapshot() is complete and corresponds
  to the exact requested season/week/seasonType.
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
      Unlike refresh-rb-snapshot.js, this file has no automatic
      current-week resolution -- it exists specifically for explicit
      historical/manual requests, so an explicit week is required
      rather than silently defaulting.
    */
    if (
      !query.week
    ) {
      return jsonResponse(
        400,
        {
          error:
            "week is required (e.g. ?season=2025&week=8&seasonType=reg). This function is for explicit historical/manual refreshes only."
        }
      );
    }

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
        Build the RB snapshot in-process.

        Exact same call, exact same function, as
        refresh-rb-snapshot.js uses. No HTTP self-fetch.
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
          `historical-refresh-rb-snapshot: build for ${key} was incomplete, NOT caching. Problems: ${problems.join(" | ")}`
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
        `historical-refresh-rb-snapshot: cached ${key} -- ${snapshot.population.length} eligible RB(s), 0 failures.`
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
        `historical-refresh-rb-snapshot failed for ${key}:`,
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
