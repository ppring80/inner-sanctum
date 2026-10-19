const { connectLambda, getStore } = require("@netlify/blobs");
const { requireTank01RefreshAuthorization } = require("./_tank01-refresh-guard.js");
const { requireTank01Budget } = require("./_tank01-daily-budget.js");

// Full player feed includes reserves omitted by team-roster endpoints.
// Scheduled shared-cache refresh only; one budgeted call, no customer calls.
// Provider errors or incomplete identity/coverage preserve the previous cache.

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
    calls: 1,
    priority: "injury",
    // Retain today's existing reservation ceiling: earlier roster runs reserved
    // 33 calls each. Lowering it during migration would block this refresh.
    maxJobCalls: require('./_availability-refresh-rhythm.js').dailyRuns(Date.now()) * 33
  });
  if (budgetError) return budgetError;

  try {
    const response=await fetchTank01('getNFLPlayerList');
    if(response.error || response.statusCode && Number(response.statusCode)!==200)throw Error('Provider rejected full player feed');
    const cached=require('./_tank01-player-cache').buildPlayerCache(response.body);
    const store=getStore({name:'player-data'});
    const previous=await store.get('playerData',{type:'json'}).catch(()=>null);
    // Retain display metadata only when omitted; never carry old availability.
    for(const [id,p] of Object.entries(cached.players))if(p.exp===undefined&&previous?.players?.[id]?.exp!==undefined)p.exp=previous.players[id].exp;
    await store.setJSON('playerData',cached);
    return {statusCode:200,body:JSON.stringify({cached:true,teamsSucceeded:32,teamsFailed:0,playerCount:cached.playerCount,availabilityMode:cached.availabilityMode})};
  } catch (_) {
    return {statusCode:502,body:JSON.stringify({cached:false,error:'Full player availability refresh failed; previous cache preserved.'})};
  }
};
