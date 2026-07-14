// ═══════════════════════════════════════════════════════════════════════
// GET RISERS & FALLERS — public frontend data endpoint
//
// Reads whatever refresh-risers-fallers.js most recently cached (the
// "latest" key) and returns it as clean, raw JSON for risers-fallers.html
// to render and style itself. Distinct from view-risers-fallers.js,
// which pre-formats everything into human-readable percentage strings
// for manual eyeball-testing in a browser tab — this endpoint hands back
// raw numbers (0.234, not "23.4%") so the frontend controls its own
// formatting, colors, and badges.
//
// Same CORS/origin-check convention as adp.js (a GET, read-only proxy),
// since this is called from the browser same as that function is.
// ═══════════════════════════════════════════════════════════════════════
const { connectLambda, getStore } = require("@netlify/blobs");

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim())
  : ["https://theinnersanctum.xyz"];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json"
};

exports.handler = async (event) => {
  connectLambda(event);

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: CORS_HEADERS, body: "Method Not Allowed" };
  }

  // Same empty-origin-allowed convention as adp.js — browsers often omit
  // Origin on same-origin GET requests.
  const origin = event.headers.origin || event.headers.Origin || "";
  const originAllowed = origin === "" || ALLOWED_ORIGINS.some(o => origin.startsWith(o));
  if (!originAllowed) {
    console.log(`Blocked request from origin: ${origin}`);
    return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: "Forbidden" }) };
  }

  try {
    const store = getStore({ name: "risers-fallers" });
    const data = await store.get("latest", { type: "json" });

    if (!data) {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ status: "NoData", risers: [], fallers: [] })
      };
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "Success",
        computedAt: data.computedAt,
        season: data.season,
        currentWeek: data.currentWeek,
        previousWeek: data.previousWeek,
        threshold: data.threshold,
        minTargetFloor: data.minTargetFloor,
        playerCount: data.playerCount,
        risers: data.risers,
        fallers: data.fallers
      })
    };
  } catch (err) {
    console.log("Handler error:", err.message);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ status: "Error", error: err.message })
    };
  }
};
