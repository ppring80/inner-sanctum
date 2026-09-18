// netlify/functions/refresh-def-snapshot.js
//
// WEEKLY SAGE — DEF SNAPSHOT CACHE WRITER
//
// PURPOSE
// -------
// Build the DEF/ST population snapshot for a given
// season/week/seasonType by calling weekly-sage-def-snapshot.js's
// buildDefSnapshot() IN PROCESS (not over HTTP), and, only if the
// result is COMPLETE, write it to Netlify Blobs so
// weekly-sage-def-leaderboard.js can consume the cached snapshot
// instead of rebuilding it on every leaderboard request.
//
// This file does NOT change, duplicate, or reimplement any part of
// the DEF population build, and makes NO Tank01 call of any kind --
// buildDefSnapshot() itself only reads already-cached
// weekly-sage-defense Blobs.
//
// NOT YET SCHEDULED
// -------------------
// This function is deliberately NOT registered in netlify.toml yet.
// Scheduling is a separate step, added only once the DEF pipeline has
// been validated -- the same sequencing already used for
// refresh-k-snapshot.js.
//
// AUTOMATIC WEEK RESOLUTION
// -------------------------
// Manual/historical requests may continue to provide:
//
//   ?season=2025&week=8&seasonType=reg
//
// When no explicit week is supplied, this function resolves the
// current NFL week using the same Tuesday-aligned production
// pipeline convention already established in
// refresh-weekly-sage-schedule.js / the positional snapshot
// refreshers / refresh-k-snapshot.js.
//
// COMPLETENESS GATE
// ------------------
// A snapshot is written only when:
//   - evidenceType === "weekly-sage-def-snapshot"
//   - season/week/seasonType match the request
//   - every prior week in the evidence window is cached
//   - the regular-season population contains exactly 32 unique,
//     valid DEF team records
//
// BLOBS
// -----
// Store: def-snapshot
// Key:   week:${season}:${week}:${seasonType}
//
// ═══════════════════════════════════════════════════════════════════════

const {
  connectLambda,
  getStore
} = require(
  "@netlify/blobs"
);

const {
  isNetlifyScheduledInvocation,
  requireTank01RefreshAuthorization
} = require("./_tank01-refresh-guard.js");

const {
  buildDefSnapshot
} = require(
  "./weekly-sage-def-snapshot.js"
);

const DEFAULT_SEASON_TYPE =
  "reg";

const STORE_NAME =
  "def-snapshot";

const EXPECTED_NFL_TEAM_COUNT =
  32;

/*
  Current NFL week calculator.

  Aligned to the Tuesday Weekly SAGE production pipeline -- the same
  convention deployed in refresh-weekly-sage-schedule.js, the
  positional snapshot refreshers, and refresh-k-snapshot.js.

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
      "DEF snapshot build did not return an object."
    );

    return problems;
  }

  if (
    snapshot.evidenceType !==
    "weekly-sage-def-snapshot"
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
    )
  ) {
    problems.push(
      "population is not an array."
    );
  } else {
    if (
      snapshot.population.length ===
      0
    ) {
      problems.push(
        "population is empty."
      );
    }

    const invalidRecords =
      snapshot.population.filter(
        (record) =>
          !record ||
          typeof record.team !==
            "string" ||
          !record.team.trim() ||
          record.position !==
            "DEF"
      );

    if (
      invalidRecords.length >
      0
    ) {
      problems.push(
        `${invalidRecords.length} population record(s) lack a valid team identity or DEF position.`
      );
    }

    const uniqueTeams =
      new Set(
        snapshot.population
          .filter(
            (record) =>
              record &&
              typeof record.team ===
                "string"
          )
          .map(
            (record) =>
              record.team
                .trim()
                .toUpperCase()
          )
          .filter(Boolean)
      );

    if (
      uniqueTeams.size !==
      snapshot.population.length
    ) {
      problems.push(
        "population contains duplicate team identities."
      );
    }

    if (
      seasonType ===
        "reg" &&
      snapshot.population.length !==
        EXPECTED_NFL_TEAM_COUNT
    ) {
      problems.push(
        `Regular-season DEF population must contain exactly ${EXPECTED_NFL_TEAM_COUNT} teams; got ${snapshot.population.length}.`
      );
    }
  }

  const summary =
    snapshot.populationSummary;

  if (
    !summary ||
    !Number.isInteger(
      summary.weeksScanned
    ) ||
    summary.weeksScanned <
      1
  ) {
    problems.push(
      "weeksScanned is missing or invalid."
    );
  }

  if (
    !summary ||
    !Number.isInteger(
      summary.weeksWithEvidence
    ) ||
    summary.weeksWithEvidence !==
      summary.weeksScanned
  ) {
    problems.push(
      "Not every scanned week has cached defense evidence."
    );
  }

  if (
    !summary ||
    summary.teamsDiscovered !==
      (Array.isArray(snapshot.population)
        ? snapshot.population.length
        : 0)
  ) {
    problems.push(
      "teamsDiscovered does not match the population size."
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
      !isNetlifyScheduledInvocation(event) &&
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

    const authorizationError =
      requireTank01RefreshAuthorization(
        event
      );

    if (
      authorizationError
    ) {
      return authorizationError;
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

    if (
      !Number.isInteger(
        targetWeek
      ) ||
      targetWeek < 2 ||
      targetWeek > 18
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
      const snapshot =
        await buildDefSnapshot({
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
          `refresh-def-snapshot: build for ${key} was incomplete, NOT caching. Problems: ${problems.join(" | ")}`
        );

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
              "DEF snapshot build was incomplete; existing cache (if any) was left untouched.",

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
        `refresh-def-snapshot: cached ${key} -- ${snapshot.population.length} team(s), ${snapshot.populationSummary.weeksWithEvidence} of ${snapshot.populationSummary.weeksScanned} evidence week(s) available.`
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

          teamsDiscovered:
            snapshot.population.length,

          weeksWithEvidence:
            snapshot.populationSummary
              .weeksWithEvidence,

          weeksScanned:
            snapshot.populationSummary
              .weeksScanned,

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
        `refresh-def-snapshot failed for ${key}:`,
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
            "Could not build Weekly SAGE DEF snapshot.",

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

exports.validateCompleteSnapshot =
  validateCompleteSnapshot;

exports.EXPECTED_NFL_TEAM_COUNT =
  EXPECTED_NFL_TEAM_COUNT;
