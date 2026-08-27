const { connectLambda, getStore } = require("@netlify/blobs");

// ═══════════════════════════════════════════════════════════════════════
// CURRENT NFL FACTS — V2.1 (Depth Chart only)
//
// PURPOSE: a small, separate, current-moment cache of Tank01's depth
// chart data, kept deliberately independent of Player Snapshot's own
// historical-usage aggregation. This is the "Current NFL facts" layer
// from the V2 discovery turn's recommended architecture:
//
//   Historical usage      -> refresh-player-snapshot.js  (LOCKED, untouched)
//   Current NFL facts     -> THIS FILE
//   SAGE (later task)     -> consumer only
//
// TANK01 CALL: reuses the EXACT SAME endpoint and fetch pattern already
// proven live in chat.js -- getNFLDepthCharts, called with the same
// base URL/headers/auth. No new endpoint invented. chat.js itself is
// not modified; this is a small, independent duplication of its
// already-working request shape, matching this project's own
// established convention (see refresh-player-snapshot.js's own
// fetchTank01() for the identical pattern already duplicated there).
//
// CONFIRMED REAL RESPONSE SHAPE (per chat.js's own live-verified
// comment, not assumed): depth.body is an ARRAY of team objects, each
// shaped { depthChart: { QB: [...], RB: [...], ... }, teamAbv, teamID }
// -- position arrays are nested INSIDE depthChart, not directly on the
// team object. This function reads that same confirmed shape.
//
// NO CLASSIFICATION LOGIC LIVES HERE. This file does not compute
// "starter," "committee," or any role concept -- it only records the
// raw depth-chart RANK Tank01 already assigns (array index -> depth
// position), plus a plain derived label (e.g. "RB1") for convenience.
// Interpretation belongs to consumers, per the "facts first,
// interpretation second" principle.
// ═══════════════════════════════════════════════════════════════════════

const TANK01_HOST = "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";

async function fetchTank01(endpoint, params = {}) {
  const queryString = new URLSearchParams(params).toString();
  const url = `https://${TANK01_HOST}/${endpoint}${queryString ? "?" + queryString : ""}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-rapidapi-host": TANK01_HOST,
      "x-rapidapi-key": process.env.TANK01_API_KEY
    }
  });
  if (!response.ok) throw new Error(`Tank01 API error: ${response.status} on ${endpoint}`);
  return await response.json();
}

// Positions this cache tracks. Matches Player Snapshot's own existing
// position scope (QB/RB/WR/TE) -- K/DEF depth charts are outside V2.1
// scope, same as they are outside Player Snapshot V1's scope already.
const TRACKED_POSITIONS = ["QB", "RB", "WR", "TE"];

function buildDepthLabel(pos, depth) {
  return pos + String(depth);
}

// Normalizes ONE team's raw depthChart object (already confirmed
// shaped { QB: [...], RB: [...], ... }, each an array of player
// objects with at least longName/playerID) into this cache's compact,
// deterministic per-position structure. Depth rank is taken directly
// from array index (index 0 -> depth 1) -- exactly the convention
// chat.js already relies on ("players.slice(0, 4)" treats array order
// as depth order) -- not re-derived or guessed here.
function normalizeTeamDepthChart(rawDepthChart) {
  const teamOut = {};
  TRACKED_POSITIONS.forEach(pos => {
    const players = Array.isArray(rawDepthChart[pos]) ? rawDepthChart[pos] : [];
    teamOut[pos] = players
      .filter(p => p && p.longName)
      .map((p, i) => ({
        playerID: p.playerID || null, // preserved as-is; never invented when Tank01 omits it
        longName: p.longName,
        depth: i + 1,
        label: buildDepthLabel(pos, i + 1)
      }));
  });
  return teamOut;
}

exports.handler = async (event) => {
  connectLambda(event);

  let depthResponse;
  try {
    depthResponse = await fetchTank01("getNFLDepthCharts");
  } catch (e) {
    console.log("getNFLDepthCharts fetch failed:", e.message);
    return { statusCode: 502, body: JSON.stringify({ error: "Tank01 getNFLDepthCharts fetch failed", detail: e.message }) };
  }

  const rawTeams = Array.isArray(depthResponse?.body) ? depthResponse.body : [];
  if (rawTeams.length === 0) {
    const msg = "getNFLDepthCharts returned no team data -- aborting, nothing cached.";
    console.log(msg);
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: msg }) };
  }

  const teams = {};
  let depthChartPlayerCount = 0;
  rawTeams.forEach(teamEntry => {
    const teamAbv = teamEntry.teamAbv || teamEntry.teamID;
    if (!teamAbv || !teamEntry.depthChart) return;
    const normalized = normalizeTeamDepthChart(teamEntry.depthChart);
    teams[teamAbv] = normalized;
    TRACKED_POSITIONS.forEach(pos => { depthChartPlayerCount += normalized[pos].length; });
  });

  const result = {
    generatedAt: new Date().toISOString(),
    source: "Tank01",
    // Tank01's own response envelope may carry a timestamp/status field
    // on some endpoints; preserved here if present, never invented.
    sourceStatusCode: depthResponse?.statusCode || null,
    teamCount: Object.keys(teams).length,
    depthChartPlayerCount,
    teams
  };

  const store = getStore({ name: "current-nfl-facts" });
  await store.setJSON("latest", result);

  console.log(`Current NFL Facts (depth chart) computed: ${result.teamCount} teams, ${depthChartPlayerCount} depth-chart player entries`);
  return { statusCode: 200, body: JSON.stringify({ teamCount: result.teamCount, depthChartPlayerCount }) };
};

// Exported for local logic testing only -- Netlify only ever invokes
// exports.handler; nothing in the production request path reads this.
exports._internal = {
  normalizeTeamDepthChart,
  buildDepthLabel,
  TRACKED_POSITIONS
};
