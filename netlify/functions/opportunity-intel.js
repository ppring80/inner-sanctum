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

// ═══════════════════════════════════════
// TEMPORARY DIAGNOSTIC — sample=validation (Aug 16 2026)
//
// Added ONLY to get a small, pasteable slice of the real 437-player
// cache to Pat for the SAGE Step 2 draftOpportunityProfile validation
// pass (large pastes have been failing to render in this account).
// Read-only: this branch never calls store.set/setJSON, never touches
// refresh-opportunity-intel.js, and never recomputes or mutates the
// cache it reads -- it slices the SAME `cached` object the normal
// endpoint already fetched via store.get(), nothing more.
//
// Every selection criterion below reuses an EXISTING signal
// (volumeTier==="role-player", sampleSize==="limited",
// opportunities.gamesSampled===0) -- no new threshold or calculation is
// introduced here, this is selection/slicing logic only. Each selected
// player's record is included COMPLETE and unmodified -- no fields
// stripped.
// ═══════════════════════════════════════

const VALIDATION_NAMED_PLAYERS = [
  { name: "Bijan Robinson", pos: "RB" },
  { name: "Jahmyr Gibbs", pos: "RB" },
  { name: "Christian McCaffrey", pos: "RB" },
  { name: "Derrick Henry", pos: "RB" },
  { name: "Ja'Marr Chase", pos: "WR" },
  { name: "Travis Kelce", pos: "TE" },
];

function recordHasSignal(record, type, value) {
  return Array.isArray(record.signals) && record.signals.some((s) => s.type === type && s.value === value);
}

// Pure function: given the already-fetched `cached` object (whatever
// shape store.get() returned, untouched), returns a small subset of
// `cached.records` matching the requested validation categories.
// Exported for direct unit testing without live Blobs/network access.
function buildValidationSample(cached) {
  const records = (cached && cached.records) || {};
  const allKeys = Object.keys(records);
  const selectedKeys = [];
  const sample = {};

  function addByKey(key) {
    if (selectedKeys.indexOf(key) === -1 && records[key]) {
      selectedKeys.push(key);
      sample[key] = records[key];
    }
  }

  // The 6 named validation players.
  VALIDATION_NAMED_PLAYERS.forEach((p) => {
    addByKey(`${normalizePlayerName(p.name)}|${p.pos}`);
  });

  // 3 real low-volume players -- existing volumeTier==="role-player" signal.
  allKeys
    .filter((k) => selectedKeys.indexOf(k) === -1 && recordHasSignal(records[k], "volumeTier", "role-player"))
    .sort()
    .slice(0, 3)
    .forEach(addByKey);

  // 3 real limited-sample players -- existing sampleSize==="limited" signal.
  allKeys
    .filter((k) => selectedKeys.indexOf(k) === -1 && recordHasSignal(records[k], "sampleSize", "limited"))
    .sort()
    .slice(0, 3)
    .forEach(addByKey);

  // Up to 3 genuine zero-game/no-history records, if any exist in this
  // dataset (every record in the cache today comes from at least one
  // real box-score stat line, so this may legitimately return none --
  // that is itself a real, honest finding, not a bug).
  allKeys
    .filter((k) => selectedKeys.indexOf(k) === -1 && records[k].opportunities && records[k].opportunities.gamesSampled === 0)
    .sort()
    .slice(0, 3)
    .forEach(addByKey);

  return sample;
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

    // TEMPORARY DIAGNOSTIC (see header comment above buildValidationSample):
    // strictly additive branch, only reached when ?sample=validation is
    // explicitly passed. Every other query shape (no params, ?player=&pos=,
    // ?window=) falls through to the exact same code as before this change.
    if (params.sample === "validation") {
      const sample = buildValidationSample(cached);
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify(
          {
            computedAt: cached.computedAt,
            fullPopulationCount: Object.keys(cached.records || {}).length,
            sampleCount: Object.keys(sample).length,
            records: sample,
          },
          null,
          2
        ),
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

// Exported for direct unit testing of the pure selection logic,
// independent of the live Blobs fetch -- see opportunity-intel-sample.test.js.
module.exports.buildValidationSample = buildValidationSample;
module.exports.normalizePlayerName = normalizePlayerName;
module.exports.VALIDATION_NAMED_PLAYERS = VALIDATION_NAMED_PLAYERS;
