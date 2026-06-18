
// ═══════════════════════════════════════
// ALLOWED ORIGINS
// Mirrors chat.js's convention — set ALLOWED_ORIGINS in Netlify
// environment variables to add CI testers or localhost without
// touching code.
// Example value: https://theinnersanctum.xyz,http://localhost:3000
// If not set, defaults to production domain only.
// ═══════════════════════════════════════
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim())
  : ["https://theinnersanctum.xyz"];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json"
};

// ═══════════════════════════════════════
// FANTASYFOOTBALLCALCULATOR ADP PROXY
// Browser fetches straight to FFC's API get CORS-blocked because
// FFC doesn't send Access-Control-Allow-Origin headers. CORS is a
// browser-enforced restriction — it does not apply to server-to-
// server requests. This function makes the same request from
// Netlify's servers (no CORS issue there) and hands the JSON back
// to the browser with our own CORS headers attached.
// ═══════════════════════════════════════
async function fetchFFCAdp({ scoring, teams, year, count }) {
  const url = `https://fantasyfootballcalculator.com/api/v1/adp/${scoring}?teams=${teams}&year=${year}&count=${count}`;

  const response = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" }
  });

  if (!response.ok) throw new Error(`FFC API error: ${response.status}`);
  return await response.json();
}

// ═══════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════
exports.handler = async (event) => {

  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  // Only allow GET — read-only proxy, no body needed
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: CORS_HEADERS, body: "Method Not Allowed" };
  }

  // ── Origin check ──────────────────────────────────────────
  // Note: unlike chat.js (POST), this is a GET endpoint. Browsers
  // often omit the Origin header on same-origin GET requests, so
  // an empty origin is treated as allowed. A real cross-origin
  // request still arrives with its own (non-matching) Origin
  // value and gets blocked normally.
  const origin = event.headers.origin || event.headers.Origin || "";
  const originAllowed = origin === "" || ALLOWED_ORIGINS.some(o => origin.startsWith(o));
  if (!originAllowed) {
    console.log(`Blocked request from origin: ${origin}`);
    return {
      statusCode: 403,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Forbidden" })
    };
  }

  try {
    const params = event.queryStringParameters || {};
    const scoring = params.scoring || "ppr";
    const teams = params.teams || "12";
    const year = params.year || "2026";   // UPDATE EACH SEASON
    const count = params.count || "300";

    const data = await fetchFFCAdp({ scoring, teams, year, count });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(data)
    };

  } catch (err) {
    console.log("Handler error:", err.message);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message })
    };
  }
};
