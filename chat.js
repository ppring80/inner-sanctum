const Anthropic = require("@anthropic-ai/sdk");

// ═══════════════════════════════════════
// TANK01 DATA FETCHER
// ═══════════════════════════════════════
async function fetchTank01(endpoint, params = {}) {
  const baseUrl = "https://tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";
  const queryString = new URLSearchParams(params).toString();
  const url = `${baseUrl}/${endpoint}${queryString ? '?' + queryString : ''}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-rapidapi-host": "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com",
      "x-rapidapi-key": process.env.TANK01_API_KEY
    }
  });

  if (!response.ok) {
    throw new Error(`Tank01 API error: ${response.status}`);
  }

  return await response.json();
}

// ═══════════════════════════════════════
// GET LIVE NFL CONTEXT
// ═══════════════════════════════════════
async function getLiveNFLContext() {
  const contextParts = [];

  try {
    // 1. Top news and headlines
    const news = await fetchTank01("getNFLNews", { topNews: "true", maxItems: "5" });
    if (news && news.body && news.body.length > 0) {
      const headlines = news.body
        .slice(0, 5)
        .map(item => `- ${item.title}`)
        .join("\n");
      contextParts.push(`LATEST NFL NEWS (updated live):\n${headlines}`);
    }
  } catch (e) {
    console.log("News fetch failed:", e.message);
  }

  try {
    // 2. Fantasy projections for current week
    const projections = await fetchTank01("getNFLProjections", {
      week: getCurrentNFLWeek(),
      season: "2026"
    });
    if (projections && projections.body) {
      const topPlayers = Object.values(projections.body)
        .slice(0, 20)
        .map(p => `${p.longName || p.playerName} (${p.pos}, ${p.team}): ${p.fantasyPoints || 'N/A'} proj pts`)
        .join("\n");
      contextParts.push(`TOP FANTASY PROJECTIONS THIS WEEK:\n${topPlayers}`);
    }
  } catch (e) {
    console.log("Projections fetch failed:", e.message);
  }

  try {
    // 3. Injury report
    const injuries = await fetchTank01("getNFLInjuries");
    if (injuries && injuries.body && injuries.body.length > 0) {
      const injuryList = injuries.body
        .slice(0, 15)
        .map(p => `${p.longName || p.playerName} (${p.pos}, ${p.team}): ${p.injuryStatus || 'Questionable'} — ${p.injuryDescription || 'injury'}`)
        .join("\n");
      contextParts.push(`CURRENT NFL INJURY REPORT:\n${injuryList}`);
    }
  } catch (e) {
    console.log("Injury fetch failed:", e.message);
  }

  try {
    // 4. ADP data
    const adp = await fetchTank01("getNFLADP", { season: "2026" });
    if (adp && adp.body && adp.body.length > 0) {
      const adpList = adp.body
        .slice(0, 20)
        .map(p => `${p.longName || p.playerName} (${p.pos}, ${p.team}): ADP ${p.adp || 'N/A'}`)
        .join("\n");
      contextParts.push(`CURRENT ADP (Average Draft Position):\n${adpList}`);
    }
  } catch (e) {
    console.log("ADP fetch failed:", e.message);
  }

  return contextParts.join("\n\n");
}

// ═══════════════════════════════════════
// GET CURRENT NFL WEEK
// ═══════════════════════════════════════
function getCurrentNFLWeek() {
  // 2026 NFL season starts September 9, 2026
  const seasonStart = new Date("2026-09-09");
  const now = new Date();
  const diffMs = now - seasonStart;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const week = Math.max(1, Math.min(18, Math.floor(diffDays / 7) + 1));

  // If we're in the offseason, return preseason week 1
  if (now < seasonStart) return "1";
  return String(week);
}

// ═══════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { model, max_tokens, system, messages } = JSON.parse(event.body);

    // Fetch live NFL data from Tank01
    let liveDataContext = "";
    try {
      liveDataContext = await getLiveNFLContext();
    } catch (e) {
      console.log("Tank01 context fetch failed:", e.message);
      // Non-fatal — we continue without live data
    }

    // Inject live data into the system prompt
    const enhancedSystem = liveDataContext
      ? `${system}\n\n═══════════════════════════════════\nLIVE NFL DATA — USE THIS IN YOUR RESPONSE:\n${liveDataContext}\n═══════════════════════════════════\nAlways reference specific players, injury statuses, and projections from the live data above when relevant. This data is current as of today.`
      : system;

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model,
      max_tokens,
      system: enhancedSystem,
      messages
    });

    // Pull all text blocks out of the response
    const fullText = response.content
      .filter(block => block.type === "text")
      .map(block => block.text)
      .join("\n")
      .trim();

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: [{ type: "text", text: fullText }] }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
