
const Anthropic = require("@anthropic-ai/sdk");
const { getStore, connectLambda } = require("@netlify/blobs");

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
// SPEND LOGGING (added — checklist #114)
// Reads ACTUAL billed token counts from Anthropic's own response
// (response.usage.input_tokens / output_tokens) — not an estimate —
// and appends a running daily total to Netlify Blobs. This is the
// data source for spend-dashboard.js.
//
// Pricing: Sonnet 4.6 is $3/M input tokens, $15/M output tokens as of
// this writing. If the model or its pricing ever changes, update the
// two rate constants below — this is the ONLY place cost math happens,
// so a price change is a one-line fix here, not a hunt through the file.
//
// Failure handling: logging NEVER blocks or breaks the actual chat
// response. Every Blobs call here is wrapped so a Blobs outage or
// quota issue degrades to "spend just isn't logged for this request"
// rather than "the user's question fails." The try/catch is at the
// call site in the handler, not inside this function, so a thrown
// error here is still visible in Netlify's function logs for
// debugging, while never propagating up to break the response.
// ═══════════════════════════════════════
const INPUT_RATE_PER_TOKEN = 3.00 / 1_000_000;
const OUTPUT_RATE_PER_TOKEN = 15.00 / 1_000_000;
const SPEND_STORE_NAME = "claude-spend";

// Returns "YYYY-MM-DD" in UTC. Using UTC (not local time) so the daily
// boundary is unambiguous regardless of where this function executes —
// Netlify Functions don't run in a fixed timezone, and "today" needs a
// single consistent definition for the daily total to mean anything.
function todayKeyUTC() {
  return new Date().toISOString().slice(0, 10); // e.g. "2026-06-22"
}

async function logSpend({ inputTokens, outputTokens, persona }) {
  const cost = (inputTokens * INPUT_RATE_PER_TOKEN) + (outputTokens * OUTPUT_RATE_PER_TOKEN);
  const store = getStore({ name: SPEND_STORE_NAME }); // must be called inside the handler — see #114 build notes
  const key = `daily:${todayKeyUTC()}`;

  // Read-modify-write. Netlify Blobs uses eventual consistency by
  // default (updates propagate within ~60s), which means two requests
  // landing within the same second could theoretically both read the
  // same starting value and one increment could be lost — acceptable
  // here since this is a monitoring/alerting tool, not a billing
  // ledger; being off by a few cents on a high-traffic day doesn't
  // change whether the $50 threshold was crossed in any meaningful way.
  let existing;
  try {
    existing = await store.get(key, { type: "json" });
  } catch (e) {
    existing = null;
  }

  const day = existing || { date: todayKeyUTC(), totalCost: 0, requestCount: 0, byPersona: {} };
  day.totalCost += cost;
  day.requestCount += 1;
  day.byPersona[persona] = (day.byPersona[persona] || 0) + cost;

  await store.setJSON(key, day);
}

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

  // 2. Current injury report
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

  // 3. Current ADP data
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

  // 4. NFL depth charts — authoritative source for current team assignments.
  // Resolves player team changes from free agency and trades.
  // Updated multiple times per day by Tank01.
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

  // Required for Netlify Blobs to work in this function's runtime mode
  // (Lambda compatibility mode — this file uses the classic
  // exports.handler signature rather than the newer native format).
  // Without this, getStore() throws MissingBlobsEnvironmentError even
  // in a real production deploy, not just local dev. Must be called
  // before any getStore()/logSpend() call below. See checklist #114
  // build notes — this was the actual fix after the dependency-manifest
  // fix (package.json) got the build itself passing.
  connectLambda(event);

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

    // Inject live data into the system prompt.
    // CRITICAL: Depth chart data is the single source of truth for team assignments.
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

    // ── Spend logging (added — checklist #114) ──────────────────
    // Fire-and-forget-but-awaited: we await it so any error is caught
    // by this try/catch below rather than becoming an unhandled
    // promise rejection, but a logging failure never overrides the
    // successful response already computed above. The persona name
    // is inferred from the system prompt's first ~30 chars as a cheap
    // label for the byPersona breakdown — not exact, but good enough
    // for "which persona drove today's spend" at a glance.
    try {
      const usage = response.usage || {};
      const personaLabel =
        /Oracle/i.test(system) ? "oracle" :
        /Trash Lord/i.test(system) ? "trash" :
        /Analyst/i.test(system) ? "analyst" : "unknown";
      await logSpend({
        inputTokens: usage.input_tokens || 0,
        outputTokens: usage.output_tokens || 0,
        persona: personaLabel
      });
    } catch (logErr) {
      console.log("Spend logging failed (non-fatal):", logErr.message);
    }

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
