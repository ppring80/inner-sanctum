// Inner Sanctum — bounded Tank01 ADP cache writer.
//
// One authorized invocation fetches exactly the three supported scoring
// formats, validates every result, and only then replaces their Blob records.
// Customer-facing ADP readers never invoke this function.

const { connectLambda, getStore } = require("@netlify/blobs");
const {
  isNetlifyScheduledInvocation,
  requireTank01RefreshAuthorization
} = require("./_tank01-refresh-guard.js");
const {
  fetchTank01Adp,
  normalizeScoring
} = require("./adp.js");

const STORE_NAME = "adp-snapshot";
const SCORING_FORMATS = Object.freeze(["ppr", "half", "standard"]);
const MAX_TANK01_CALLS_PER_RUN = 3;

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

function validateAdpResult(result, scoring) {
  const problems = [];

  if (!result || typeof result !== "object") {
    return [`${scoring} ADP result is not an object.`];
  }

  if (!Array.isArray(result.players) || result.players.length === 0) {
    problems.push(`${scoring} ADP population is empty.`);
  } else {
    const invalid = result.players.filter((player) =>
      !player ||
      typeof player.name !== "string" ||
      !player.name.trim() ||
      typeof player.position !== "string" ||
      !player.position.trim() ||
      !Number.isFinite(Number(player.adp))
    );

    if (invalid.length > 0) {
      problems.push(`${scoring} ADP contains ${invalid.length} invalid player record(s).`);
    }
  }

  if (!result.meta || typeof result.meta !== "object") {
    problems.push(`${scoring} ADP metadata is missing.`);
  }

  return problems;
}

function snapshotRecord(result, scoring, generatedAt) {
  return {
    evidenceType: "tank01-adp-snapshot",
    schemaVersion: 1,
    generatedAt,
    scoring: normalizeScoring(scoring),
    directTank01Calls: 1,
    players: result.players,
    meta: {
      ...result.meta,
      cachedAt: generatedAt
    }
  };
}

exports.handler = async function (event) {
  connectLambda(event);

  if (
    !isNetlifyScheduledInvocation(event) &&
    event.httpMethod &&
    event.httpMethod !== "GET"
  ) {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  const authorizationError = requireTank01RefreshAuthorization(event);
  if (authorizationError) return authorizationError;

  if (SCORING_FORMATS.length > MAX_TANK01_CALLS_PER_RUN) {
    return jsonResponse(500, {
      cached: false,
      error: "ADP safety stop: configured scoring formats exceed the per-run Tank01 limit."
    });
  }

  try {
    const results = [];

    // Sequential by design: the exact call count stays obvious in logs and
    // avoids a burst against Tank01 for a tiny three-request workload.
    for (const scoring of SCORING_FORMATS) {
      const data = await fetchTank01Adp({ scoring });
      results.push({ scoring, data });
    }

    const problems = results.flatMap(({ scoring, data }) =>
      validateAdpResult(data, scoring)
    );

    if (problems.length > 0) {
      console.error(
        `refresh-adp-snapshot: incomplete build, NOT caching. Problems: ${problems.join(" | ")}`
      );
      return jsonResponse(422, {
        cached: false,
        error: "ADP snapshot build was incomplete; existing cache was left untouched.",
        problems,
        tank01Calls: SCORING_FORMATS.length
      });
    }

    const generatedAt = new Date().toISOString();
    const store = getStore({ name: STORE_NAME });

    await Promise.all(
      results.map(({ scoring, data }) =>
        store.setJSON(
          `scoring:${normalizeScoring(scoring)}`,
          snapshotRecord(data, scoring, generatedAt)
        )
      )
    );

    const populations = Object.fromEntries(
      results.map(({ scoring, data }) => [scoring, data.players.length])
    );

    console.log(
      `refresh-adp-snapshot: cached ppr/half/standard -- ${SCORING_FORMATS.length} Tank01 call(s); populations ${JSON.stringify(populations)}.`
    );

    return jsonResponse(200, {
      cached: true,
      blobStore: STORE_NAME,
      generatedAt,
      scoringFormats: SCORING_FORMATS,
      populations,
      tank01Calls: SCORING_FORMATS.length,
      maxTank01CallsPerRun: MAX_TANK01_CALLS_PER_RUN
    });
  } catch (error) {
    console.error("refresh-adp-snapshot failed:", error);
    return jsonResponse(502, {
      cached: false,
      blobStore: STORE_NAME,
      error: "Could not build the Tank01 ADP snapshot.",
      detail: error && error.message ? error.message : String(error),
      maxTank01CallsPerRun: MAX_TANK01_CALLS_PER_RUN
    });
  }
};

exports.validateAdpResult = validateAdpResult;
exports.snapshotRecord = snapshotRecord;
exports.SCORING_FORMATS = SCORING_FORMATS;
exports.MAX_TANK01_CALLS_PER_RUN = MAX_TANK01_CALLS_PER_RUN;
