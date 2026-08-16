// netlify/functions/opportunity-intel.js
//
// OPPORTUNITY INTELLIGENCE — DIAGNOSTIC READ ENDPOINT (Phase 1, Aug 15 2026)
//
// Read-only, GET, no write access — mirrors player-data.js's pattern
// exactly (that file is the proven read-side companion to
// refresh-player-data.js's write-side; this is the same shape for the
// new "opportunity-intel" Blobs store).
//
// PURPOSE: manual inspection ONLY, for validating
// refresh-opportunity-intel.js's output. Nothing in production reads
// this endpoint — confirmed by grep, no other file references it.
// This is intentionally separate from any future real consumer-facing
// read path, which would be a distinct, later, deliberate integration
// step per the Opportunity Intelligence audit's Phase 1 recommendation.
//
// USAGE:
//   GET /.netlify/functions/opportunity-intel
//     -> the full "latest" cached window (whatever
//        refresh-opportunity-intel.js last wrote)
//   GET /.netlify/functions/opportunity-intel?player=<name>&pos=<POS>
//     -> looks up one record by the same normalizePlayerName(name)+'|'+pos
//        key convention used everywhere else in this codebase, including
//        _rawGames (per-game carries/targets/opportunities) for manual
//        sanity-checking against the raw Tank01 numbers
//   GET /.netlify/functions/opportunity-intel?window=<season>:<weeks>
//     -> a specific historical window instead of "latest", e.g.
//        window=2026:1-2-3 for the Phase 1 default test window
// ═══════════════════════════════════════

const { getStore, connectLambda } = require("@netlify/blobs");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

// Must be byte-for-byte identical to shared-player-data.js's real
// normalizePlayerName() and refresh-opportunity-intel.js's copy of it
// -- see that file's header comment for why this specific duplication
// needs care (a first draft here used the wrong, hyphenated convention).
function normalizePlayerName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[.''']/g, "")
    .replace(/-/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

exports.handler = async (event) => {
  connectLambda(event);

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "GET only" }),
    };
  }

  const params = event.queryStringParameters || {};

  try {
    const store = getStore({ name: "opportunity-intel" });
    const cacheKey = params.window ? `window:${params.window}` : "latest";
    const cached = await store.get(cacheKey, { type: "json" });

    if (!cached) {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: `No cached Opportunity Intelligence data found for key "${cacheKey}". Has refresh-opportunity-intel.js been run yet?`,
        }),
      };
    }

    if (params.player && params.pos) {
      const key = `${normalizePlayerName(params.player)}|${params.pos.toUpperCase()}`;
      const record = cached.records ? cached.records[key] : undefined;

      if (!record) {
        return {
          statusCode: 404,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            error: `No record for key "${key}" in this window.`,
            computedAt: cached.computedAt,
            weeksRequested: cached.weeksRequested,
          }),
        };
      }

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify(record, null, 2),
      };
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(cached, null, 2),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "Cache read failed",
        detail: e.message,
      }),
    };
  }
};
