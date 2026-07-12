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
// NOTE 2026-07-04: this rate should be revisited once #165's caching
// fix below is actually confirmed live (see cache_read_input_tokens /
// cache_creation_input_tokens in Anthropic Console usage) — cached
// input tokens bill at a different effective rate than fresh input
// tokens, and this cost model doesn't yet distinguish between them.
// Not fixed in this pass since it wasn't the bug being chased, but
// flagged so today's dollar figures don't get treated as more
// precise than they currently are once caching is genuinely active.
//
// NOTE 2026-07-11: model was upgraded from claude-sonnet-4-6 to
// claude-sonnet-5 (see sanctum.html) to fix stale player-knowledge
// issues (#215/checklist). Sonnet 5 has different per-token pricing
// than Sonnet 4.6 — the two rate constants below have NOT yet been
// re-verified against Sonnet 5's actual current rate as part of this
// pass. Re-check Anthropic's pricing page before trusting spend
// dashboard dollar figures as precise going forward; today's fix was
// scoped to the staleness bug only.
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

  // 2. Injury data — no standalone endpoint. REMOVED 2026-07-11
  // (checklist #215) after confirming via RapidAPI's live endpoint
  // list and 365-day changelog that Tank01's NFL API has no
  // getNFLInjuries-style endpoint (unlike their MLB API's
  // getMLBInjuriesByDate) — the original call here was 404ing
  // silently on every request since this was built.
  //
  // UPDATE, same day: injury data does exist after all — it's bundled
  // per-player inside getNFLTeamRoster responses (see item 4 below),
  // not in a standalone endpoint. Real injury status is restored via
  // that route as of tonight.

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

  // 4. Player exp/injury lookup — reads the cache built by the
  // refresh-player-data scheduled function (see that file). That
  // function calls getNFLTeamRoster once per team (32 calls, done on
  // a schedule) rather than this doing it live on every chat message,
  // which would add several seconds of latency and burn through the
  // daily API budget fast.
  //
  // ADDED 2026-07-11 (checklist #215, resolves last night's open
  // item): confirmed via live diagnostic that getNFLTeamRoster
  // returns "exp" ("R" for rookie, a number string like "4" for
  // veterans) and a nested "injury" object per player — the exact
  // data missing when the depth chart fix landed earlier tonight,
  // and the actual fix for the Hampton/Skattebo/Dart/McMillan
  // rookie-mislabel bug. This also restores real injury status, which
  // was removed entirely last night after concluding (correctly, for
  // a standalone injuries endpoint; incorrectly, as it turns out, for
  // per-player injury data bundled into roster responses) that
  // Tank01's NFL API had no injury data at all.
  //
  // If the cache is missing (e.g. before the scheduled function's
  // first run) or unreadable, this fails non-fatally — the roster
  // lines below just won't have exp/injury detail, same fallback
  // behavior as every other Tank01 source in this function.
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

  // 5. NFL depth charts — authoritative source for current team
  // assignments AND (as of tonight) rookie/vet status and injury
  // status, merged in per player from the cache built above.
  // Resolves player team changes from free agency and trades.
  // Depth charts themselves are updated multiple times per day by
  // Tank01; the exp/injury overlay refreshes on the schedule set in
  // netlify.toml for refresh-player-data (see that file).
  //
  // FIXED 2026-07-11 (checklist #215, real root cause): this parser
  // was written assuming depth.body was an OBJECT keyed directly by
  // team, e.g. depth.body["ARI"].QB = [...]. Pat found via RapidAPI's
  // live response inspector that the actual shape is completely
  // different: depth.body is an ARRAY of 32 team objects, each with
  // { depthChart: { QB: [...], RB: [...], ... }, teamAbv: "ARI",
  // teamID: "1" } — the position arrays are nested ONE LEVEL DEEPER,
  // inside depthChart, not directly on the team object. The old code's
  // own safety check (Array.isArray(players)) silently skipped
  // everything every single time, since at the level it was actually
  // reading, it never found a real array — meaning depth chart data
  // has likely NEVER once reached the model since this was built. This
  // is almost certainly the true root cause of the stale
  // rookie-status/team-assignment bug Pat found (Jaxson Dart called a
  // rookie, Aaron Rodgers still shown on the Jets), not the earlier
  // slice-width or instruction-wording theories — those were real
  // improvements but were never the actual blocker.
  try {
    const depth = await fetchTank01("getNFLDepthCharts");
    if (Array.isArray(depth?.body)) {
      const rosterLines = [];
      depth.body.forEach(teamEntry => {
        const team = teamEntry.teamAbv || teamEntry.teamID || "UNK";
        const positions = teamEntry.depthChart;
        if (!positions) return;
        Object.keys(positions).forEach(pos => {
          const players = positions[pos];
          if (!Array.isArray(players)) return;
          players.slice(0, 4).forEach(p => {
            if (!p.longName) return;
            const extra = playerLookup[p.playerID];
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
        const ageNote = playerDataAge ? ` — exp/injury data as of ${playerDataAge}` : "";
        contextParts.push(`CURRENT NFL ROSTERS (depth charts updated daily${ageNote}):\n${rosterLines.join("\n")}`);
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
  // FIXED (July 2026 #49 site review): this previously used
  // `ALLOWED_ORIGINS.some(o => origin.startsWith(o))`, which is a
  // substring-prefix check, not an exact-match check. That meant a
  // lookalike domain like https://theinnersanctum.xyz.evil-domain.com
  // would also pass — its origin string literally starts with
  // "https://theinnersanctum.xyz", even though it's a completely
  // different, attacker-controlled site. Anyone hosting a page at
  // such a domain could call this function directly, generating real
  // Anthropic API spend on this account, bypassing the client-side
  // question-limit logic entirely (that logic lives in sanctum.html's
  // JS, not here — this endpoint had no other gate). Switched to an
  // exact match against the ALLOWED_ORIGINS list, confirmed clean in
  // Netlify (no trailing slash, no stray whitespace) as of this fix.
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

    // Fetch live NFL context from Tank01 (non-fatal)
    let liveDataContext = "";
    try {
      liveDataContext = await getLiveNFLContext();
    } catch (e) {
      console.log("Tank01 context fetch failed:", e.message);
    }

    // ── Build system prompt as content blocks for prompt caching ──────────
    // FIXED 2026-07-04 (checklist #165, re-fixed — see #188): this
    // caching structure was originally believed shipped 2026-06-30, but
    // Anthropic Console confirmed "Prompt caching: Not enabled" / "—
    // tokens reused" on this account, meaning it was NEVER actually live
    // in this file. Root cause: the June 30 edit was accidentally made
    // to a stray duplicate chat.js sitting at the repo ROOT (outside
    // netlify/functions/, so Netlify never deploys or runs it) instead
    // of this real, deployed file — this file still had the old
    // single-string `enhancedSystem` approach with no cache_control at
    // all. Root-level duplicate has been deleted (see #188) to prevent
    // this exact confusion from recurring.
    //
    // Block 1 (CACHED): the static persona system prompt passed in from
    // the frontend. This never changes between requests for the same
    // persona, so Anthropic caches it after the first call and bills
    // subsequent requests at ~10% of normal input token cost.
    // cache_control: ephemeral gives a 5-minute TTL that resets on
    // every hit — in practice, active sessions keep this cached
    // continuously.
    //
    // Block 2 (NOT CACHED): live Tank01 data — different every call
    // since it reflects current news, ADP, and depth charts.
    // Caching this would defeat the purpose of fetching it live.
    //
    // If Tank01 returned nothing, we send only the cached block (no
    // empty second block) to avoid sending a content block with an
    // empty string.
    //
    // BROADENED 2026-07-11, REVISED SAME DAY (checklist #215 — stale
    // player-knowledge fix, two passes):
    //
    // Pass 1 (earlier tonight): the CRITICAL INSTRUCTION only told the
    // model to defer to live data for TEAM ASSIGNMENTS, and told it to
    // hedge on experience/injury since no data source existed for
    // either. In testing, this reduced but didn't eliminate the
    // problem — Trash Lord still called 2025-draft-class players
    // "rookies" in Week 1 2026 (Hampton, Skattebo, Dart, McMillan),
    // since an instruction to hedge competes against the model's own
    // strongly-held training-data belief and doesn't reliably win.
    //
    // Pass 2 (this revision): discovered getNFLTeamRoster actually
    // returns real exp/injury data per player (see item 4 in
    // getLiveNFLContext). The instruction no longer just tells the
    // model to hedge — it points to real per-player tags ("Rookie",
    // "Yr 4", "Injury: Questionable") now present in the roster lines
    // themselves, which is a much stronger override than an
    // instruction alone. Hedging language is kept ONLY for players who
    // don't appear in the live data at all, where it's still true that
    // no current info exists. Background details Tank01 doesn't supply
    // at all (e.g. exact games-started counts) remain subject to the
    // model's own knowledge and judgment.
    // ───────────────────────────────────────────────────────────────

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
          "CRITICAL INSTRUCTION: The data below (news, ADP, and depth charts) is the single source of truth for CURRENT player status — team assignments, and, where shown, experience level and injury status. It reflects trades, free agency moves, roster changes, and injury designations that happened after your training cutoff. Defer to this data over your training knowledge whenever relevant. Specifically: (1) TEAM: never state a player's team from memory if it conflicts with the roster line below. (2) EXPERIENCE: each player line may include a tag like ', Rookie' or ', Yr 4' — that tag is the real current answer for whether they're a rookie or how many seasons they've played. A player you remember as an incoming draft prospect may now show 'Yr 2' or higher — trust the tag, not your training-data memory of their draft class. (3) INJURY: each player line may include a tag like ', Injury: Questionable (ankle)' — that is their real current designation. If a player's line below has NO injury tag, treat that as them currently having no reported injury designation, not as 'unknown' — this data is refreshed daily. ABSENCE FROM THE LIST ENTIRELY IS DIFFERENT FROM ABSENCE OF A TAG: the roster list below only includes a limited slice of each team (top players per position), not every player in the league — bench, depth, and practice-squad players will routinely be missing from it even though they are real, currently rostered NFL players. If a player is NOT mentioned ANYWHERE in the live data below, you don't have current team/experience/injury info for them at all from this data — don't state any of those three from training-data memory either, since it could easily be outdated; keep your answer more general instead. CRITICAL — DO NOT DENY A PLAYER'S EXISTENCE: never state or imply that a player is not on a roster, not real, not in your data, or that the user has the wrong name or team, just because they're absent from this limited list — that absence is a coverage gap in THIS data pull, not evidence the player doesn't exist. If you don't recognize a name or can't find them below, say plainly that you don't have current information on that specific player and answer what you can in general terms — never frame missing data as the player being unreal or misidentified. But if a player IS listed and simply has no injury tag, that absence does mean healthy/no designation, per point (3) above.",
          "",
          liveDataContext,
          "═══════════════════════════════════",
          "Always reference specific players, injury statuses, and projections from the live data above when relevant. This data is current as of today."
        ].join("\n")
      });
    }

    // Call Claude API
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model,
      max_tokens,
      system: systemBlocks,
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
