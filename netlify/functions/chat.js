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
// Pricing: Sonnet 5 introductory pricing is $2/M input tokens, $10/M
// output tokens (confirmed against Anthropic's pricing page and
// Sonnet 5's own launch announcement, 2026-07-11). If the model or
// its pricing ever changes, update the two rate constants below —
// this is the ONLY place cost math happens, so a price change is a
// one-line fix here, not a hunt through the file.
//
// ⚠️ PRICE STEP-UP SCHEDULED: Sonnet 5's introductory pricing above
// is only valid through August 31, 2026. On September 1, 2026,
// standard pricing takes effect: $3/M input, $15/M output — a 50%
// increase on both, even though the model string and rate card
// "look" unchanged (those are the same numbers Sonnet 4.6 was priced
// at). REMINDER: update INPUT_RATE_PER_TOKEN / OUTPUT_RATE_PER_TOKEN
// below on or before Sept 1, 2026, or every dollar figure on the
// spend dashboard silently understates real cost by 50% from that
// date forward — the exact same class of staleness bug this July 11
// fix was chasing, just pointed the other direction.
//
// NOTE 2026-07-04: this rate should be revisited once #165's caching
// fix below is actually confirmed live (see cache_read_input_tokens /
// cache_creation_input_tokens in Anthropic Console usage) — cached
// input tokens bill at a different effective rate than fresh input
// tokens, and this cost model doesn't yet distinguish between them.
// Not fixed in this pass since it wasn't the bug being chased, but
// flagged so today's dollar figures don't get treated as more
// precise than they currently are once caching is genuinely active.
//
// NOTE 2026-07-11, RESOLVED SAME DAY: model was upgraded from
// claude-sonnet-4-6 to claude-sonnet-5 (see sanctum.html) to fix
// stale player-knowledge issues (checklist #122/#123). The rate
// constants below were left at Sonnet 4.6's $3/$15 rates at the time
// of that upgrade — flagged then as unverified, now corrected above.
// Real-world effect while unverified: the spend dashboard was
// OVERSTATING true cost by roughly a third (billing at $3/$15 when
// Sonnet 5 was actually being charged at $2/$10), discovered when a
// $2.62 one-day total looked concerning enough to investigate — the
// true figure for that day was closer to $1.75. The bulk of that
// day's actual spike was real call volume from manually re-running
// the new qa-fact-check.js tool ~5-6 times while debugging it (each
// run fires 8 real calls to this production endpoint, logged exactly
// like real user traffic) plus the new FULL CURRENT INJURY REPORT
// context block adding real, uncached tokens to every single call —
// not a pricing artifact. Both are expected to settle to a much
// smaller baseline once qa-fact-check.js is only running on its
// normal daily schedule instead of repeated manual triggers.
//
// Failure handling: logging NEVER blocks or breaks the actual chat
// response. Every Blobs call here is wrapped so a Blobs outage or
// quota issue degrades to "spend just isn't logged for this request"
// rather than "the user's question fails." The try/catch is at the
// call site in the handler, not inside this function, so a thrown
// error here is still visible in Netlify's function logs for
// debugging, while never propagating up to break the response.
// ═══════════════════════════════════════
const INPUT_RATE_PER_TOKEN = 2.00 / 1_000_000;
const OUTPUT_RATE_PER_TOKEN = 10.00 / 1_000_000;
const SPEND_STORE_NAME = "claude-spend";

function todayKeyUTC() {
  return new Date().toISOString().slice(0, 10);
}

