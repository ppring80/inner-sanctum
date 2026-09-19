const { connectLambda, getStore } = require("@netlify/blobs");

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
  "Content-Type": "application/json",
  "Cache-Control": "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400",
  "Netlify-CDN-Cache-Control": "public, durable, s-maxage=21600, stale-while-revalidate=86400"
};

// ═══════════════════════════════════════
// CACHE-ONLY ADP READER + REFRESH TRANSLATOR
//
// Customer requests read a prebuilt Netlify Blob snapshot only. The paid
// Tank01 request helper remains in this module solely for the authorized,
// scheduled refresh-adp-snapshot writer. A missing or malformed snapshot
// fails closed with 503; the customer handler never falls back to Tank01.
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
// even on the live-data path.
//
// VALUES UPDATED July 3, 2026 (Session 12): the original June 2026
// placeholder values were copied straight from PLAYER_POOL.DEF's
// then-current numbers just to fill the coverage gap — they were never
// meant to be authoritative and happened to rank Jets/Cardinals/Raiders
// #1-3 overall among all 32 defenses, which is backwards from reality
// and was caught during a pre-launch human eyeball test on Draft
// Command Center. Corrected against current consensus DST rankings
// (CBS Sports consensus, cross-checked against FantasyPros and Athlon,
// all agreeing these 3 sit in the bottom 6 of 32 teams for 2026):
// Raiders ~27th, Jets ~30th, Cardinals ~31st of 32. New ADP values
// place them past the tail end of Tank01's live-covered range so they
// read as true late-draft/waiver-tier defenses, matching real-world
// expectations. If these estimates are ever revised again, update the
// mirrored PLAYER_POOL.DEF entries in shared-player-data.js too — kept
// duplicated here (not read from that file) since this is a server-side
// function and that file is browser-side; see Session 11 notes for why
// duplicating 3 rows was chosen over a cross-runtime shared-data scheme.
// ═══════════════════════════════════════

const MISSING_DEF_FALLBACK = [
  { name: "Las Vegas Raiders", position: "DEF", team: "LV", adp: 212.4 },
  { name: "New York Jets", position: "DEF", team: "NYJ", adp: 228.6 },
  { name: "Arizona Cardinals", position: "DEF", team: "ARI", adp: 241.9 }
];

const TANK01_HOST = "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";
const ADP_STORE_NAME = "adp-snapshot";
const ADP_EVIDENCE_TYPE = "tank01-adp-snapshot";

// Map our existing UI scoring values (used in draft.html's <select>)
// to Tank01's adpType values. Tank01 also offers bestBall/IDP/superFlex,
// which we don't currently expose in the UI — add them here first if a
// future selector option needs them.
const SCORING_TO_ADPTYPE = {
  "ppr": "PPR",
  "half": "halfPPR",
  "half-ppr": "halfPPR",
  "standard": "standard"
};

function normalizeScoring(value) {
  const raw = String(value || "ppr").trim().toLowerCase();
  if (["half", "half-ppr", "halfppr", "0.5ppr"].includes(raw)) {
    return "half";
  }
  if (raw === "standard" || raw === "std") {
    return "standard";
  }
  return "ppr";
}

async function fetchTank01Adp({ scoring }) {
  const apiKey = process.env.TANK01_API_KEY;
  if (!apiKey) throw new Error("TANK01_API_KEY is not configured");

  const normalizedScoring = normalizeScoring(scoring);
  const adpType = SCORING_TO_ADPTYPE[normalizedScoring] || "PPR";
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

exports.fetchTank01Adp = fetchTank01Adp;
exports.normalizeScoring = normalizeScoring;
exports.translateTank01Response = translateTank01Response;

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

function validateCachedAdpRecord(record, expectedScoring) {
  if (!record || typeof record !== "object") return "ADP snapshot is missing.";
  if (record.evidenceType !== ADP_EVIDENCE_TYPE) return "ADP snapshot evidence type is invalid.";
  if (record.schemaVersion !== 1) return "ADP snapshot schema version is unsupported.";
  if (record.scoring !== expectedScoring) return "ADP snapshot scoring format does not match.";
  if (!Array.isArray(record.players) || record.players.length === 0) return "ADP snapshot population is empty.";
  if (!record.meta || typeof record.meta !== "object") return "ADP snapshot metadata is missing.";
  return null;
}

exports.validateCachedAdpRecord = validateCachedAdpRecord;
exports.ADP_STORE_NAME = ADP_STORE_NAME;

// ═══════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════
exports.handler = async (event) => {
  connectLambda(event);

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
    const scoring = normalizeScoring(params.scoring || "ppr");
    // NOTE: teams/year/count were meaningful to FFC's API (different ADP
    // pools by league size / season / sample count). Tank01's ADP
    // endpoint has no equivalent — it's one global current snapshot —
    // so these params are accepted for backward compatibility with
    // draft.html's existing query string but are otherwise unused here.
    const store = getStore({ name: ADP_STORE_NAME });
    const cached = await store.get(`scoring:${scoring}`, { type: "json" });
    const cacheProblem = validateCachedAdpRecord(cached, scoring);

    if (cacheProblem) {
      console.error(`adp: cache-only read failed for ${scoring}: ${cacheProblem}`);
      return {
        statusCode: 503,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: "ADP data is temporarily unavailable.",
          cacheOnly: true,
          scoring
        })
      };
    }

    const data = {
      players: cached.players,
      meta: {
        ...cached.meta,
        scoring: cached.scoring,
        cacheOnly: true
      }
    };

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(data)
    };
  } catch (err) {
    console.log("Handler error:", err.message);
    return {
      statusCode: 503,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "ADP data is temporarily unavailable.",
        cacheOnly: true
      })
    };
  }
};
