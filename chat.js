const Anthropic = require("@anthropic-ai/sdk");

// ═══════════════════════════════════════
// ALLOWED ORIGINS
// ═══════════════════════════════════════
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim())
  : ["https://theinnersanctum.xyz"];

// ═══════════════════════════════════════
// VALID MODELS
// ═══════════════════════════════════════
const VALID_MODELS = [
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-haiku-4-5-20251001"
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

// ═══════════════════════════════════════
// TANK01 DATA FETCHER
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

  // 2. Fantasy projections for current week
  try {
    const projections = await fetchTank01("getNFLProjections", {
      week: getCurrentNFLWeek(),
      season: "2026"
    });
    if (projections?.body) {
      const topPlayers = Object.values(projections.body)
        .slice(0, 20)
        .map(p => `${p.longName || p.playerName} (${p.pos}, ${p.team}): ${p.fantasyPoints || "N/A"} proj pts`)
        .join("\n");
      contextParts.push(`TOP FANTASY PROJECTIONS THIS WEEK:\n${topPlayers}`);
    }
  } catch (e) {
    console.log("Tank01 projections fetch failed:", e.message);
  }

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
    const adp = await fetchTank01("getNFLADP", { season: "2026" });
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

  // 5. NFL depth charts — authoritative source for current team assignments
  try {
    const depth = await fetchTank01("getNFLDepthCharts");
    if (depth?.body) {
      const rosterLines = [];
      const teams = Object.keys(depth.body).slice(0, 32);
      teams.forEach(team => {
        const positions = depth.body[team];
        if (!positions) return;
        Object.keys(positions).forEach(pos => {
          const players = positions[pos];
          if (!Array.isArray(players)) return;
          players.slice(0, 2).forEach(p => {
            if (p.longName || p.playerName) {
              rosterLines.push(`${p.longName || p.playerName} (${pos}, ${team})`);
            }
          });
        });
      });
      if (rosterLines.length > 0) {
        contextParts.push(`CURRENT NFL ROSTERS (depth charts — updated daily):\n${rosterLines.join("\n")}`);
      }
    }
  } catch (e) {
    console.log("Tank01 depth charts fetch failed:", e.message);
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

  // ── Body parsing ──────────────────────────────────────────
  // FIX (tests 57/58): treat missing/empty body as invalid JSON


  let parsed;
  try {
    parsed = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Invalid JSON body" })
    };
  }

  // FIX (tests 57/58): null/non-object body parses without throwing but is invalid
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Request body must be a JSON object" })
    };
  }

  const { model, max_tokens, system, messages } = parsed;

  if (!model || !messages || !Array.isArray(messages) || messages.length === 0) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Missing required fields: model, messages" })
    };
  }

  if (!VALID_MODELS.includes(model)) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: `Invalid model: ${model}` })
    };
  }

  try {
    // Fetch live NFL context from Tank01 (non-fatal)
    let liveDataContext = "";
    try {
      liveDataContext = await getLiveNFLContext();
    } catch (e) {
      console.log("Tank01 context fetch failed:", e.message);
    }

    // FIX (test 62): depth chart data is the single source of truth for team assignments.
    // Claude's training knowledge about player teams MUST be overridden by this live data.
    const enhancedSystem = liveDataContext
      ? `${system}\n\n═══════════════════════════════════\nLIVE NFL DATA — AUTHORITATIVE SOURCE:\n\nCRITICAL INSTRUCTION: The roster and depth chart data below is the single source of truth for all player team assignments. This data reflects trades, free agency signings, and roster moves that occurred after your training cutoff. You MUST use this data instead of your training knowledge when answering any question about which team a player is on. Never state a player's team from memory if it conflicts with the depth chart data below.\n\n${liveDataContext}\n═══════════════════════════════════\nAlways reference specific players, injury statuses, and projections from the live data above when relevant. This data is current as of today.`
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
