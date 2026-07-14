const { connectLambda, getStore } = require("@netlify/blobs");

// ═══════════════════════════════════════════════════════════════════════
// RISERS & FALLERS — DIAGNOSTIC VIEWER
//
// Read-only endpoint to inspect what refresh-risers-fallers.js actually
// cached, without needing to re-run the computation. Same purpose as
// hitting diagnostic-box-score.js's URL directly — a plain-browser-
// visible JSON dump for eyeballing real output before trusting it or
// building a frontend on top of it.
//
// USAGE:
//   /.netlify/functions/view-risers-fallers
//     -> shows the "latest" cached result (whatever the most recent
//        refresh-risers-fallers run computed, manual or scheduled)
//
//   /.netlify/functions/view-risers-fallers?week=2&season=2025
//     -> shows a SPECIFIC week's cached result, if it exists
//
// Returns risers/fallers sorted (already sorted by magnitude when
// cached), formatted as plain readable percentages (e.g. "23.4%"
// instead of raw 0.234) rather than the raw decimal fractions stored
// internally, since this endpoint's whole purpose is human eyeballing,
// not machine consumption — the frontend page (once built) will read
// the raw cached JSON directly instead of going through this endpoint.
// ═══════════════════════════════════════════════════════════════════════

function pct(n) {
  return `${(n * 100).toFixed(1)}%`;
}

function formatEntry(e) {
  return {
    name: e.longName,
    team: e.team,
    pos: e.pos,
    targetShare: `${pct(e.previous.targetSharePct)} -> ${pct(e.current.targetSharePct)} (${e.targetShareDelta >= 0 ? "+" : ""}${pct(e.targetShareDelta)})`,
    snapShare: `${pct(e.previous.offSnapPct)} -> ${pct(e.current.offSnapPct)} (${e.snapShareDelta >= 0 ? "+" : ""}${pct(e.snapShareDelta)})`,
    targets: `${e.previous.targets} -> ${e.current.targets}`
  };
}

exports.handler = async (event) => {
  connectLambda(event);

  const params = event.queryStringParameters || {};
  const store = getStore({ name: "risers-fallers" });

  let key = "latest";
  if (params.week && params.season) {
    key = `week:${params.season}:${params.week}`;
  }

  let data;
  try {
    data = await store.get(key, { type: "json" });
  } catch (e) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: `No cached data found for key "${key}"`, detail: e.message })
    };
  }

  if (!data) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: `No cached data found for key "${key}"` })
    };
  }

  const formatted = {
    computedAt: data.computedAt,
    season: data.season,
    weeksCompared: `Week ${data.previousWeek} -> Week ${data.currentWeek}`,
    threshold: pct(data.threshold),
    totalPlayersCompared: data.playerCount,
    topRisers: data.risers.slice(0, 15).map(formatEntry),
    topFallers: data.fallers.slice(0, 15).map(formatEntry)
  };

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(formatted, null, 2)
  };
};
