const Anthropic = require("@anthropic-ai/sdk");
const { connectLambda, getStore } = require("@netlify/blobs");

// ═══════════════════════════════════════
// AUTOMATED FACT-CHECK — follow-up to checklist #122/#123
//
// PURPOSE: replace "did Pat happen to ask about the right player" with
// a repeatable, automated test. Every run:
//   1. Samples real players from the SAME ground-truth cache chat.js
//      reads from (built by refresh-player-data.js) — stratified
//      across the categories that actually caused tonight's bug:
//      true rookies, 2nd/3rd-year players, players with a real
//      current injury designation, and healthy veterans.
//   2. Asks a REAL persona a REAL question about each sampled player,
//      via the ACTUAL deployed /.netlify/functions/chat endpoint —
//      not a reimplementation of its logic, so this tests what's
//      genuinely live in production.
//   3. Sends the response to a second, cheap Claude call acting as a
//      judge, which compares it against ground truth and returns a
//      structured PASS/FAIL with reasoning.
//   4. Logs results to Netlify Blobs (same store pattern as spend
//      logging / player-data caching) so a regression shows up as a
//      pass-rate number dropping, not a customer complaint.
//
// WHY A JUDGE MODEL, NOT KEYWORD MATCHING: tonight's actual review
// (checklist #123) included a case where Trash Lord said "rookie-
// mistake turnovers" about a player correctly labeled "Yr 2" one
// sentence earlier — that's a football idiom about turnover risk, not
// a false claim about experience level, and a naive keyword check for
// the word "rookie" would have wrongly flagged it. The judge prompt
// below is written to make that same distinction automatically. This
// is inherently judgment-based, so treat a FAIL as "worth a human
// look," not an infallible verdict — same as any QA signal.
//
// ═══════════════════════════════════════
// MAINTENANCE WARNING — READ BEFORE EDITING PERSONA PROMPTS IN
// sanctum.html:
//
// The three PERSONAS strings below are copied VERBATIM from
// sanctum.html as of 2026-07-11. They are NOT imported from a shared
// source — sanctum.html embeds them directly in inline client-side
// JS, so there is currently no single source of truth between the two
// files. If a persona prompt is ever edited in sanctum.html, THIS
// FILE'S COPY GOES STALE SILENTLY and this test starts validating
// against a prompt that isn't actually live anymore — which could
// mask a real regression or, worse, fail a real player check against
// an outdated rule the live prompt no longer even has. Whoever edits
// a persona prompt in sanctum.html should update the matching entry
// below in the SAME change.
//
// FOLLOW-UP WORTH DOING: extract the three prompts into one shared
// JSON/JS file that both sanctum.html and this function import from,
// so this class of drift becomes structurally impossible instead of
// relying on whoever's editing to remember. Not done here to keep
// this change scoped to building the testing tool itself.
// ═══════════════════════════════════════

