"use strict";
// Public cache-only reader. Customer traffic never calls Tank01.
const { connectLambda, getStore } = require("@netlify/blobs");
const STORE_NAME = "survivor-odds";
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((v) => v.trim())
  : ["https://theinnersanctum.xyz"];

function responseHeaders(origin = "") {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : "https://theinnersanctum.xyz",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=60, s-maxage=900, stale-while-revalidate=3600"
  };
}

exports.handler = async function (event = {}) {
  connectLambda(event);
  const origin = event.headers?.origin || event.headers?.Origin || "";
  const headers = responseHeaders(origin);
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "GET") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed." }) };
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return { statusCode: 403, headers, body: JSON.stringify({ error: "Forbidden" }) };

  const query = event.queryStringParameters || {};
  const week = Number(query.week);
  const season = String(query.season || new Date().getUTCFullYear());
  const seasonType = String(query.seasonType || "reg").toLowerCase();
  if (!Number.isInteger(week) || week < 1 || week > 18) return { statusCode: 400, headers, body: JSON.stringify({ error: "week must be an integer from 1 through 18." }) };
  if (!/^[0-9]{4}$/.test(season) || !["reg", "post"].includes(seasonType)) return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid season or seasonType." }) };

  try {
    const snapshot = await getStore({ name: STORE_NAME }).get(`week:${season}:${week}:${seasonType}`, { type: "json" });
    if (!snapshot || !Array.isArray(snapshot.games)) throw new Error("missing snapshot");
    const generatedAtMs = Date.parse(snapshot.generatedAt || "");
    const ageMinutes = Number.isFinite(generatedAtMs) ? Math.max(0, Math.round((Date.now() - generatedAtMs) / 60000)) : null;
    const stale = ageMinutes === null || ageMinutes > 480;
    return { statusCode: 200, headers, body: JSON.stringify({ ...snapshot, ageMinutes, stale }) };
  } catch (_) {
    return { statusCode: 503, headers: { ...headers, "Cache-Control": "no-store" }, body: JSON.stringify({ status: "Unavailable", week: String(week), season, games: [], error: "Validated Survivor odds are temporarily unavailable." }) };
  }
};
