const { connectLambda, getStore } = require("@netlify/blobs");

// ═══════════════════════════════════════
// PLAYER DATA REFRESH — checklist #215 follow-up
//
// Confirmed via live diagnostic (2026-07-11) that getNFLTeamRoster
// returns the FULL player object per team, including "exp" (years of
// experience — "R" for rookie, a number string like "4" otherwise)
// and a nested "injury" object (designation, description, dates).
// This is the SAME data getNFLPlayerInfo returns per-player, but
// getNFLTeamRoster gives it for an entire team's roster in ONE call —
// so 32 calls (one per team) covers the whole league, vs. ~1,700
// calls doing it player-by-player.
//
// This still isn't cheap enough to call live on every chat message
// (32 Tank01 calls would add several seconds of latency to every
// single Sanctum response, and eat into the Pro plan's 1,000/day
// budget fast). So this runs on a SCHEDULE instead — once a day is
// the default below — and caches the result to Netlify Blobs.
// chat.js's getLiveNFLContext() reads that cache (one fast Blobs
// read) rather than hitting Tank01 directly for this data.
//
// SCHEDULING: this file's cron is set in netlify.toml, NOT inline
// here, to match this being a classic Lambda-compatible handler
// (connectLambda pattern) rather than the newer web-standard export
// style Netlify's docs default to — inline `config.schedule` export
// syntax assumes the newer (req) => {} signature, and mixing runtime
// styles isn't worth the risk when the netlify.toml route works
// identically for either. Add this to netlify.toml:
//
//   [functions."refresh-player-data"]
//     schedule = "@daily"
//
// @daily runs at 00:00 UTC. Tank01 says rosters update hourly, so a
// daily refresh means worst-case the data is up to ~24h stale (e.g.
// a Tuesday practice-squad move might not show until the next day's
// refresh) — acceptable for exp/injury context in a chat persona,
// but if that staleness ever matters more, this can be changed to
// "0 */6 * * *" (every 6 hours) without any other code changes.
//
// 30-SECOND LIMIT: Scheduled functions have a hard 30s execution
// cap. Based on the diagnostic timing in checklist #215 (~3-4s per
// Tank01 call), 32 SEQUENTIAL calls would take well over a minute —
// blowing the limit. Promise.allSettled below fires all 32 in
// PARALLEL instead, since these are independent network calls, not
// CPU-bound work — total wall time is close to the slowest single
// call, not the sum of all of them.
//
// allSettled (not all) is deliberate: if 1-2 teams fail (rate limit,
// transient network blip), we still want to cache the other 30
// teams' data rather than losing the whole refresh over one bad call.
// ═══════════════════════════════════════

const NFL_TEAMS = [
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN",
  "DET", "GB", "HOU", "IND", "JAX", "KC", "LAC", "LAR", "LV", "MIA",
  "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB",
  "TEN", "WAS"
];

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

exports.handler = async (event) => {
  // Same requirement as chat.js — must be called before any
  // getStore()/Blobs call in this runtime mode.
  connectLambda(event);

  const playerMap = {};
  let teamsSucceeded = 0;
  let teamsFailed = 0;

  const results = await Promise.allSettled(
    NFL_TEAMS.map(teamAbv => fetchTank01("getNFLTeamRoster", { teamAbv }))
  );

  results.forEach((result, i) => {
    const teamAbv = NFL_TEAMS[i];
    if (result.status === "fulfilled") {
      const roster = result.value?.body?.roster;
      if (Array.isArray(roster)) {
        roster.forEach(p => {
          if (p.playerID) {
            playerMap[p.playerID] = {
              longName: p.longName,
              pos: p.pos,
              team: p.team || teamAbv,
              exp: p.exp,
              injury: p.injury
            };
          }
        });
        teamsSucceeded++;
      } else {
        teamsFailed++;
        console.log(`Roster response for ${teamAbv} had no roster array`);
      }
    } else {
      teamsFailed++;
      console.log(`Roster fetch failed for ${teamAbv}:`, result.reason?.message);
    }
  });

  const store = getStore({ name: "player-data" });
  await store.setJSON("playerData", {
    updatedAt: new Date().toISOString(),
    playerCount: Object.keys(playerMap).length,
    teamsSucceeded,
    teamsFailed,
    players: playerMap
  });

  console.log(
    `Player data refresh complete: ${Object.keys(playerMap).length} players cached from ${teamsSucceeded}/${NFL_TEAMS.length} teams` +
    (teamsFailed > 0 ? ` (${teamsFailed} team(s) failed — see logs above)` : "")
  );

  return { statusCode: 200 };
};