const PERSONAS = {
  oracle: "You are The Oracle, a wise fantasy football sage with 38 years of experience. Speak with gravitas and mystical authority, but stay disciplined — a true Oracle speaks in concise prophecy, not lengthy sermons. Give concrete fantasy football advice first; mystical framing should season the advice, not bury it. Use at most one legend reference (Jerry Rice, Barry Sanders, Emmitt Smith) or one poetic flourish per response, never both. Respond in 2-3 sentences, no more than 50 words total. If your answer genuinely depends on missing information (like league format), give your best general read first, then ask the one clarifying question that would sharpen it — don't ask without answering. NEVER recommend external sites like FantasyPros, ESPN, NFL.com, or Underdog for rankings, ADP, or draft prep — this platform's own Draft Cheat Sheet and Tier List already cover that; point seekers there by name instead. CRITICAL: Never show your thinking process, research steps, or internal reasoning. Deliver only your final answer directly, as if the wisdom flows naturally from you.",
  trash: "You are The Trash Lord — the resident league villain of The Inner Sanctum, the guy who's been in your group chat since 2019 talking way too much smack for someone who finished 9th in points-for last year. You didn't get good at fantasy football; you got GREAT at making fun of people who are bad at it, which turns out to be the more marketable skill. Your comedic instinct: you roast the DECISION, never the person — nothing about intelligence, appearance, or life outside football, just brutally honest reads on lineup choices, panic trades, and waiver-wire cowardice. You love a callback ('that guy who benched a top-5 back for a bye-week fill-in' energy), you treat mediocre rosters like condemned buildings, and you have zero patience for excuses — 'my kicker let me down' is not a defense, it's a confession. You're loud and a little unhinged, but never cruel — a great roast makes the whole room laugh, including the person getting roasted, once they stop being mad about it. EXAMPLE VOICE (tone reference only, never reuse these lines verbatim): 'Starting a rookie WR over a proven vet in Week 1 is the kind of confidence that gets people voted off the island. Bold. Wrong, but bold.' / 'You're 2-6 and still talking about your sleeper picks like this is a heist movie and not a crime scene.' Be snarky, hilarious, and savage but never truly mean or offensive. Use ALL CAPS for emphasis on key points. Give real, accurate fantasy advice wrapped in trash talk. HARD LIMIT: maximum 100 words total, no fixed sentence count — let the roast breathe across as many sentences as it needs to land, but never pad past 100 words just to fill space, even for the offseason disclaimer or a roast. Every sentence should earn its place; if the joke landed in 2 sentences, stop at 2 — don't add a third just because you have room. CRITICAL RULE: NEVER fabricate stats, injury reports, game results, or rankings. If you do not have real verified data, roast the situation or the offseason in ONE short line instead — never invent numbers or facts. NEVER recommend external sites like FantasyPros, ESPN, NFL.com, or Underdog for rankings, ADP, or draft prep — that's an insult to this platform, which already has a Draft Cheat Sheet and Tier List built for exactly that; clown the user into using those instead. CRITICAL: Never show your thinking process, research steps, or internal reasoning. Deliver only your final savage answer directly.",
  analyst: "You are The Analyst, a cold and precise fantasy football data expert. Speak ONLY in stats, numbers, percentages, matchup data, snap counts, target shares, and analytics. No mysticism. No trash talk. No fluff. Just cold hard data and actionable conclusions. Respond in 2-3 sentences, no more than 50 words total — no bolded headers, no bullet lists, no multi-section structure, just dense plain-text data delivered in flowing sentences. CRITICAL RULE: NEVER fabricate stats, projections, or data points. If real data is not available, say so in one short sentence and stop there — do not substitute a long historical breakdown. NEVER recommend external sites like FantasyPros, ESPN, NFL.com, or Underdog for rankings, ADP, or draft prep — this platform's own Draft Cheat Sheet and Tier List already provide that data; cite those by name instead. CRITICAL: Never show your thinking process, search steps, or internal reasoning. Deliver only your final data-driven conclusion directly."
};
const PERSONA_NAMES = Object.keys(PERSONAS);

// Real production URL, required as the Origin header below (see note
// at the fetch call — chat.js's origin allowlist check requires it).
const SITE_URL = "https://theinnersanctum.xyz";

// Samples per category. Kept small deliberately: each sample costs
// one real chat.js call (~$0.004-0.02 depending on persona, per
// checklist #114's measured per-question cost) plus one cheap Haiku
// judge call (~$0.001). At 2/category x 4 categories = 8 samples/day,
// this runs for well under $0.25/day — trivial against the $50/day
// spend-dashboard threshold. Raise SAMPLES_PER_CATEGORY if broader
// daily coverage becomes worth the extra spend.
const SAMPLES_PER_CATEGORY = 2;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Splits the cached player pool into the categories that matter for
// this test — mirrors the exact bug classes found in checklist
// #122/#123 (rookie mislabeling, and injury status accuracy).
function buildCategories(players) {
  const categories = { rookie: [], secondOrThirdYear: [], injured: [], healthyVeteran: [] };
  Object.keys(players).forEach(id => {
    const p = players[id];
    if (!p.longName || !p.team || !p.pos) return; // defensive — skip incomplete cache entries
    const hasInjury = p.injury && p.injury.designation && p.injury.designation.trim().length > 0;
    if (p.exp === "R") {
      categories.rookie.push(id);
    } else if (p.exp === "2" || p.exp === "3") {
      categories.secondOrThirdYear.push(id);
    }
    if (hasInjury) {
      categories.injured.push(id);
    } else if (p.exp && p.exp !== "R" && parseInt(p.exp, 10) >= 4) {
      categories.healthyVeteran.push(id);
    }
  });
  return categories;
}

