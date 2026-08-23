// netlify/functions/refresh-wr-snapshot.js
//
// WEEKLY SAGE — WR SNAPSHOT CACHE WRITER (Phase 1)
//
// PURPOSE
// -------
// Build the WR population snapshot for a given season/week/seasonType
// by calling weekly-sage-wr-snapshot.js's buildWrSnapshot() IN PROCESS
// (not over HTTP), and, only if the result is COMPLETE, write it to
// Netlify Blobs so a future customer-facing read path (Phase 2, not
// implemented here) can consume a cached snapshot instead of paying
// the full population-build cost on every request.
//
// This file does NOT change, duplicate, or reimplement any part of
// the Weekly SAGE WR population build. It calls the existing,
// unmodified computation and inspects its result.
//
// PHASE 1 SCOPE
// -------------
// This function is NOT scheduled and is NOT wired into
// weekly-sage-wr-leaderboard.js. It exists to prove the cache writer
// in isolation before any customer-facing path is changed. Manually
// invoke it (Netlify UI "Run now" or the deployed endpoint URL) with
// season/week/seasonType query params.
//
// COMPLETENESS GATE
// ------------------
// A cached snapshot is only ever written when ALL of the following
// hold on the freshly-built result:
//   - evidenceType === "weekly-sage-wr-snapshot"
//   - targetWeek matches the requested week
//   - season matches the requested season
//   - seasonType matches the requested seasonType
//   - population is a non-empty array
//   - failures is an empty array
//   - nextStep.ready === true
//
// If any of these fail, NOTHING is written. Any snapshot already
// cached for that season/week/seasonType is left completely
// untouched -- this function never overwrites a known-good cached
// snapshot with an incomplete one.
//
// BLOBS PATTERN
// -------------
// Uses the exact same Netlify Blobs Lambda-compatibility pattern
// already proven in refresh-player-data.js and
// refresh-risers-fallers.js: connectLambda(event) is called first,
// before any getStore() call, inside the classic exports.handler
// signature.
//
// Store name:  wr-snapshot
// Key:         week:${season}:${week}:${seasonType}
//              (same three-dimension key shape as
//              refresh-risers-fallers.js's `week:${season}:${currentWeek}`,
//              extended with seasonType since WR snapshots are keyed
//              on all three.)
//
// ═══════════════════════════════════════════════════════════════════════

const { connectLambda, getStore } = require("@netlify/blobs");

const { buildWrSnapshot } = require("./weekly-sage-wr-snapshot.js");

const DEFAULT_SEASON_TYPE = "reg";

const STORE_NAME = "wr-snapshot";

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body, null, 2)
  };
}

function getBaseUrl(event) {
  const headers = event.headers || {};
  const proto =
    headers["x-forwarded-proto"] || headers["X-Forwarded-Proto"] || "https";
  const host = headers.host || headers.Host;

  if (!host) {
    throw new Error("Could not determine host.");
  }

  return `${proto}://${host}`;
}

