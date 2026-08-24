// netlify/functions/refresh-qb-backtest-cache.js
//
// WEEKLY SAGE — QB BACKTEST CACHE WRITER
//
// PURPOSE
// -------
// Build one already-proven historical QB backtest block and cache the
// COMPLETE result in Netlify Blobs.
//
// IMPORTANT ARCHITECTURE CHANGE
// -----------------------------
// The backtest is executed IN PROCESS by requiring
// weekly-sage-qb-backtest.js and invoking its handler directly.
//
// We deliberately DO NOT fetch the deployed backtest endpoint over HTTP.
// The direct historical block calls (4-7, 8-14, 15-17) have already been
// proven to work. The previous cache-writer version added another
// Lambda-to-Lambda HTTP hop, which introduced enough overhead to hit
// Netlify's execution limit.
//
// STORE
// -----
//   qb-backtest
//
// KEY
// ---
//   block:${season}:${startWeek}:${endWeek}:${seasonType}
//
// EXAMPLES
// --------
//   block:2025:4:7:reg
//   block:2025:8:14:reg
//   block:2025:15:17:reg
//
// SAFETY
// ------
// An existing known-good cache is NEVER overwritten by an incomplete
// or failed backtest.
//
// ═══════════════════════════════════════════════════════════════════════

const {
  connectLambda,
  getStore
} = require("@netlify/blobs");

const {
  handler: qbBacktestHandler
} = require("./weekly-sage-qb-backtest.js");

const DEFAULT_SEASON_TYPE =
  "reg";

const STORE_NAME =
  "qb-backtest";

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

function parseHandlerBody(
  response
) {
  if (
    !response ||
    typeof response !==
      "object"
  ) {
    return null;
  }

  if (
    typeof response.body ===
      "object" &&
    response.body !==
      null
  ) {
    return response.body;
  }

  if (
    typeof response.body !==
      "string"
  ) {
    return null;
  }

  try {
    return JSON.parse(
      response.body
    );
  } catch (
    error
  ) {
    return null;
  }
}

function validateBacktest({
  backtest,
  season,
  startWeek,
  endWeek,
  seasonType
}) {
  const problems =
    [];

  if (
    !backtest ||
    typeof backtest !==
      "object"
  ) {
    problems.push(
      "Backtest did not return an object."
    );

    return problems;
  }

  if (
    backtest.evidenceType !==
      "weekly-sage-qb-backtest"
  ) {
    problems.push(
      `Unexpected evidenceType: ${backtest.evidenceType}`
    );
  }

  if (
    String(
      backtest.season
    ) !==
    String(
      season
    )
  ) {
    problems.push(
      `Season mismatch: requested ${season}, got ${backtest.season}`
    );
  }

  if (
    backtest.seasonType !==
    seasonType
  ) {
    problems.push(
      `seasonType mismatch: requested ${seasonType}, got ${backtest.seasonType}`
    );
  }

  const requestedWindow =
    backtest.requestedWindow ||
    {};

  if (
    Number(
      requestedWindow.startWeek
    ) !==
    Number(
      startWeek
    )
  ) {
    problems.push(
      `startWeek mismatch: requested ${startWeek}, got ${requestedWindow.startWeek}`
    );
  }

  if (
    Number(
      requestedWindow.endWeek
    ) !==
    Number(
      endWeek
    )
  ) {
    problems.push(
      `endWeek mismatch: requested ${endWeek}, got ${requestedWindow.endWeek}`
    );
  }

  if (
    !Array.isArray(
      backtest.observations
    ) ||
    backtest.observations.length ===
      0
  ) {
    problems.push(
      "Backtest observations are empty or not an array."
    );
  }

  const population =
    backtest.population ||
    {};

  if (
    Number(
      population.retrievalFailures ||
      0
    ) !==
    0
  ) {
    problems.push(
      `Backtest has ${population.retrievalFailures} retrieval failure(s).`
    );
  }

  if (
    Number(
      population.weeklyFailures ||
      0
    ) !==
    0
  ) {
    problems.push(
      `Backtest has ${population.weeklyFailures} weekly failure(s).`
    );
  }

  if (
    !backtest.nextStep ||
    backtest.nextStep.ready !==
      true
  ) {
    problems.push(
      "nextStep.ready is not true."
    );
  }

  return problems;
}

async function buildBacktestInProcess({
  event,
  season,
  startWeek,
  endWeek,
  seasonType
}) {
  /*
    Preserve the incoming host / forwarded-proto headers because the
    underlying backtest still needs its base URL when it calls the
    weekly validation functions.

    Only the query parameters are replaced.
  */
  const syntheticEvent = {
    ...event,

    httpMethod:
      "GET",

    queryStringParameters: {
      season:
        String(
          season
        ),

      startWeek:
        String(
          startWeek
        ),

      endWeek:
        String(
          endWeek
        ),

      seasonType,

      /*
        Historical validation itself can be expensive.

        Keep the inner backtest at concurrency 1 because that is the
        exact execution shape already proven successfully for these
        historical blocks.
      */
      concurrency:
        "1"
    }
  };

  return qbBacktestHandler(
    syntheticEvent
  );
}

