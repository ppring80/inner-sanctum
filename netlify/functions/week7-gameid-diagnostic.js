'use strict';
// TEMPORARY read-only Week 7 diagnostic. No provider calls, no cache writes,
// no customer roster or secrets. Remove after the mismatch is verified.
const { connectLambda } = require('@netlify/blobs');
const { readCachedWeeklySchedule } = require('./_weekly-sage-schedule-cache');
const { buildKickoffIndex } = require('./_super-sage-kickoff');
const TEAM_ALIAS = {JAC:'JAX',WSH:'WAS',LA:'LAR',OAK:'LV',SD:'LAC',ARZ:'ARI',GNB:'GB',KAN:'KC',NWE:'NE',NOR:'NO',SFO:'SF',TAM:'TB',HST:'HOU',BLT:'BAL',CLV:'CLE'};
const teamCode = x => { const s=String(x||'').trim().toUpperCase(); return TEAM_ALIAS[s]||s; };
const POSITIONS=['QB','RB','WR','TE','K','DEF'];
function compare(rankings,schedule) {
  const index=buildKickoffIndex(schedule,{season:2026,week:7});
  if(!index.ok) return {error:index.reason};
  const issues=[],counts={active:0,inactive:0,matched:0,missingSchedule:0,gameIdConflict:0,byeWithGameId:0};
  for(const position of POSITIONS) for(const kind of ['positions','inactive']) {
    for(const row of (rankings?.[kind]?.[position]||[])) {
      if(!row || !row.gameID || position==='DEF') continue;
      const inactive=kind==='inactive'; counts[inactive?'inactive':'active']++;
      const team=teamCode(row.currentTeam||row.team);
      const game=index.byTeam[team]||null;
      const isBye=(index.byeTeams||[]).some(x=>teamCode(x)===team);
      let type=null;
      if(!game) {type=isBye?'BYE_WITH_GAME_ID':'NO_SCHEDULE_GAME';counts[isBye?'byeWithGameId':'missingSchedule']++;}
      else if(game.gameID && String(game.gameID)!==String(row.gameID)) {type='GAME_ID_CONFLICT';counts.gameIdConflict++;}
      else counts.matched++;
      if(type && issues.length<100) issues.push({type,player:row.name||null,position,team,inactive,rankingGameID:String(row.gameID),scheduleGameID:game?.gameID||null,rankingOpponent:row.opponent||null});
    }
  }
  return {week:7,season:2026,rankingsGeneratedAt:rankings.generatedAt||null,scheduleGeneratedAt:schedule.generatedAt||null,counts,issues,shown:issues.length};
}
async function handler(event,deps={}) {
  const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
  const reply=(code,body)=>({statusCode:code,headers,body:JSON.stringify(body)});
  if(event.httpMethod!=='GET') return reply(405,{error:'GET only'});
  if(!deps.readSchedule) connectLambda(event);
  let schedule,rankings;
  try {
    schedule=await (deps.readSchedule||readCachedWeeklySchedule)({season:2026,week:7,seasonType:'reg'});
    const base=process.env.URL||'https://theinnersanctum.xyz';
    const url=base+'/.netlify/functions/weekly-sage-rankings?season=2026&week=7&seasonType=reg&scoring=half&teams=12';
    const response=await (deps.fetch||fetch)(url,{headers:{Accept:'application/json'}});
    if(!response.ok) return reply(503,{error:'Rankings unavailable',status:response.status});
    rankings=await response.json();
  } catch(e) { return reply(503,{error:'Cached evidence unavailable',detail:String(e.message||e).slice(0,120)}); }
  if(String(rankings.season)!=='2026'||Number(rankings.targetWeek)!==7) return reply(409,{error:'Rankings are not Week 7'});
  return reply(200,compare(rankings,schedule));
}
exports.handler=handler;
exports.compare=compare;
