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
  "Content-Type": "application/json"
};

// ═══════════════════════════════════════
// CACHED TANK01 ADP READER
//
// Provider safety architecture:
//   scheduled refresh-adp.js -> Tank01 -> Netlify Blobs -> THIS FILE
//
// This customer-facing endpoint makes ZERO Tank01 calls. It reads the
// most recent validated scoring-specific ADP snapshot from the
// "draft-adp" Blob store and preserves the frontend response contract
// draft.html already expects:
//   { players: [ { name, position, team, adp }, ... ], meta: ... }
//
// The scheduled writer stores raw Tank01 response bodies so this file
// remains the single source of truth for Tank01 -> Draft Command shape
// translation, including team-code normalization and the three known
// missing DST fallbacks.
// ═══════════════════════════════════════

const ADP_STORE_NAME = "draft-adp";

const MISSING_DEF_FALLBACK = [
  { name: "Las Vegas Raiders", position: "DEF", team: "LV", adp: 212.4 },
  { name: "New York Jets", position: "DEF", team: "NYJ", adp: 228.6 },
  { name: "Arizona Cardinals", position: "DEF", team: "ARI", adp: 241.9 }
];

const VALID_SCORING = new Set([
  "ppr",
  "half-ppr",
  "standard"
]);

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

function translateTank01Response(body, cacheMeta = {}) {
  const players = body.adpList
    .map(function (entry) {
      const position = extractPosition(entry.posADP);
      if (!position) return null;

      const adp = parseFloat(entry.overallADP);
      const name = (entry.longName || "").replace(/\s+DST$/i, "");

      return {
        name,
        position,
        team: normalizeTeamAbv(entry.teamAbv) || null,
        adp: isNaN(adp) ? 999 : adp
      };
    })
    .filter(function (player) {
      return player && player.name;
    });

  const presentDefTeams = new Set(
    players
      .filter(function (player) {
        return player.position === "DEF";
      })
      .map(function (player) {
        return player.team;
      })
  );

  MISSING_DEF_FALLBACK.forEach(function (fallbackTeam) {
    if (!presentDefTeams.has(fallbackTeam.team)) {
      players.push({ ...fallbackTeam });
    }
  });

  return {
    players,
    meta: {
      source: "tank01",
      delivery: "scheduled-cache",
      adpType: body.adpType,
      adpDate: body.adpDate,
      generatedAt: cacheMeta.generatedAt || null
    }
  };
}

async function readCachedAdp(scoring) {
  const store = getStore({ name: ADP_STORE_NAME });
  const cached = await store.get(`scoring:${scoring}`, { type: "json" });

  if (
    !cached ||
    !cached.body ||
    !Array.isArray(cached.body.adpList) ||
    cached.body.adpList.length === 0
  ) {
    throw new Error(`Cached ADP is unavailable for scoring=${scoring}`);
  }

  return translateTank01Response(cached.body, cached);
}

// ═══════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════
exports.handler = async (event) => {
  connectLambda(event);

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: ""
    };
  }

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: "Method Not Allowed"
    };
  }

  // Preserve existing same-origin GET behavior. Browser same-origin
  // requests may omit Origin, so an empty value remains allowed.
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
    const params = event.queryStringParameters || {};
    const requestedScoring = params.scoring || "ppr";
    const scoring = VALID_SCORING.has(requestedScoring)
      ? requestedScoring
      : "ppr";

    // NOTE: teams/year/count remain accepted for backward compatibility
    // with draft.html's existing query string. Tank01's ADP source does
    // not vary by those values, so they remain intentionally unused.
    const data = await readCachedAdp(scoring);

    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": "public, max-age=300, s-maxage=300"
      },
      body: JSON.stringify(data)
    };
  } catch (err) {
    console.log("ADP cache read failed:", err.message);
    return {
      statusCode: 503,
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": "no-store"
      },
      body: JSON.stringify({
        error: "ADP cache unavailable",
        detail: err.message
      })
    };
  }
};
