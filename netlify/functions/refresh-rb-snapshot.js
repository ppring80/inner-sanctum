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
// extraction ONLY (see that file's own header comment on the
// function) -- every line of Role/Production/Confidence/eligibility
// logic inside it is byte-for-byte identical to what was previously
// inlined directly in that file's own exports.handler.
//
// IMPORTANT DEVIATION FROM THE QB/WR/TE PATTERN -- READ BEFORE CHANGING:
// -----------------------------------------------------------------
// QB/WR/TE's completeness gate checks `snapshot.nextStep.ready === true`.
// RB's snapshot object does NOT have a `ready` field anywhere -- its
// `nextStep` shape is `{ finalScore: null, recommendation: null, reason:
// "Validate and cache the weekly RB snapshot before reconnecting
// individual player scoring." }`, confirmed by direct inspection (no
// `ready` key exists in weekly-sage-rb-snapshot.js at all, unlike
// weekly-sage-qb-snapshot.js which genuinely has one). Copying the
// QB gate verbatim would mean this function ALWAYS rejects the
// snapshot as incomplete, permanently 422-ing and never caching
// anything -- the opposite of this task's goal. The completeness gate
// below therefore checks every OTHER QB-equivalent condition
// (evidenceType/season/targetWeek/seasonType match, non-empty
// population, zero failures) and OMITS the nextStep.ready check for
// RB specifically. This is a validation-gate adaptation to RB's real,
// existing output shape -- it does not change what
// weekly-sage-rb-snapshot.js computes, scores, or recommends in any way.
//
// COMPLETENESS GATE (RB)
// -----------------------
// A cached snapshot is only written when ALL of the following hold:
//
//   - evidenceType === "weekly-sage-rb-snapshot"
//   - targetWeek matches the requested week
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
// elsewhere in Inner Sanctum (refresh-qb-snapshot.js / refresh-wr-
// snapshot.js / refresh-te-snapshot.js):
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

  See this file's own header comment for why this intentionally does
  NOT check nextStep.ready, unlike the QB/WR/TE equivalents.
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

  // Deliberately NO nextStep.ready check here -- see this file's
  // header comment. RB's snapshot object does not populate that
  // field; requiring it would make this function permanently reject
  // every valid RB snapshot.

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
