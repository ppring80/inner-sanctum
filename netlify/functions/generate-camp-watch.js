const { connectLambda, getStore } = require("@netlify/blobs");

// ═══════════════════════════════════════
// CAMP WATCH AUTO-GENERATOR
// See file history/commits for full original rationale comments.
// CARD FORMAT (updated 2026-08-06): Oracle + Trash Lord takes are now
// paired together under one dispatch object per story (oracle/trashLord
// keys) instead of being written as two separate dispatch entries, to
// power a combined tabbed card in dispatches.html.
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

  for (const story of stories) {
    try {
      const takes = await generateTakes(story);
      dispatches.push({
        type: "camp",
        dateLabel: "Camp · Live",
        subject: story.player,
        sourceLink: story.link,
        oracle: {
          title: takes.oracle.title,
          excerpt: takes.oracle.excerpt,
          full: takes.oracle.full
        },
        trashLord: {
          title: takes.trashLord.title,
          excerpt: takes.trashLord.excerpt,
          full: takes.trashLord.full
        }
      });
    } catch (e) {
      storiesFailed++;
      console.log(`Take generation failed for "${story.player}":`, e.message);
    }
  }

  if (dispatches.length === 0) {
    console.log("Camp Watch generation aborted — all take-generation calls failed, keeping existing cache");
    return { statusCode: 500 };
  }

  const store = getStore({ name: "camp-watch" });
  await store.setJSON("dispatches", {
    updatedAt: new Date().toISOString(),
    storiesUsed: stories.length,
    storiesFailed,
    dispatches
  });

  console.log(
    `Camp Watch generation complete: ${dispatches.length} dispatches from ${stories.length} stories` +
    (storiesFailed > 0 ? ` (${storiesFailed} story/stories failed — see logs above)` : "")
  );

  return { statusCode: 200 };
};
