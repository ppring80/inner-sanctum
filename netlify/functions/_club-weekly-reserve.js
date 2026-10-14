'use strict';
const {reserveDecision}=require('./_club-reserve-decision');
const {resolveCurrentNFLWeek}=require('./_current-nfl-week');
const clubs=require('./_official-club-sources.json');
function weeklyReserveDecision({player,season,week,report,baseline=null,enabled=false,now=Date.now()}){
 const none={action:'NO_OVERRIDE'};
 if(!enabled||!report||resolveCurrentNFLWeek(new Date(report.asOf),Number(season))!==Number(week))return none;
 const decision=reserveDecision({player,season,report,enabled,now});
 if(decision.action==='NO_OVERRIDE')return decision;
 if(decision.action==='EXPLICIT_RESERVE_EXIT'||decision.action==='EXPLICIT_DEPARTURE'){
  if(baseline?.reportedAt&&(baseline.reportedAt>decision.reportedAt||baseline.reportedAt===decision.reportedAt&&baseline.status!==decision.status))return {...none,gap:'OFFICIAL_EVENT_ORDER_UNRESOLVED'};
 }else if(baseline?.status==='ACTIVE'&&(!decision.placementDate||decision.placementDate<=baseline.reportedAt))return {...none,gap:'ROSTER_DOES_NOT_OVERRIDE_EXPLICIT_ACTIVATION'};
 const club=clubs.find(club=>club.team===player.team).club;
 const source=decision.provenance.find(source=>source.profileUrl)||decision.provenance.at(-1);
 return {...decision,source:'Official club availability',sourceUrl:source.sourceUrl,
  reason:decision.action==='EXPLICIT_DEPARTURE'?`${club} reported that ${player.name} left the team on ${decision.reportedAt}. This does not establish availability with another team.`:
   decision.action==='EXPLICIT_RESERVE_EXIT'?`${club} explicitly activated ${player.name} from the reserve list on ${decision.reportedAt}. This confirms reserve eligibility, not health.`:
   decision.evidenceFresh?`${club}'s official roster lists ${player.name} on ${decision.status}.${decision.placementDate?'':' The placement date is unverified.'}`:
   `${player.name}'s last verified status is ${decision.status}; current reserve evidence is stale.`};
}
module.exports={weeklyReserveDecision};
