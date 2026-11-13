const { connectLambda, getStore } = require("@netlify/blobs");
const { requireTank01RefreshAuthorization } = require("./_tank01-refresh-guard.js");
const { requireTank01Budget } = require("./_tank01-daily-budget.js");

// Full player feed includes reserves omitted by team-roster endpoints.
// Scheduled shared-cache refresh only; one budgeted call, no customer calls.
// Provider errors or incomplete identity/coverage preserve the previous cache.

function refreshFailed(reason) {
  return {
    statusCode: 502,
    body: JSON.stringify({
      cached: false,
      error: `Full player availability refresh failed (${reason}); previous cache preserved.`
    })
  };
}

async function fetchTank01(endpoint, params = {}) {
  const baseUrl = "https://tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";
  const queryString = new URLSearchParams(params).toString();
  const url = `${baseUrl}/${endpoint}${queryString ? "?" + queryString : ""}`;

  const response = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(18000),
    headers: {
      "Content-Type": "application/json",
      "x-rapidapi-host": "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com",
      "x-rapidapi-key": process.env.TANK01_API_KEY
    }
  });

  return response;
}

exports.handler = async (event) => {
  // Same requirement as chat.js — must be called before any
  // getStore()/Blobs call in this runtime mode.
  connectLambda(event);

  const authorizationError = requireTank01RefreshAuthorization(event);
  if (authorizationError) return authorizationError;
  if (!process.env.TANK01_API_KEY?.trim()) return refreshFailed('Tank01 key unavailable');
  // Player status is the only workload allowed to use the final protected
  // 100-call pool. Customer traffic can never invoke this handler directly.
  const budgetError = await requireTank01Budget(event, {
    job: "refresh-player-data",
    calls: 1,
    priority: "injury",
    // Retain today's existing reservation ceiling: earlier roster runs reserved
    // 33 calls each. Lowering it during migration would block this refresh.
    maxJobCalls: require('./_availability-refresh-rhythm.js').dailyRuns(Date.now()) * 33
  });
  if (budgetError) return budgetError;

  let response;
  try {
    response = await fetchTank01('getNFLPlayerList');
  } catch (error) {
    return refreshFailed(error.name === 'TimeoutError' ? 'Tank01 request timed out' : 'Tank01 request failed');
  }
  if (!response.ok) return refreshFailed(`Tank01 HTTP ${response.status}`);

  let data;
  try {
    data = await response.json();
  } catch {
    return refreshFailed('Tank01 response was not valid JSON');
  }
  if (!data || data.error || (data.statusCode && Number(data.statusCode) !== 200)) {
    return refreshFailed('Tank01 rejected the player-list request');
  }

  let cached;
  try {
    cached = require('./_tank01-player-cache').buildPlayerCache(data.body);
  } catch {
    return refreshFailed('Tank01 player list failed identity or coverage validation');
  }

  try {
    const store=getStore({name:'player-data'});
    const previous=await store.get('playerData',{type:'json'}).catch(()=>null);
    // Retain display metadata only when omitted; never carry old availability.
    for(const [id,p] of Object.entries(cached.players))if(p.exp===undefined&&previous?.players?.[id]?.exp!==undefined)p.exp=previous.players[id].exp;
    await store.setJSON('playerData',cached);
    return {statusCode:200,body:JSON.stringify({cached:true,teamsSucceeded:32,teamsFailed:0,playerCount:cached.playerCount,availabilityMode:cached.availabilityMode})};
  } catch {
    return refreshFailed('Netlify cache write failed');
  }
};