async function logSpend({ inputTokens, outputTokens, persona }) {
  const cost = (inputTokens * INPUT_RATE_PER_TOKEN) + (outputTokens * OUTPUT_RATE_PER_TOKEN);
  const store = getStore({ name: SPEND_STORE_NAME });
  const key = `daily:${todayKeyUTC()}`;

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
// Remaining live chat calls are intentionally bounded and reviewed
// separately. Depth charts are NOT fetched here; chat reads the
// scheduled current-nfl-facts Blob cache instead.
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

function getCurrentNFLWeek() {
  const seasonStart = new Date("2026-09-09");
  const now = new Date();
  if (now < seasonStart) return "1";
  const diffDays = Math.floor((now - seasonStart) / (1000 * 60 * 60 * 24));
  return String(Math.max(1, Math.min(18, Math.floor(diffDays / 7) + 1)));
}

async function getLiveNFLContext() {
  const contextParts = [];

  // 1. Top NFL news headlines — bounded live provider call.
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

  // 2. Current ADP data — bounded live provider call.
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

  // 3. Player exp/injury data comes from the scheduled player-data cache.
  let playerLookup = {};
  let playerDataAge = null;
  try {
    const store = getStore({ name: "player-data" });
    const cached = await store.get("playerData", { type: "json" });
    if (cached?.players) {
      playerLookup = cached.players;
      playerDataAge = cached.updatedAt;
    }
  } catch (e) {
    console.log("Player data cache read failed:", e.message);
  }

  // 4. Depth charts come from refresh-current-nfl-facts.js's scheduled
  // current-nfl-facts/latest cache. A customer chat request therefore
  // cannot trigger getNFLDepthCharts. If the cache is unavailable,
  // this block simply degrades away exactly as the old live fetch did.
  try {
    const store = getStore({ name: "current-nfl-facts" });
    const depth = await store.get("latest", { type: "json" });

    if (depth?.teams && typeof depth.teams === "object") {
      const rosterLines = [];

      Object.entries(depth.teams).forEach(([team, positions]) => {
        if (!positions || typeof positions !== "object") return;

        Object.entries(positions).forEach(([pos, players]) => {
          if (!Array.isArray(players)) return;

          players.slice(0, 4).forEach(p => {
            if (!p || !p.longName) return;

            const extra = p.playerID ? playerLookup[p.playerID] : null;
            let tags = "";

            if (extra) {
              if (extra.exp === "R") {
                tags += ", Rookie";
              } else if (extra.exp) {
                tags += `, Yr ${extra.exp}`;
              }

              if (extra.injury?.designation) {
                tags += `, Injury: ${extra.injury.designation}${extra.injury.description ? " (" + extra.injury.description + ")" : ""}`;
              }
            }

            rosterLines.push(`${p.longName} (${pos}, ${team}${tags})`);
          });
        });
      });

      if (rosterLines.length > 0) {
        const playerAgeNote = playerDataAge
          ? ` — exp/injury data as of ${playerDataAge}`
          : "";
        const depthAgeNote = depth.generatedAt
          ? `; depth chart cache as of ${depth.generatedAt}`
          : "";

        contextParts.push(
          `CURRENT NFL ROSTERS (scheduled depth-chart cache${playerAgeNote}${depthAgeNote}):\n${rosterLines.join("\n")}`
        );
      }
    }
  } catch (e) {
    console.log("Current NFL facts cache read failed:", e.message);
  }

  // 5. Full league-wide injury report from the scheduled player cache.
  if (playerLookup && Object.keys(playerLookup).length > 0) {
    const injuryLines = [];
    Object.values(playerLookup).forEach(p => {
      const d = p.injury && p.injury.designation && p.injury.designation.trim();
      if (d && p.longName) {
        injuryLines.push(`${p.longName} (${p.pos || "?"}, ${p.team || "?"}): ${d}${p.injury.description ? " — " + p.injury.description : ""}`);
      }
    });
    if (injuryLines.length > 0) {
      contextParts.push(`FULL CURRENT INJURY REPORT (every player league-wide with a real designation, not limited to the roster list above):\n${injuryLines.join("\n")}`);
    }
  }

  return contextParts.join("\n\n");
}

exports.handler = async (event) => {
  connectLambda(event);

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS_HEADERS, body: "Method Not Allowed" };
  }

  const origin = event.headers.origin || event.headers.Origin || "";
  const originAllowed = ALLOWED_ORIGINS.includes(origin);
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

    let liveDataContext = "";
    try {
      liveDataContext = await getLiveNFLContext();
    } catch (e) {
      console.log("NFL context fetch failed:", e.message);
    }

    const systemBlocks = [
      {
        type: "text",
        text: system,
        cache_control: { type: "ephemeral" }
      }
    ];

    if (liveDataContext) {
      systemBlocks.push({
        type: "text",
        text: [
          "═══════════════════════════════════",
          "LIVE NFL DATA — AUTHORITATIVE SOURCE:",
          "",
          "CRITICAL INSTRUCTION: The data below (news, ADP, depth charts, and a full league-wide injury report) is the single source of truth for CURRENT player status — team assignments, and, where shown, experience level and injury status. It reflects trades, free agency moves, roster changes, and injury designations that happened after your training cutoff. Defer to this data over your training knowledge whenever relevant. Specifically: (1) TEAM: never state a player's team from memory if it conflicts with the roster line below. (2) EXPERIENCE: each player line in the roster list may include a tag like ', Rookie' or ', Yr 4' — that tag is the real current answer for whether they're a rookie or how many seasons they've played. A player you remember as an incoming draft prospect may now show 'Yr 2' or higher — trust the tag, not your training-data memory of their draft class. The roster list only covers a limited slice of each team (top players per position) — if a player isn't listed there, you don't have current experience info for them and shouldn't state it from memory either. (3) INJURY — TWO SEPARATE SOURCES: the roster list's inline ', Injury: ...' tags cover only the players listed there. The FULL CURRENT INJURY REPORT section (when present) is DIFFERENT and covers the entire league, not just listed players — treat it as the complete, authoritative injury list. If a player appears in the FULL CURRENT INJURY REPORT, state that exact designation. If a player does NOT appear there, that means no current injury designation exists for them league-wide — you can state they have no reported injury concern with confidence, even if they're not in the roster list above. NEVER FABRICATE AN INJURY FOR ANY PLAYER — including players you mention only in passing or as context for someone else, not just the player the question is directly about; if a name isn't in the FULL CURRENT INJURY REPORT, don't invent or imply an injury for them. CRITICAL — DO NOT DENY A PLAYER'S EXISTENCE: never state or imply that a player is not on a roster, not real, not in your data, or that the user has the wrong name or team, just because they're absent from the roster list — that absence is a coverage gap in that specific list, not evidence the player doesn't exist. If you don't recognize a name or can't find them in the roster list, say plainly that you don't have current team/experience information on that specific player and STOP THERE — do not pair that statement with a team name in the same sentence (e.g. never say anything shaped like 'no record of him on [Team]'s roster' — naming a team right next to an absence-of-data statement functions as a denial that he plays there, even when wrapped in hedging language or mystical phrasing; this exact pattern is what has caused this failure before). Then answer what you can in general terms without naming any team for that player. This does not apply to injury status, which is now fully covered by the FULL CURRENT INJURY REPORT per point (3).",
          "",
          liveDataContext,
          "═══════════════════════════════════",
          "Always reference specific players, injury statuses, and projections from the live data above when relevant. This data is current as of today."
        ].join("\n")
      });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model,
      max_tokens,
      system: systemBlocks,
      messages
    });

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