function buildQuestion(category, player) {
  const who = `${player.longName}, the ${player.team} ${player.pos}`;
  switch (category) {
    case "rookie":
    case "secondOrThirdYear":
      return `What's your read on ${who}? How much NFL experience does he actually have at this point?`;
    case "injured":
      return `Give me an update on ${who} — any injury concerns I should know about?`;
    case "healthyVeteran":
      return `What's your take on ${who} heading into this week?`;
    default:
      return `What's your read on ${who}?`;
  }
}

function groundTruthText(player) {
  const expText = player.exp === "R" ? "Rookie (0 prior NFL seasons)" : `${player.exp} years of NFL experience (not a rookie)`;
  const injuryText = (player.injury && player.injury.designation && player.injury.designation.trim())
    ? `Injury designation: ${player.injury.designation}${player.injury.description ? " — " + player.injury.description : ""}`
    : "No current injury designation (healthy per latest data)";
  return `Player: ${player.longName} | Team: ${player.team} | Position: ${player.pos} | Experience: ${expText} | ${injuryText}`;
}

// Calls the REAL deployed chat endpoint — same request shape
// sanctum.html's ask() sends (system as a plain string, not blocks;
// chat.js wraps it into cached content blocks server-side).
async function callChatEndpoint(persona, question) {
  const response = await fetch(`${SITE_URL}/.netlify/functions/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // REQUIRED: chat.js's origin allowlist (see its own "Origin
      // check" comment) rejects any request whose Origin header
      // doesn't exactly match https://theinnersanctum.xyz. A
      // server-to-server fetch like this one doesn't send an Origin
      // header automatically the way a browser does, so it must be
      // set explicitly here or every request gets a 403.
      "Origin": SITE_URL
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 1000,
      system: PERSONAS[persona],
      messages: [{ role: "user", content: question }]
    })
  });
  if (!response.ok) throw new Error(`chat endpoint returned ${response.status}`);
  const data = await response.json();
  const text = data?.content?.[0]?.text;
  if (!text) throw new Error("chat endpoint returned no text content");
  return text;
}

// Second Claude call acting as judge. Deliberately NOT keyword
// matching — see the file-level comment above for why (the "rookie-
// mistake turnovers" idiom case from tonight's manual review).
async function judgeResponse(client, groundTruth, personaName, question, responseText) {
  const judgePrompt = [
    "You are fact-checking a fantasy football AI persona's response against verified ground-truth player data.",
    "",
    `GROUND TRUTH: ${groundTruth}`,
    `PERSONA: ${personaName}`,
    `QUESTION ASKED: ${question}`,
    `PERSONA'S RESPONSE: "${responseText}"`,
    "",
    "Judge whether the response is factually consistent with the ground truth on team, experience level, and injury status.",
    "IMPORTANT DISTINCTION: only flag a FACTUAL CLAIM as wrong — e.g. stating a player IS a rookie/first-year when ground truth says otherwise, stating a team that conflicts with ground truth, or claiming a specific current injury that isn't in the ground truth (or missing one that is). Do NOT flag stylistic idioms or figures of speech (e.g. calling a turnover a 'rookie mistake' as a common football expression about a costly error, not a literal claim about the player's experience level) — judge intent, not keyword presence.",
    "If the response doesn't mention the specific fact at all (e.g. never brings up experience level), that is NOT a failure — silence isn't a false claim.",
    "",
    "Respond with ONLY a JSON object, no other text, no markdown fences:",
    '{"pass": true or false, "teamCorrect": true, "experienceCorrect": true, "injuryCorrect": true, "reasoning": "one or two sentence explanation"}'
  ].join("\n");

  const judgeResp = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    messages: [{ role: "user", content: judgePrompt }]
  });
  const raw = judgeResp.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
  try {
    const cleaned = raw.replace(/^```json\s*|\s*```$/g, "");
    return JSON.parse(cleaned);
  } catch (e) {
    return { pass: null, reasoning: `Judge response unparseable: ${raw.slice(0, 200)}`, parseError: true };
  }
}

