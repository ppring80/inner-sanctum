const { connectLambda, getStore } = require("@netlify/blobs");
const { requireTank01RefreshAuthorization } = require("./_tank01-refresh-guard.js");
const { requireTank01Budget } = require("./_tank01-daily-budget.js");

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
// Customer requests read the shared Netlify Blobs cache rather than
// fetching 32 rosters from Tank01. The ten-minute recovery watchdog
// coordinates an eight-hour baseline, after-practice checkpoints and
// checks before actual cached kickoff times. Authorized manual recovery
// uses the same handler and atomic daily roster reservation limit.
// The watchdog schedule lives in netlify.toml; this handler has no
// separate cron so overlapping triggers cannot spend the budget twice.
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
//
// TEAM LIST: fetched live from getNFLTeams below, NOT hardcoded.
// First deploy of this file used a hardcoded 32-abbreviation array
// built from general NFL knowledge, and "WAS" failed on the very
// first live run — Tank01 almost certainly expects a different
// abbreviation for Washington (many providers use "WSH" instead).
// Tank01's own docs say explicitly: "Team abbreviations ... can be
// found from /getNFLTeams endpoint" — this was the same
// trust-memory-over-verify-live mistake flagged earlier tonight with
// the depth chart parser, just smaller in scope. Fixed by fetching
// the real list every run instead of assuming it.
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

exports.handler = async (event) => {
  // Same requirement as chat.js — must be called before any
  // getStore()/Blobs call in this runtime mode.
  connectLambda(event);

  const authorizationError = requireTank01RefreshAuthorization(event);
  if (authorizationError) return authorizationError;
  // Player status is the only workload allowed to use the final protected
  // 100-call pool. Customer traffic can never invoke this handler directly.
  const budgetError = await requireTank01Budget(event, {
    job: "refresh-player-data",
    calls: 33,
    priority: "injury",
    maxJobCalls: require('./_availability-refresh-rhythm.js').dailyRuns(Date.now()) * 33
  });
  if (budgetError) return budgetError;

  // Get the REAL team abbreviation list live, rather than trusting a
  // hardcoded guess (see note above re: the WAS/WSH failure).
  let teamAbvs = [];
  try {
    const teamsResp = await fetchTank01("getNFLTeams");
    teamAbvs = (teamsResp?.body || [])
      .map(t => t.teamAbv)
      .filter(Boolean);
  } catch (e) {
    console.log("getNFLTeams fetch failed, cannot build team list:", e.message);
  }

  if (new Set(teamAbvs).size !== 32 || teamAbvs.length !== 32) {
    console.log("Player data refresh aborted: no team list available");
    return { statusCode: 502, body: JSON.stringify({cached:false,error:"Provider did not supply all 32 teams; previous cache preserved."}) };
  }

  const playerMap = {};
  let teamsSucceeded = 0;
  let teamsFailed = 0;

  const results = await Promise.allSettled(
    teamAbvs.map(teamAbv => fetchTank01("getNFLTeamRoster", { teamAbv }))
  );

  results.forEach((result, i) => {
    const teamAbv = teamAbvs[i];
    if (result.status === "fulfilled") {
      const roster = result.value?.body?.roster;
      if (Array.isArray(roster) && roster.length > 0) {
        roster.forEach(p => {
          if (p.playerID) {
            playerMap[p.playerID] = {
              longName: p.longName,
              pos: p.pos,
              team: p.team || teamAbv,
              exp: p.exp,
              injury: p.injury,
              rosterStatus: p.rosterStatus || p.status || null,
              ...(typeof p.active === "boolean" ? {active:p.active} : {})
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

  if (teamsFailed || teamsSucceeded !== 32 || Object.keys(playerMap).length < 1000) {
    return {statusCode:502,body:JSON.stringify({cached:false,error:`Player availability coverage incomplete: ${teamsSucceeded}/32 teams, ${Object.keys(playerMap).length} players; previous cache preserved.`})};
  }

  const store = getStore({ name: "player-data" });
  const previous = await store.get("playerData", {type:"json"});
  for (const [id,player] of Object.entries(previous?.players || {})) {
    const status = String(player.injury?.designation || player.rosterStatus || "").toUpperCase().replace(/[_-]/g," ");
    if (!playerMap[id] && ["IR","INJURED RESERVE","RESERVE/INJURED","PUP","RESERVE/PUP","NFI","RESERVE/NFI","SUSPENDED"].includes(status)) playerMap[id]={...player,reserveStatusRetained:true};
  }
  await store.setJSON("playerData", {
    updatedAt: new Date().toISOString(),
    playerCount: Object.keys(playerMap).length,
    teamsSucceeded,
    teamsFailed,
    players: playerMap
  });

  console.log(
    `Player data refresh complete: ${Object.keys(playerMap).length} players cached from ${teamsSucceeded}/${teamAbvs.length} teams` +
    (teamsFailed > 0 ? ` (${teamsFailed} team(s) failed — see logs above)` : "")
  );

  return { statusCode: 200, body: JSON.stringify({cached:true,teamsSucceeded,teamsFailed,playerCount:Object.keys(playerMap).length}) };
};