exports.handler =
  async function (
    event
  ) {
    /*
      Required for Netlify Blobs in classic Lambda-compatible runtime.

      Must occur before getStore().
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

    const query =
      event.queryStringParameters ||
      {};

    const season =
      String(
        query.season ||
        new Date()
          .getFullYear()
      );

    const startWeek =
      Number(
        query.startWeek
      );

    const endWeek =
      Number(
        query.endWeek
      );

    const seasonType =
      String(
        query.seasonType ||
        DEFAULT_SEASON_TYPE
      );

    if (
      !Number.isInteger(
        startWeek
      ) ||
      !Number.isInteger(
        endWeek
      ) ||
      startWeek <
        2 ||
      endWeek >
        17 ||
      startWeek >
        endWeek
    ) {
      return jsonResponse(
        400,
        {
          error:
            "startWeek and endWeek must be integers from 2 through 17, with startWeek <= endWeek."
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
      `block:${season}:${startWeek}:${endWeek}:${seasonType}`;

    try {
      /*
        STEP 1
        ------
        Execute weekly-sage-qb-backtest IN PROCESS.

        This removes the unnecessary:
          cache-writer Lambda
              ->
          HTTP
              ->
          backtest Lambda

        boundary that caused the prior 502.
      */
      const result =
        await buildBacktestInProcess({
          event,
          season,
          startWeek,
          endWeek,
          seasonType
        });

      const statusCode =
        Number(
          result &&
          result.statusCode
        );

      const backtest =
        parseHandlerBody(
          result
        );

      if (
        !Number.isFinite(
          statusCode
        ) ||
        statusCode <
          200 ||
        statusCode >=
          300
      ) {
        const detail =
          backtest &&
          (
            backtest.detail ||
            backtest.error
          )
            ? (
                backtest.detail ||
                backtest.error
              )
            : `Backtest handler returned status ${statusCode || "unknown"}.`;

        console.error(
          `refresh-qb-backtest-cache: in-process backtest failed for ${key}:`,
          detail
        );

        return jsonResponse(
          502,
          {
            cached:
              false,

            season,

            startWeek,

            endWeek,

            seasonType,

            blobStore:
              STORE_NAME,

            blobKey:
              key,

            error:
              "Could not build Weekly SAGE QB backtest block in process.",

            detail
          }
        );
      }

      /*
        STEP 2
        ------
        Never cache an incomplete historical block.
      */
      const problems =
        validateBacktest({
          backtest,
          season,
          startWeek,
          endWeek,
          seasonType
        });

      if (
        problems.length >
        0
      ) {
        console.error(
          `refresh-qb-backtest-cache: ${key} incomplete; NOT caching. ${problems.join(" | ")}`
        );

        return jsonResponse(
          422,
          {
            cached:
              false,

            season,

            startWeek,

            endWeek,

            seasonType,

            blobStore:
              STORE_NAME,

            blobKey:
              key,

            error:
              "QB backtest block was incomplete; existing cache (if any) was left untouched.",

            problems
          }
        );
      }

      /*
        STEP 3
        ------
        Cache the complete backtest exactly as produced.

        No observations, scores, correlations, or historical outcomes
        are changed here.
      */
      const store =
        getStore({
          name:
            STORE_NAME
        });

      await store.setJSON(
        key,
        backtest
      );

      console.log(
        `refresh-qb-backtest-cache: cached ${key} -- ${backtest.observations.length} observations.`
      );

      return jsonResponse(
        200,
        {
          cached:
            true,

          season,

          startWeek,

          endWeek,

          seasonType,

          generatedAt:
            backtest.generatedAt ||
            null,

          observations:
            backtest.observations.length,

          weeksRetrieved:
            backtest.population &&
            backtest.population
              .weeksRetrieved !==
              undefined
              ? backtest.population
                  .weeksRetrieved
              : null,

          weeklyFailures:
            backtest.population &&
            backtest.population
              .weeklyFailures !==
              undefined
              ? backtest.population
                  .weeklyFailures
              : null,

          retrievalFailures:
            backtest.population &&
            backtest.population
              .retrievalFailures !==
              undefined
              ? backtest.population
                  .retrievalFailures
              : null,

          blobStore:
            STORE_NAME,

          blobKey:
            key,

          execution:
            "in-process weekly-sage-qb-backtest"
        }
      );
    } catch (
      error
    ) {
      console.error(
        `refresh-qb-backtest-cache failed for ${key}:`,
        error
      );

      return jsonResponse(
        502,
        {
          cached:
            false,

          season,

          startWeek,

          endWeek,

          seasonType,

          blobStore:
            STORE_NAME,

          blobKey:
            key,

          error:
            "Could not cache Weekly SAGE QB backtest block.",

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