/*
  Validate that a freshly-built snapshot is complete enough to trust
  as a cached population, without inspecting or altering any of its
  computed values. This never overrides, recalculates, or second-
  guesses the WR population/eligibility rules themselves -- it only
  checks the completeness signals the builder itself already
  produces (population.length, failures.length, nextStep.ready) plus
  a basic identity/shape check that the response is actually the
  snapshot we asked for.
*/
function validateCompleteSnapshot(snapshot, { season, targetWeek, seasonType }) {
  const problems = [];

  if (!snapshot || typeof snapshot !== "object") {
    problems.push("Snapshot build did not return an object.");
    return problems;
  }

  if (snapshot.evidenceType !== "weekly-sage-wr-snapshot") {
    problems.push(
      `Unexpected evidenceType: ${snapshot.evidenceType}`
    );
  }

  if (String(snapshot.season) !== String(season)) {
    problems.push(
      `Season mismatch: requested ${season}, got ${snapshot.season}`
    );
  }

  if (Number(snapshot.targetWeek) !== Number(targetWeek)) {
    problems.push(
      `targetWeek mismatch: requested ${targetWeek}, got ${snapshot.targetWeek}`
    );
  }

  if (snapshot.seasonType !== seasonType) {
    problems.push(
      `seasonType mismatch: requested ${seasonType}, got ${snapshot.seasonType}`
    );
  }

  if (!Array.isArray(snapshot.population) || snapshot.population.length === 0) {
    problems.push("Population is empty or not an array.");
  }

  if (!Array.isArray(snapshot.failures) || snapshot.failures.length > 0) {
    problems.push(
      `Snapshot has ${
        Array.isArray(snapshot.failures) ? snapshot.failures.length : "unknown"
      } player-game failure(s).`
    );
  }

  if (!snapshot.nextStep || snapshot.nextStep.ready !== true) {
    problems.push("nextStep.ready is not true.");
  }

  return problems;
}

exports.handler = async function (event) {
  // Required for Netlify Blobs in this runtime mode (Lambda
  // compatibility -- classic exports.handler signature). Must be
  // called before any getStore() call. Same requirement and same
  // pattern as refresh-player-data.js / refresh-risers-fallers.js.
  connectLambda(event);

  if (event.httpMethod && event.httpMethod !== "GET") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  if (!process.env.TANK01_API_KEY) {
    return jsonResponse(500, { error: "TANK01_API_KEY is not configured." });
  }

  const query = event.queryStringParameters || {};

  const season = String(query.season || new Date().getFullYear());
  const targetWeek = Number(query.week);
  const seasonType = String(query.seasonType || DEFAULT_SEASON_TYPE);

  if (!Number.isInteger(targetWeek) || targetWeek < 2 || targetWeek > 18) {
    return jsonResponse(400, {
      error: "week must be an integer from 2 through 18."
    });
  }

  if (!["reg", "pre", "post", "all"].includes(seasonType)) {
    return jsonResponse(400, {
      error: "seasonType must be reg, pre, post, or all."
    });
  }

  const key = `week:${season}:${targetWeek}:${seasonType}`;

  try {
    const baseUrl = getBaseUrl(event);

    const snapshot = await buildWrSnapshot({
      baseUrl,
      season,
      targetWeek,
      seasonType
    });

    const problems = validateCompleteSnapshot(snapshot, {
      season,
      targetWeek,
      seasonType
    });

    if (problems.length > 0) {
      console.error(
        `refresh-wr-snapshot: build for ${key} was incomplete, NOT caching. Problems: ${problems.join(" | ")}`
      );

      // Deliberately do not touch Blobs at all here -- any
      // previously cached snapshot for this key is left exactly as
      // it was.
      return jsonResponse(422, {
        cached: false,
        season,
        targetWeek,
        seasonType,
        blobStore: STORE_NAME,
        blobKey: key,
        error: "WR snapshot build was incomplete; existing cache (if any) was left untouched.",
        problems
      });
    }

    const store = getStore({ name: STORE_NAME });
    await store.setJSON(key, snapshot);

    console.log(
      `refresh-wr-snapshot: cached ${key} -- ${snapshot.population.length} eligible WR(s), 0 failures.`
    );

    return jsonResponse(200, {
      cached: true,
      season,
      targetWeek,
      seasonType,
      generatedAt: snapshot.generatedAt || null,
      eligibleWRPopulation: snapshot.population.length,
      failures: snapshot.failures.length,
      blobStore: STORE_NAME,
      blobKey: key
    });
  } catch (error) {
    console.error(`refresh-wr-snapshot failed for ${key}:`, error);

    return jsonResponse(502, {
      cached: false,
      season,
      targetWeek,
      seasonType,
      blobStore: STORE_NAME,
      blobKey: key,
      error: "Could not build Weekly SAGE WR snapshot.",
      detail: error.message
    });
  }
};
