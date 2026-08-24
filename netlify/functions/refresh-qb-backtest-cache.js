// netlify/functions/refresh-qb-backtest-cache.js
//
// WEEKLY SAGE — QB BACKTEST CACHE WRITER
//
// PURPOSE
// -------
// Build one already-proven historical QB backtest block and cache the
// COMPLETE result in Netlify Blobs.
//
// This prevents research endpoints such as
// weekly-sage-qb-weight-sensitivity.js from rebuilding hundreds of
// player-week observations every time they run.
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

const DEFAULT_SEASON_TYPE =
  "reg";

const BACKTEST_FUNCTION =
  "weekly-sage-qb-backtest";

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

  return (
    `${proto}://${host}`
  );
}

function buildUrl({
  baseUrl,
  functionName,
  params
}) {
  const query =
    new URLSearchParams(
      params
    ).toString();

  return (
    `${baseUrl}/.netlify/functions/${functionName}` +
    `?${query}`
  );
}

async function fetchJsonWithStatus(
  url
) {
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
      await response
        .json();
  } catch (
    error
  ) {
    data =
      null;
  }

  return {
    ok:
      response.ok,

    status:
      response.status,

    data
  };
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
      const baseUrl =
        getBaseUrl(
          event
        );

      const url =
        buildUrl({
          baseUrl,

          functionName:
            BACKTEST_FUNCTION,

          params: {
            season,

            startWeek:
              String(
                startWeek
              ),

            endWeek:
              String(
                endWeek
              ),

            seasonType,

            concurrency:
              "1"
          }
        });

      const result =
        await fetchJsonWithStatus(
          url
        );

      if (
        !result.ok
      ) {
        const detail =
          result.data &&
          (
            result.data.detail ||
            result.data.error
          )
            ? (
                result.data.detail ||
                result.data.error
              )
            : `HTTP ${result.status}`;

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
              "Could not build Weekly SAGE QB backtest block.",

            detail
          }
        );
      }

      const backtest =
        result.data;

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
