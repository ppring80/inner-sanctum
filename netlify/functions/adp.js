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
// TANK01 ADP PROXY  (replaces the old FantasyFootballCalculator proxy)
//
// Why this function exists at all: same reason as before — browser
// fetches straight to a third-party API either get CORS-blocked, or
// (in Tank01's case) would require exposing our paid RapidAPI key in
// client-side JS, where anyone could lift it from devtools and burn
// our daily quota. This function holds the key server-side and hands
// back clean JSON with our own CORS headers attached.
//
// SHAPE TRANSLATION — this is the part that matters most. draft.html's
// loadAll() was written against FFC's response shape:
//   { players: [ { name, position, team, adp }, ... ] }
// Tank01 returns a completely different shape:
//   { statusCode, body: { adpDate, adpType, adpList: [
//       { posADP: "RB1", overallADP: "4.2", playerID, longName }, ...
//   ]}}
// Rather than touch draft.html's parsing logic, this function does the
// translation so the FRONTEND SEES NO DIFFERENCE — same {players:[...]}
// shape goes out the door either way. That keeps this swap contained to
// one file.
//
// TEAM DATA: confirmed by live testing (filtering pos=DST) that Tank01's
// skill-position entries (QB/RB/WR/TE/K) carry NO team field, but DST
// entries DO — they include both teamAbv ("HOU") and teamID. So:
//   - DST/DEF: team comes straight from Tank01's own teamAbv. No merge
//     needed; this is the most current source we have for defenses.
//   - Everyone else: team goes out as null here. draft.html's existing
//     fetchSleeperTeamMap() + applyLiveTeams() step — originally just a
//     correction layer for stale FFC team data — is now the ONLY source
//     of team assignments for skill positions on this live-data path.
//     If Sleeper has no live match for a given name, that player will
//     display with no team. Flagged so it doesn't look like a mystery
//     six months from now.
//
// Also confirmed live: Tank01's ADP list DOES include defenses (29 of
// them, ranked ~150-300 overall) — they just don't appear near the top
// of the unfiltered 507-player list, easy to miss scrolling casually.
//
// KNOWN PERMANENT GAP: Tank01's DST coverage is missing exactly 3 of the
// 32 NFL teams — Arizona Cardinals, Las Vegas Raiders, New York Jets —
// confirmed by requesting pos=DST and getting back 29 entries, not 32.
// This isn't a parsing bug on our end; Tank01 simply doesn't have ADP
// data for these three. MISSING_DEF_FALLBACK below splices in static
// values for just these three so draft.html always shows all 32 teams
// even on the live-data path. Values copied from PLAYER_POOL.DEF in
// shared-player-data.js as of June 2026 — if those ADP estimates ever
// get revised there, update this block too. (Deliberately kept here in
// adp.js rather than read from shared-player-data.js, since this is a
// server-side function and that file is browser-side; see Session 11
// notes for why duplicating 3 rows was chosen over a cross-runtime
// shared-data scheme.)
// ═══════════════════════════════════════

const MISSING_DEF_FALLBACK = [
  { name: "Arizona Cardinals", position: "DEF", team: "ARI", adp: 88.7 },
  { name: "Las Vegas Raiders", position: "DEF", team: "LV", adp: 106.8 },
  { name: "New York Jets", position: "DEF", team: "NYJ", adp: 37.8 }
];

const TANK01_HOST = "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";

// Map our existing UI scoring values (used in draft.html's <select>)
// to Tank01's adpType values. Tank01 also offers bestBall/IDP/superFlex,
// which we don't currently expose in the UI — add them here first if a
// future selector option needs them.
const SCORING_TO_ADPTYPE = {
  "ppr": "PPR",
  "half-ppr": "halfPPR",
  "standard": "standard"
};

async function fetchTank01Adp({ scoring }) {
  const apiKey = process.env.TANK01_API_KEY;
  if (!apiKey) throw new Error("TANK01_API_KEY is not configured");

  const adpType = SCORING_TO_ADPTYPE[scoring] || "PPR";
  const url = `https://${TANK01_HOST}/getNFLADP?adpType=${adpType}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "x-rapidapi-key": apiKey,
      "x-rapidapi-host": TANK01_HOST
    }
  });

  if (!response.ok) throw new Error(`Tank01 API error: ${response.status}`);
  const json = await response.json();

  if (!json.body || !Array.isArray(json.body.adpList)) {
    throw new Error("Tank01 API returned no adpList");
  }

  return translateTank01Response(json.body);
}

// Tank01 uses some team abbreviations that don't match the JAX/WAS
// convention this app standardized on in backlog #97 (Sleeper and
// PLAYER_POOL both use WAS, JAX). Confirmed live: Tank01's DST list
// returns "WSH" for Washington. Normalize here so BYE[] lookups and
// any downstream team-code comparisons don't silently break the way
// the original JAC/WSH bug did before #97 fixed it.
const TEAM_ABV_NORMALIZE = {
  WSH: "WAS"
};

function normalizeTeamAbv(abv) {
  if (!abv) return abv;
  return TEAM_ABV_NORMALIZE[abv] || abv;
}
function extractPosition(posADP) {
  if (!posADP) return null;
  const match = posADP.match(/^[A-Za-z]+/);
  if (!match) return null;
  const pos = match[0].toUpperCase();
  return pos === "DST" ? "DEF" : pos;
}

function translateTank01Response(body) {
  const players = body.adpList
    .map(function (entry) {
      const position = extractPosition(entry.posADP);
      if (!position) return null;
      const adp = parseFloat(entry.overallADP);
      // Tank01 names defenses like "Houston Texans DST" — strip the
      // suffix so it matches the plain "Houston Texans" convention used
      // by PLAYER_POOL.DEF and Sleeper everywhere else in this app.
      const name = (entry.longName || "").replace(/\s+DST$/i, "");
      return {
        name: name,
        position: position,
        // DST entries carry teamAbv directly from Tank01 (confirmed live,
        // e.g. "HOU", "DEN") — use it. Skill positions don't have this
        // field at all; team stays null and is filled in by the Sleeper
        // merge step in draft.html. See TEAM DATA note above.
        team: normalizeTeamAbv(entry.teamAbv) || null,
        adp: isNaN(adp) ? 999 : adp
      };
    })
    .filter(function (p) { return p && p.name; });

  // Fill in the 3 teams Tank01's DST coverage is missing. Guarded by
  // team code so this becomes a silent no-op (not a duplicate) if Tank01
  // ever starts covering one of these teams in a future response.
  const presentDefTeams = new Set(
    players.filter(function (p) { return p.position === "DEF"; })
           .map(function (p) { return p.team; })
  );
  MISSING_DEF_FALLBACK.forEach(function (fallbackTeam) {
    if (!presentDefTeams.has(fallbackTeam.team)) players.push(fallbackTeam);
  });

  return {
    players: players,
    meta: { source: "tank01", adpType: body.adpType, adpDate: body.adpDate }
  };
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
    // NOTE: teams/year/count were meaningful to FFC's API (different ADP
    // pools by league size / season / sample count). Tank01's ADP
    // endpoint has no equivalent — it's one global current snapshot —
    // so these params are accepted for backward compatibility with
    // draft.html's existing query string but are otherwise unused here.
    const data = await fetchTank01Adp({ scoring });

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
