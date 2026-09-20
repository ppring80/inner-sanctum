// ════════════════════════════════════════════════════════════════════════
// GET RISERS & FALLERS — entitlement-aware frontend data endpoint
//
// Full Top 15 data is a Founding Acolyte benefit.
// Anonymous/free visitors still receive the advertised headline preview:
// top 1 riser + top 1 faller. The signed sanctum_session cookie is
// verified server-side through the existing verify-session function.
//
// Raw cached data remains unchanged; only the response shape is truncated
// for non-entitled requests.
// ═══════════════════════════════════════════════════════════════════════
const { connectLambda, getStore } = require("@netlify/blobs");
const { handler: verifySessionHandler } = require("./verify-session");

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim())
  : ["https://theinnersanctum.xyz"];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json"
};

const MAX_SNAPSHOT_AGE_MS = 10 * 24 * 60 * 60 * 1000;

function expectedSeasonForDate(now = new Date()) {
  return String(now.getUTCFullYear());
}

function validateSnapshot(data, now = new Date()) {
  const expectedSeason = expectedSeasonForDate(now);

  if (!data || typeof data !== "object") {
    return {
      valid: false,
      status: "NoData",
      reason: "Risers & Fallers does not have a validated snapshot yet."
    };
  }

  if (String(data.season || "") !== expectedSeason) {
    return {
      valid: false,
      status: "StaleData",
      reason: `The cached Risers & Fallers snapshot is for the ${data.season || "unknown"} season, not ${expectedSeason}.`,
      expectedSeason,
      snapshotSeason: data.season || null
    };
  }

  const computedAtMs = Date.parse(data.computedAt || "");
  if (!Number.isFinite(computedAtMs)) {
    return {
      valid: false,
      status: "StaleData",
      reason: "The cached Risers & Fallers snapshot has no valid computation time.",
      expectedSeason
    };
  }

  const ageMs = now.getTime() - computedAtMs;
  if (ageMs < 0 || ageMs > MAX_SNAPSHOT_AGE_MS) {
    return {
      valid: false,
      status: "StaleData",
      reason: "The cached Risers & Fallers snapshot is too old to present as current weekly intelligence.",
      expectedSeason,
      computedAt: data.computedAt
    };
  }

  if (
    !Number.isInteger(Number(data.currentWeek)) ||
    !Number.isInteger(Number(data.previousWeek)) ||
    Number(data.currentWeek) <= Number(data.previousWeek) ||
    !Array.isArray(data.risers) ||
    !Array.isArray(data.fallers)
  ) {
    return {
      valid: false,
      status: "InvalidData",
      reason: "The cached Risers & Fallers snapshot failed its week or player-list integrity checks.",
      expectedSeason
    };
  }

  return { valid: true, expectedSeason };
}

module.exports.expectedSeasonForDate = expectedSeasonForDate;
module.exports.validateSnapshot = validateSnapshot;

async function hasFullAcolyteAccess(event) {
  try {
    const result = await verifySessionHandler({
      ...event,
      httpMethod: "GET",
      body: null
    });

    if (!result || result.statusCode !== 200) {
      return false;
    }

    const session =
      typeof result.body === "string"
        ? JSON.parse(result.body || "{}")
        : (result.body || {});

    return session.fullAccess === true;
  } catch (err) {
    console.log(
      "Risers/Fallers auth verification failed:",
      err && err.message ? err.message : String(err)
    );
    return false;
  }
}

exports.handler = async (event) => {
  connectLambda(event);

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: "Method Not Allowed"
    };
  }

  const origin = event.headers.origin || event.headers.Origin || "";
  const originAllowed =
    origin === "" ||
    ALLOWED_ORIGINS.some(o => origin.startsWith(o));

  if (!originAllowed) {
    console.log(`Blocked request from origin: ${origin}`);
    return {
      statusCode: 403,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Forbidden" })
    };
  }

  try {
    const store = getStore({ name: "risers-fallers" });
    const data = await store.get("latest", { type: "json" });

    const validation = validateSnapshot(data);

    if (!validation.valid) {
      return {
        statusCode: 200,
        headers: {
          ...CORS_HEADERS,
          "Cache-Control": "no-store"
        },
        body: JSON.stringify({
          status: validation.status,
          fullAccess: false,
          reason: validation.reason,
          expectedSeason: validation.expectedSeason,
          snapshotSeason: validation.snapshotSeason,
          computedAt: validation.computedAt,
          risers: [],
          fallers: []
        })
      };
    }

    const fullAccess = await hasFullAcolyteAccess(event);

    const risers = fullAccess
      ? (Array.isArray(data.risers) ? data.risers : [])
      : (Array.isArray(data.risers) ? data.risers.slice(0, 1) : []);

    const fallers = fulAccess
      ? (Array.isArray(data.fallers) ? data.fallers : [])
      : (Array.isArray(data.fallers) ? data.fallers.slice(0, 1) : []);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "Success",
        fullAccess,
        preview: !fullAccess,
        computedAt: data.computedAt,
        season: data.season,
        currentWeek: data.currentWeek,
        previousWeek: data.previousWeek,
        threshold: data.threshold,
        minTargetFloor: data.minTargetFloor,
        playerCount: data.playerCount,
        risers,
        fallers
      })
    };
  } catch (err) {
    console.log("Handler error:", err.message);

    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "Error",
        error: err.message
      })
    };
  }
};
