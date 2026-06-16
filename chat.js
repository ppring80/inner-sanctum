const Anthropic = require("@anthropic-ai/sdk");

// ═══════════════════════════════════════
// ALLOWED ORIGINS
// Set ALLOWED_ORIGINS in Netlify environment variables
// to add CI testers or localhost without touching code.
// Example value: https://theinnersanctum.xyz,http://localhost:3000
// If not set, defaults to production domain only.
// ═══════════════════════════════════════
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim())
  : ["https://theinnersanctum.xyz"];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

// ═══════════════════════════════════════
// TANK01 DATA FETCHER
// Each call wrapped independently — one failure
// does not affect others or block the response.
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

  if (!response.ok) throw new Error(`Tank01 API error: ${response.status}`);
  return await response.json();
}

// ═══════════════════════════════════════
// NFL WEEK CALCULATOR
// 2026 season starts September 9, 2026.
// Returns "1" during offseason/preseason.
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
// LIVE NFL CONTEXT BUILDER
// Assembles data sources from Tank01.
// Any individual source can fail silently —
// response continues with whatever data loaded.
// ═══════════════════════════════════════
async function getLiveNFLContext() {
  const contextParts = [];

  // 1. Top NFL news headlines
  try {
    const news = await fetchTank01("getNFLNews", { topNews: "true", maxItems: "5" });
    if (news?.body?.length > 0) {
      const headlines = news.body
        .slice(0, 5)
        .map(item => `- ${item.title}`)
        .join("\n");
      contextParts.push(`LATEST NFL NEWS (updated live):\n${headlines}`);
    }
  } catch (e) {
    console.log("Tank01 news fetch failed:", e.message);
  }

  // 2. Fantasy projections — DISABLED (Tank01 returns non-iterable body in offseason)
  // Re-enable in September when season starts.
  // try {
  //   const projections = await fetchTank01("getNFLProjections", {
  //     week: getCurrentNFLWeek(),
  //     season: "2026"
  //   });
  //   if (projections?.body && typeof projections.body === 'object' && !Array.isArray(projections.body)) {
  //     const topPlayers = Object.values(projections.body)
  //       .slice(0, 20)
  //       .map(p => `${p.longName || p.playerName} (${p.pos}, ${p.team}): ${p.fantasyPoints || "N/A"} proj pts`)
  //       .join("\n");
  //     contextParts.push(`TOP FANTASY PROJECTIONS THIS WEEK:\n${topPlayers}`);
  //   }
  // } catch (e) {
  //   console.log("Tank01 projections fetch failed:", e.message);
  // }

  // 3. Current injury report
  try {
    const injuries = await fetchTank01("getNFLInjuries");
    if (injuries?.body?.length > 0) {
      const injuryList = injuries.body
        .slice(0, 15)
        .map(p => `${p.longName || p.playerName} (${p.pos}, ${p.team}): ${p.injuryStatus || "Questionable"} — ${p.injuryDescription || "injury"}`)
        .join("\n");
      contextParts.push(`CURRENT NFL INJURY REPORT:\n${injuryList}`);
    }
  } catch (e) {
    console.log("Tank01 injury fetch failed:", e.message);
  }

  // 4. Current ADP data
  try {
    const adp = await fetchTank01("getNFLADP", { season: "2026" });  // UPDATE EACH SEASON
    if (adp?.body?.length > 0) {
      const adpList = adp.body
        .slice(0, 20)
        .map(p => `${p.longName || p.playerName} (${p.pos}, ${p.team}): ADP ${p.adp || "N/A"}`)
        .join("\n");
      contextParts.push(`CURRENT ADP (Average Draft Position):\n${adpList}`);
    }
  } catch (e) {
    console.log("Tank01 ADP fetch failed:", e.message);
  }

  return contextParts.join("\n\n");
}

// ═══════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════
exports.handler = async (event) => {

  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  // Only allow POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS_HEADERS, body: "Method Not Allowed" };
  }

  // ── Origin check ──────────────────────────────────────────
  const origin = event.headers.origin || event.headers.Origin || "";
  const originAllowed = ALLOWED_ORIGINS.some(o => origin.startsWith(o));
  if (!originAllowed) {
    console.log(`Blocked request from origin: ${origin}`);
    return {
      statusCode: 403,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Forbidden" })
    };
  }

  try {
    const { model, max_tokens, system, messages } = JSON.parse(event.body);

    // Fetch live NFL context from Tank01 (non-fatal)
    let liveDataContext = "";
    try {
      liveDataContext = await getLiveNFLContext();
    } catch (e) {
      console.log("Tank01 context fetch failed:", e.message);
    }

    // Inject live data into the system prompt
    const enhancedSystem = liveDataContext
      ? `${system}\n\n═══════════════════════════════════\nLIVE NFL DATA — USE THIS IN YOUR RESPONSE:\n${liveDataContext}\n═══════════════════════════════════\nAlways reference specific players, injury statuses, and projections from the live data above when relevant. This data is current as of today.`
      : system;

    // Call Claude API
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model,
      max_tokens,
      system: enhancedSystem,
      messages
    });

    // Extract all text blocks from the response
    const fullText = response.content
      .filter(block => block.type === "text")
      .map(block => block.text)
      .join("\n")
      .trim();

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ content: [{ type: "text", text: fullText }] })
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
