// netlify/functions/player-data.js
//
// ═══════════════════════════════════════
// PLAYER DATA READ ENDPOINT — unifies live team/injury source of truth
// ═══════════════════════════════════════
//
// WHY THIS EXISTS: as of tonight, chat.js (Sanctum) and the four other
// player-data-driven pages (Draft Command Center, Tier List, Auction
// War Room — Survivor Pool doesn't use player-level data at all) read
// LIVE team-assignment and injury data from two completely different
// providers: chat.js reads Tank01's roster cache (built daily by
// refresh-player-data.js), while the other three pages hit Sleeper's
// live API directly on every page load. Nothing keeps those two
// providers in agreement — they can genuinely disagree at any given
// moment, with no cross-check between them. This has NOT caused a
// visible bug yet, but it's the same structural shape as the WAS/WSH
// and JAX/WSH mismatches this project has already hit multiple times
// (see Pre-Deployment Checklist #96/#98/#100/#101) — those were bugs
// WITHIN one source; this is a gap BETWEEN two sources.
//
// FIX: this endpoint exposes the SAME cache chat.js already reads —
// built by refresh-player-data.js, stored in Netlify Blobs under the
// "player-data" store, key "playerData" — to the browser, so the other
// three pages can read the identical live data Sanctum already uses
// instead of maintaining a second, independent live-data path via
// Sleeper. This does NOT touch or replace any page's FALLBACK data
// (shared-player-data.js's PLAYER_POOL, auction.html's
// STATIC_ADP_FALLBACK, or Sanctum's own fallback behavior) — those
// stay exactly as they are, as the deliberate safety net for when live
// data of ANY kind is unreachable. This endpoint only unifies the LIVE
// path, so that when live data IS working, every page agrees on it.
//
// DATA SHAPE: identical to what's already in Blobs — see
// refresh-player-data.js for how this is built, and chat.js's
// getLiveNFLContext() (item 4) for the proven-working read pattern
// this file's read logic is copied from directly, rather than
// re-guessing the shape:
//
//   {
//     updatedAt: "2026-07-11T00:00:00.000Z",
//     playerCount: 2677,
//     teamsSucceeded: 32,
//     teamsFailed: 0,
//     players: {
//       "<playerID>": {
//         longName: "Patrick Mahomes",
//         pos: "QB",
//         team: "KC",
//         exp: "9",              // or "R" for rookie
//         injury: {              // present only if currently injured
//           designation: "Questionable",
//           description: "Ankle",
//           ...
//         }
//       },
//       ...
//     }
//   }
//
// This endpoint returns that object as-is (GET, no params) — consumers
// get the full playerID-keyed map and can look up by playerID, or by
// building their own name-keyed index client-side if that's more
// convenient for a given page (Sleeper-based pages currently key off
// player NAME, not Tank01's playerID — see integration notes below).
//
// STALENESS: this cache refreshes once daily (@daily, see
// refresh-player-data.js / netlify.toml). updatedAt is included in the
// response specifically so a consuming page CAN show a "data as of..."
// note if that ever matters, same spirit as chat.js's ageNote — not
// required, just available.
// ═══════════════════════════════════════

const { getStore, connectLambda } = require("@netlify/blobs");

// ═══════════════════════════════════════
// ALLOWED ORIGINS — same convention as every other function on this
// site (chat.js, adp.js, survivor-odds.js). Set ALLOWED_ORIGINS in
// Netlify environment variables to add CI testers or localhost.
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

exports.handler = async (event) => {
  // Required for Netlify Blobs in this runtime mode (Lambda
  // compatibility — classic exports.handler signature). Must be
  // called before any getStore() call. Same requirement as chat.js /
  // refresh-player-data.js / spend-dashboard.js.
  connectLambda(event);

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: CORS_HEADERS, body: "Method Not Allowed" };
  }

  // ── Origin check ──────────────────────────────────────────
  // GET convention from adp.js/survivor-odds.js: browsers often omit
  // Origin on same-origin GET requests, so empty origin is allowed
  // through. A real cross-origin request still arrives with a
  // populated, non-matching Origin and is still blocked correctly.
  // (This is the GET-endpoint convention already used elsewhere on
  // this site — distinct from chat.js's stricter exact-match-only
  // check, which is correct for POST endpoints that spend real money
  // per call. This endpoint is read-only and free to call, same risk
  // profile as adp.js.)
  const origin = event.headers.origin || event.headers.Origin || "";
  const originAllowed = origin === "" || ALLOWED_ORIGINS.some(o => origin.startsWith(o));
  if (!originAllowed) {
    console.log(`Blocked request from origin: ${origin}`);
    return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: "Forbidden" }) };
  }

  try {
    // ── Read the cache — logic copied directly from chat.js's
    // getLiveNFLContext() item 4, the one place on this site that has
    // already correctly read this cache's real shape, rather than
    // re-guessing field names here. ──
    const store = getStore({ name: "player-data" });
    const cached = await store.get("playerData", { type: "json" });

    if (!cached || !cached.players) {
      // Cache empty or not yet populated (e.g. before
      // refresh-player-data.js's first scheduled run). Not an error —
      // a consuming page should treat this the same way it would
      // treat "live fetch failed" and fall back to its own static
      // fallback data, same pattern already used everywhere else on
      // this site (adp.js unreachable -> STATIC_ADP_FALLBACK, etc.).
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "Empty",
          note: "Player data cache is empty or not yet populated. Consumers should fall back to static data.",
          updatedAt: null,
          playerCount: 0,
          players: {}
        })
      };
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "Success",
        updatedAt: cached.updatedAt || null,
        playerCount: cached.playerCount || Object.keys(cached.players).length,
        teamsSucceeded: cached.teamsSucceeded,
        teamsFailed: cached.teamsFailed,
        players: cached.players
      })
    };
  } catch (err) {
    console.log("player-data.js handler error:", err.message);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message })
    };
  }
};
