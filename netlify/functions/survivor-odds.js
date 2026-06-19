
// ═══════════════════════════════════════
// ALLOWED ORIGINS
// Mirrors chat.js / adp.js convention — set ALLOWED_ORIGINS in
// Netlify environment variables to add CI testers or localhost
// without touching code.
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
// TANK01 FETCHER
// Identical pattern to chat.js's fetchTank01 — same base URL,
// same header casing, same env var.
// ═══════════════════════════════════════
async function fetchTank01(endpoint, params = {}) {
  const baseUrl = "https://tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";
  const queryString = new URLSearchParams(params).toString();
  const url = `${baseUrl}/${endpoint}${queryString ? "?" + queryString : ""}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-rapidapi-host": "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com",
      "x-rapidapi-key": process.env.TANK01_API_KEY
    }
  });

  if (!response.ok) throw new Error(`Tank01 API error (${endpoint}): ${response.status}`);
  return await response.json();
}

// ═══════════════════════════════════════
// MONEYLINE → WIN PROBABILITY (de-vigged)
// Standard implied-probability conversion, then normalized so
// both teams' probabilities sum to exactly 100% (removes the
// sportsbook's built-in vig/juice).
// ═══════════════════════════════════════
function moneylineToProb(ml) {
  const n = parseFloat(ml);
  if (isNaN(n)) return null;
  return n < 0 ? (-n) / (-n + 100) : 100 / (n + 100);
}
function devig(probA, probB) {
  if (probA == null || probB == null) return [probA, probB];
  const total = probA + probB;
  if (!total) return [probA, probB];
  return [probA / total, probB / total];
}

// ═══════════════════════════════════════
// NFL WEEK CALCULATOR — copied from chat.js so week defaults
// stay consistent across the whole site.
// UPDATE seasonStart each year.
// ═══════════════════════════════════════
function getCurrentNFLWeek() {
  const seasonStart = new Date("2026-09-09");
  const now = new Date();
  if (now < seasonStart) return "1";
  const diffDays = Math.floor((now - seasonStart) / (1000 * 60 * 60 * 24));
  return String(Math.max(1, Math.min(18, Math.floor(diffDays / 7) + 1)));
}

// ═══════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════
exports.handler = async (event) => {

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: CORS_HEADERS, body: "Method Not Allowed" };
  }

  // ── Origin check ──────────────────────────────────────────
  // GET convention from adp.js: browsers often omit Origin on
  // same-origin GET requests, so empty origin is allowed through.
  // A real cross-origin request still arrives with a populated,
  // non-matching Origin and is still blocked correctly.
  const origin = event.headers.origin || event.headers.Origin || "";
  const originAllowed = origin === "" || ALLOWED_ORIGINS.some(o => origin.startsWith(o));
  if (!originAllowed) {
    console.log(`Blocked request from origin: ${origin}`);
    return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: "Forbidden" }) };
  }

  try {
    const params = event.queryStringParameters || {};
    const week = params.week || getCurrentNFLWeek();
    const season = params.season || "2026";        // UPDATE EACH SEASON
    const seasonType = params.seasonType || "reg";

    // ── Step 1: schedule for the week ──────────────────────
    const scheduleRes = await fetchTank01("getNFLGamesForWeek", { week, season, seasonType });
    const games = Array.isArray(scheduleRes?.body) ? scheduleRes.body : [];

    if (!games.length) {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          status: "Success",
          week, season, seasonType,
          games: [],
          note: "No games returned for this week/season/seasonType. If this is unexpected, check the raw Tank01 response shape via the function logs — this is the one part of this endpoint not yet verified against a live response."
        })
      };
    }

    // ── Step 2: odds, fetched once per unique game date ────
    // (one call covers every game on that date, per Tank01 docs)
    const uniqueDates = [...new Set(games.map(g => g.gameDate).filter(Boolean))];
    const oddsByGameId = {};
    const oddsErrors = [];

    await Promise.all(uniqueDates.map(async (gameDate) => {
      try {
        const oddsRes = await fetchTank01("getNFLBettingOdds", { gameDate });
        if (oddsRes?.body && typeof oddsRes.body === "object") {
          Object.assign(oddsByGameId, oddsRes.body);
        }
      } catch (e) {
        console.log(`Odds fetch failed for gameDate ${gameDate}:`, e.message);
        oddsErrors.push({ gameDate, error: e.message });
      }
    }));

    // ── Step 3: merge schedule + odds, compute win % ───────
    const merged = games.map(g => {
      const gameID = g.gameID || `${g.away}@${g.home}_${g.gameDate}`;
      const odds = oddsByGameId[gameID] || null;

      let awayWinPct = null, homeWinPct = null, spread = null, sportsbook = null;

      // Tank01's actual shape: sportsbook names are top-level keys on the
      // odds object itself (no "sportsbooks" wrapper), mixed in alongside
      // metadata fields. Filter those out, then prefer a consistent book
      // when available so numbers don't jump between different books from
      // game to game; fall back to whichever book is present otherwise.
      if (odds) {
        const META_KEYS = new Set([
          "awayTeam", "homeTeam", "gameDate", "gameID",
          "teamIDAway", "teamIDHome", "last_updated_e_time"
        ]);
        const bookEntries = Object.entries(odds).filter(
          ([k, v]) => !META_KEYS.has(k) && v && typeof v === "object"
        );
        if (bookEntries.length) {
          const PREFERRED = ["draftkings", "fanduel", "betmgm", "caesars"];
          // Walk PREFERRED in priority order and take the first one
          // actually present, instead of walking bookEntries (Tank01's
          // return order) and taking whichever preferred book happens
          // to appear first there — that was the bug: it silently
          // picked whatever preferred book Tank01 listed first rather
          // than strictly preferring draftkings, then fanduel, etc.
          const bookByName = Object.fromEntries(bookEntries);
          const preferredName = PREFERRED.find(name => bookByName[name]);
          const bookName = preferredName || bookEntries[0][0];
          const book = bookByName[bookName] || bookEntries[0][1];
          sportsbook = bookName;
          const rawAway = moneylineToProb(book.awayTeamMLOdds);
          const rawHome = moneylineToProb(book.homeTeamMLOdds);
          [awayWinPct, homeWinPct] = devig(rawAway, rawHome);
          spread = book.homeTeamSpread ?? book.awayTeamSpread ?? null;
        }
      }

      return {
        gameID,
        gameDate: g.gameDate || null,
        gameTime: g.gameTime || null,
        away: g.away || null,
        home: g.home || null,
        awayWinPct: awayWinPct != null ? Math.round(awayWinPct * 1000) / 10 : null,
        homeWinPct: homeWinPct != null ? Math.round(homeWinPct * 1000) / 10 : null,
        spread,
        sportsbook,
        oddsFound: !!odds
      };
    });

    // ── Debug mode: ?debug=1 returns one raw odds object as-is ──
    // so we can see Tank01's actual field names instead of
    // guessing. Remove once the real shape is confirmed.
    const debugRaw = params.debug ? Object.values(oddsByGameId)[0] || null : undefined;

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        status: "Success",
        week, season, seasonType,
        games: merged,
        oddsErrors: oddsErrors.length ? oddsErrors : undefined,
        debugRawOddsSample: debugRaw
      })
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
