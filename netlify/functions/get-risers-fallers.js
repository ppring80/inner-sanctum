// ═══════════════════════════════════════════════════════════════════════
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

    if (!data) {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "NoData",
          fullAccess: false,
          risers: [],
          fallers: []
        })
      };
    }

    const fullAccess = await hasFullAcolyteAccess(event);

    const risers = fullAccess
      ? (Array.isArray(data.risers) ? data.risers : [])
      : (Array.isArray(data.risers) ? data.risers.slice(0, 1) : []);

    const fallers = fullAccess
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
