'use strict';
const clubs=require('./_official-club-sources.json');
const {reserveDecision}=require('./_club-reserve-decision');
const TTL=7200000;
function observationStatus(cache,{now=Date.now()}={}){
 const teams=clubs.map(club=>{
  const report=cache?.teams?.[club.team],players=Array.isArray(report?.players)?report.players:[];
  const observedDates=players.map(player=>Date.parse(player.observedAt||'')).filter(Number.isFinite);
  const observed=observedDates.length?Math.min(...observedDates):NaN,checked=Date.parse(report?.asOf||'');
  const fresh=report?.season===new Date(now).getUTCFullYear()&&report?.collectionHealthy===true&&Number.isFinite(observed)&&Number.isFinite(checked)&&observed<=checked&&checked<=now&&now-observed<TTL;
  const conflicts=players.filter(player=>player.conflicts?.length).map(player=>({name:player.name,position:player.position||null,status:player.status,lastVerifiedStatus:player.lastVerifiedStatus||null,reasons:player.conflicts}));
  const counts={IR:0,PUP:0,NFI:0,explicitExits:0,departures:0};
  for(const player of players){
   const decision=reserveDecision({player,season:report.season,report,enabled:true,now});
   if(decision.action==='KEEP_RESERVE_RESTRICTION'&&['IR','PUP','NFI'].includes(decision.status))counts[decision.status]++;
   if(decision.action==='EXPLICIT_RESERVE_EXIT')counts.explicitExits++;
   if(decision.action==='EXPLICIT_DEPARTURE')counts.departures++;
  }
  return {team:club.team,checkedAt:report?.asOf||null,observedAt:Number.isFinite(observed)?new Date(observed).toISOString():null,fresh,
   discoveryComplete:report?.discoveryComplete===true,counts,playerConflicts:conflicts,diagnostics:report?.diagnostics||[]};
 });
 const observed=teams.filter(team=>team.observedAt).map(team=>team.observedAt).sort();
 return {basis:'OFFICIAL_ROSTER_OBSERVATIONS',freshRosterCoverage:teams.every(team=>team.fresh),freshTeams:teams.filter(team=>team.fresh).map(team=>team.team),requiredTeams:clubs.length,
  oldestObservedAt:observed[0]||null,newestObservedAt:observed.at(-1)||null,playerConflictCount:teams.reduce((count,team)=>count+team.playerConflicts.length,0),
  establishesAnnouncementCoverage:false,teams};
}
module.exports={observationStatus};
