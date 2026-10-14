'use strict';
const {canonicalNameKey}=require('../../player-identity');
const {officialUrl}=require('./_official-club-transactions');
const {compatiblePosition}=require('./_club-position-identity');
const reserve=new Set(['IR','PUP','NFI']);
function reserveDecision({player,season,report,enabled=false,now=Date.now(),maxAgeMs=7200000}){
 const none={action:'NO_OVERRIDE',health:'UNKNOWN',customerReadsEnabled:enabled};
 if(!enabled||!report||report.team!==player.team||report.season!==Number(season)||!Array.isArray(report.players))return none;
 const matches=report.players.filter(record=>record.team===player.team&&canonicalNameKey(record.name)===canonicalNameKey(player.name||player.longName)&&(!player.position||compatiblePosition(record.position,player.position)));
 if(matches.length!==1)return {...none,gap:'PLAYER_IDENTITY_UNRESOLVED'};
 const record=matches[0],age=now-Date.parse(report.asOf||''),fresh=Number.isFinite(age)&&age>=0&&age<maxAgeMs;
 if(!Number.isFinite(age)||age<0)return {...none,gap:'OBSERVATION_CUTOFF_INVALID'};
 const provenance=Array.isArray(record.provenance)?record.provenance:[];
 if(provenance.some(source=>{
  try{if(source.profileUrl)officialUrl(source.profileUrl,player.team);const url=new URL(source.sourceUrl);if(url.origin==='https://www.nfl.com'&&!url.username&&!url.password&&/^\/(transactions|news)\//.test(url.pathname))return false;officialUrl(url.href,player.team);return false;}catch{return true;}
 }))return {...none,gap:'UNAPPROVED_PROVENANCE'};
 if(!provenance.length)return {...none,gap:'PROVENANCE_MISSING'};
 const conflict=Array.isArray(record.conflicts)&&record.conflicts.length>0;
 if(conflict)return {...none,gap:'PLAYER_AVAILABILITY_UNRESOLVED',lastVerifiedStatus:record.lastVerifiedStatus||null,provenance};
 // A stale restriction remains last-known evidence, never fresh availability.
 // A newly read roster can support restriction without reconstructing its date.
 const observedReserve=provenance.some(source=>source.profileUrl&&reserve.has(source.status));
 if(reserve.has(record.status)&&(observedReserve||reserve.has(record.lastVerifiedStatus))){
  return {action:'KEEP_RESERVE_RESTRICTION',status:record.status,health:'UNKNOWN',evidenceFresh:fresh&&report.collectionHealthy===true,
   discoveryComplete:report.discoveryComplete===true,gap:!fresh?'STALE_RESERVE_EVIDENCE':report.discoveryComplete!==true?'ANNOUNCEMENT_DISCOVERY_INCOMPLETE':null,
   placementDate:record.placementDate||null,observedAt:record.observedAt||null,provenance,customerReadsEnabled:enabled};
 }
 // An unrelated player's/team's failure does not invalidate this player's
 // explicit, conflict-free exit, but neither an active listing nor time does so.
 const exits=provenance.filter(source=>source.identityVerified===true&&['RESERVE_EXIT','DEPARTURE'].includes(source.kind)&&source.status===record.status&&/^\d{4}-\d{2}-\d{2}$/.test(source.reportedAt||'')&&source.reportedAt<=report.asOf.slice(0,10));
 if(fresh&&report.collectionHealthy===true&&record.customerEligible===true&&exits.length&&record.status==='ACTIVE')return {...none,action:'EXPLICIT_RESERVE_EXIT',status:'ACTIVE',evidenceFresh:true,reportedAt:exits.map(source=>source.reportedAt).sort().at(-1),provenance};
 if(fresh&&report.collectionHealthy===true&&report.discoveryComplete===true&&exits.length&&record.status==='DEPARTED')return {...none,action:'EXPLICIT_DEPARTURE',status:'DEPARTED',evidenceFresh:true,reportedAt:exits.map(source=>source.reportedAt).sort().at(-1),provenance};
 return {...none,gap:!fresh?'STALE_AVAILABILITY_EVIDENCE':null};
}
module.exports={reserveDecision};
