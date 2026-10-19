'use strict';
const MODE='tank01-full-player-list-v1';
function buildPlayerCache(body,now=new Date().toISOString()){
 if(!Array.isArray(body)||body.length<1000)throw Error('Full player feed incomplete');
 const players={},teams=new Set();let injuries=0;
 for(const p of body){
  if(!p?.playerID||!p.longName)continue;
  const id=String(p.playerID);if(players[id])throw Error('Duplicate player identity in full feed');
  const team=p.team||p.teamAbv||null;
  const free=String(p.isFreeAgent).toLowerCase()==='true';
  if(team&&!free)teams.add(team);
  if(p.injury&&typeof p.injury==='object')injuries++;
  const injury=p.injury&&typeof p.injury==='object'?{...p.injury}:null;
  if(/^injured reserve(?:\s*-\s*designated to return)?$/i.test(String(injury?.designation||''))){injury.providerDesignation=injury.designation;injury.designation='IR';}
  players[id]={longName:p.longName,pos:p.pos||p.position||null,team:free?null:team,exp:p.exp,injury,rosterStatus:free?'UNSIGNED':p.rosterStatus||p.status||null,...(free?{active:false}:typeof p.active==='boolean'?{active:p.active}:{}),isFreeAgent:p.isFreeAgent};
 }
 if(teams.size!==32||Object.keys(players).length<1000||injuries<1000)throw Error('Full player availability coverage incomplete');
 return{updatedAt:now,availabilityMode:MODE,source:'Tank01 getNFLPlayerList',playerCount:Object.keys(players).length,teamsSucceeded:32,teamsFailed:0,players};
}
module.exports={MODE,buildPlayerCache};