exports.handler = async (event) => {
  connectLambda(event);

  let playerDataCache = null;
  try {
    const store = getStore({ name: "player-data" });
    playerDataCache = await store.get("playerData", { type: "json" });
  } catch (e) {
    console.log("Could not read player-data cache:", e.message);
  }

  if (!playerDataCache?.players) {
    console.log("QA fact-check aborted: no player-data cache available (has refresh-player-data.js run yet?)");
    return { statusCode: 500 };
  }

  const categories = buildCategories(playerDataCache.players);
  const samples = [];
  Object.keys(categories).forEach(cat => {
    const picks = shuffle(categories[cat].slice()).slice(0, SAMPLES_PER_CATEGORY);
    picks.forEach(id => samples.push({ category: cat, player: playerDataCache.players[id] }));
  });

  if (samples.length === 0) {
    console.log("QA fact-check: no eligible players found in any category — cache may be empty or too sparse (common in deep offseason for injury data).");
    return { statusCode: 200 };
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // PARALLELIZED — first live run of this function measured 42.9s
  // with a sequential for-loop (8 samples x ~5s each: one chat.js
  // call + one judge call per sample). That's well past the 30s hard
  // limit scheduled functions have (see refresh-player-data.js's own
  // comment on this same constraint) — it happened to succeed when
  // triggered manually via "Run now" in this test, but there's no
  // guarantee a real scheduled invocation gets the same leniency, and
  // this was the exact mistake refresh-player-data.js was deliberately
  // written to avoid. Fixed the same way: Promise.allSettled runs
  // every sample's full pipeline (chat call + judge call) concurrently
  // instead of one at a time — network-bound work, not CPU-bound, so
  // wall time should now track the slowest single sample rather than
  // the sum of all of them.
  async function runSample(sample, persona) {
    const { category, player } = sample;
    const question = buildQuestion(category, player);
    const groundTruth = groundTruthText(player);
    try {
      const responseText = await callChatEndpoint(persona, question);
      const verdict = await judgeResponse(client, groundTruth, persona, question, responseText);
      return {
        playerID: player.playerID, name: player.longName, category, persona,
        question, groundTruth, response: responseText, verdict
      };
    } catch (e) {
      return {
        playerID: player.playerID, name: player.longName, category, persona,
        question, groundTruth, response: null,
        verdict: { pass: null, reasoning: `Test run failed: ${e.message}`, runError: true }
      };
    }
  }

  const settled = await Promise.allSettled(
    samples.map((sample, i) => runSample(sample, PERSONA_NAMES[i % PERSONA_NAMES.length]))
  );
  // Every branch inside runSample() already catches its own errors and
  // returns a normal result object, so a rejection here would mean
  // something outside that (unexpected) — still handle it defensively
  // rather than letting one bad promise drop a whole sample silently.
  const results = settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    const { category, player } = samples[i];
    return {
      playerID: player.playerID, name: player.longName, category,
      persona: PERSONA_NAMES[i % PERSONA_NAMES.length],
      question: buildQuestion(category, player), groundTruth: groundTruthText(player),
      response: null,
      verdict: { pass: null, reasoning: `Unexpected rejection: ${s.reason?.message}`, runError: true }
    };
  });

  const passCount = results.filter(r => r.verdict.pass === true).length;
  const failCount = results.filter(r => r.verdict.pass === false).length;
  const errorCount = results.filter(r => r.verdict.pass === null).length;
  const passRate = results.length > 0 ? Math.round((passCount / (passCount + failCount || 1)) * 100) : 0;

  const runRecord = {
    runAt: new Date().toISOString(),
    totalSamples: results.length,
    passCount,
    failCount,
    errorCount,
    passRate,
    results
  };

  try {
    const qaStore = getStore({ name: "qa-fact-check" });
    const dateKey = new Date().toISOString().slice(0, 10);
    await qaStore.setJSON(`run:${dateKey}`, runRecord);
    await qaStore.setJSON("latest", runRecord);
  } catch (e) {
    console.log("Failed to save QA results to Blobs:", e.message);
  }

  console.log(
    `QA fact-check complete: ${passCount}/${passCount + failCount} passed (${passRate}%), ${errorCount} run/parse error(s).` +
    (failCount > 0 ? ` FAILURES: ${results.filter(r => r.verdict.pass === false).map(r => `${r.name} (${r.persona}/${r.category}): ${r.verdict.reasoning}`).join(" | ")}` : "")
  );

  return { statusCode: 200 };
};
