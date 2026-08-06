const { connectLambda, getStore } = require("@netlify/blobs");

// ═══════════════════════════════════════
// CAMP WATCH AUTO-GENERATOR
//
// WHY THIS FILE EXISTS: Dispatches' Camp Watch section was originally
// hand-written HTML with hardcoded storylines and a "Jul 2026" date —
// accurate when written, but with no mechanism to refresh, it read as
// stale (and misleadingly so, since the page copy calls it "live").
// This function replaces that hardcoded content with a real pipeline:
// live news in, AI-generated Oracle + Trash Lord takes out, cached for
// the site to serve.
//
// PATTERN: mirrors refresh-player-data.js exactly — same Tank01 host,
// same connectLambda/getStore Blobs pattern, same @daily-style
// scheduling via netlify.toml (NOT inline config.schedule — see that
// file's comments for why). This one is scheduled TWICE a day instead
// of once; see netlify.toml for both cron entries.
//
//   [functions."generate-camp-watch"]
//     schedule = "0 13,23 * * *"
//
// That fires at 13:00 and 23:00 UTC — roughly 9am and 7pm US Eastern
// (8am/6pm Central) during EDT. Adjust the hours in netlify.toml if a
// different local time is wanted; DST shifts this by an hour each way
// and isn't worth chasing with cron alone.
//
// DATA SOURCE: Tank01's /getNFLNews endpoint, called with
// fantasyNews=true (pre-filtered to fantasy-relevant stories, not
// general NFL news) and maxItems=20. Confirmed via live test (2026-08-05)
// that this returns real, dated, reporter-attributed headlines — e.g.
// "Diggs is slated to sign a one-year, $12 million contract with the
// Commanders, John Keim of ESPN.com reports." Exactly the raw material
// Oracle/Trash Lord dispatches need.
//
// SELECTION LOGIC: takes the top MAX_STORIES unique-player headlines
// from the 20 returned, in the order Tank01 returns them (their own
// docs describe this feed as updated multiple times an hour, so
// earlier-in-list is treated as more current — not re-sorted here).
// Deduped by player name so e.g. two headlines about the same practice
// absence don't both get picked. This is deliberately simple rather
// than a scored-relevance model — Tank01's fantasyNews=true filter is
// already doing the relevance filtering; re-scoring on top of that is
// unlikely to outperform it and is one more thing to get wrong.
//
// REPLACE, NOT APPEND: each run's output fully REPLACES the cached
// dispatches rather than accumulating alongside old ones. Camp Watch
// is meant to show "what's true right now," not a growing archive —
// an injury designation from three days ago that's since resolved
// has no business still showing as current. If a history/archive view
// is ever wanted, that's a separate, deliberate feature — not a side
// effect of this function forgetting to delete old entries.
//
// FAILURE HANDLING: if Tank01 or Anthropic fails partway through, this
// intentionally does NOT overwrite the existing cache with an empty or
// partial result — stale-but-real content beats a blank section. The
// store is only updated once a full, successful batch is ready.
//
// CARD FORMAT (updated 2026-08-06): each story's Oracle and Trash Lord
// takes are now stored TOGETHER under one dispatch object, rather than
// as two separate dispatch entries. This powers dispatches.html's
// tabbed-card UI — one card per story, with a small voice toggle
// switching between the two takes, instead of two full cards showing
// back-to-back for the same underlying story. Decided after user
// feedback that eight separate cards (four stories × two voices) felt
// like visual clutter; the two voices are still both fully present,
// just paired under one card instead of split into two.
// ═══════════════════════════════════════

const MAX_STORIES = 4;

async function fetchTank01News() {
  const baseUrl = "https://tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";
  const url = `${baseUrl}/getNFLNews?fantasyNews=true&maxItems=20`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-rapidapi-host": "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com",
      "x-rapidapi-key": process.env.TANK01_API_KEY
    }
  });

  if (!response.ok) throw new Error(`Tank01 News API error: ${response.status}`);
  const data = await response.json();
  return Array.isArray(data?.body) ? data.body : [];
}

// Tank01's news titles are formatted "PlayerName: rest of the headline..."
// Pull the player name out so we can dedupe by it.
function extractPlayerName(title) {
  const match = /^([^:]+):/.exec(title || "");
  return match ? match[1].trim() : null;
}

function pickTopStories(newsItems, max) {
  const seen = new Set();
  const picked = [];

  for (const item of newsItems) {
    const player = extractPlayerName(item.title);
    if (!player || seen.has(player.toLowerCase())) continue;
    seen.add(player.toLowerCase());
    picked.push({ player, headline: item.title, link: item.link });
    if (picked.length >= max) break;
  }

  return picked;
}

// Calls Anthropic to generate BOTH the Oracle's and Trash Lord's take
// on a single real headline, in one call (cheaper and simpler than two
// separate requests per story). Returns the two takes the front end
// expects, matching the shape of the original hand-written cards in
// dispatches.html (title / excerpt / full paragraphs).
async function generateTakes(story) {
  const prompt = `You are writing two short fantasy football "Camp Watch" dispatches for The Inner Sanctum, based on this real, dated news item:

"${story.headline}"

Write TWO takes on this story, in these exact voices:

1. THE ORACLE — mystical, measured, speaks in prophetic/archaic tone. Addresses the reader as "seeker." Never overhypes; always tempers excitement with a note of patience or watchfulness. Signs off with a short closing line like "The Oracle watches. The Oracle waits."

2. THE TRASH LORD — blunt, high-energy, modern internet trash-talk voice. Uses phrases like "Yo," ALL CAPS for emphasis, and closes with a punchy one-liner (e.g. "Don't @ me when...").

Both takes must be grounded ONLY in the facts of the headline above — do not invent stats, quotes, or details not present in it. If the headline is thin on detail, write a shorter take rather than padding with invented specifics.

Return ONLY valid JSON, no markdown fences, no preamble, in exactly this shape:
{
  "oracle": {
    "title": "The Oracle's Camp Watch — <short subject, e.g. player or team + topic>",
    "excerpt": "<one sentence teaser, under 20 words>",
    "full": ["<paragraph 1>", "<paragraph 2>", "<short closing line>"]
  },
  "trashLord": {
    "title": "Trash Lord's Reality Check — <same short subject>",
    "excerpt": "<one sentence teaser, under 20 words>",
    "full": ["<paragraph 1>", "<paragraph 2>", "<short closing line>"]
  }
}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!response.ok) throw new Error(`Anthropic API error: ${response.status}`);
  const data = await response.json();
  const text = data?.content?.[0]?.text || "";

  // Defensive parse: strip markdown fences if the model adds them
  // despite instructions not to, rather than letting a whole run fail
  // over a formatting slip.
  const cleaned = text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

exports.handler = async (event) => {
  connectLambda(event);

  let newsItems;
  try {
    newsItems = await fetchTank01News();
  } catch (e) {
    console.log("Camp Watch generation aborted — Tank01 fetch failed:", e.message);
    return { statusCode: 500 };
  }

  const stories = pickTopStories(newsItems, MAX_STORIES);

  if (stories.length === 0) {
    console.log("Camp Watch generation aborted — no usable stories in Tank01 response");
    return { statusCode: 500 };
  }

  const dispatches = [];
  let storiesFailed = 0;

  // Sequential, not parallel: each call is a real Anthropic generation
  // (not a
