'use strict';
// Private, pure current-state contract. No cache writes, ranking changes or freshness promotion.
const {canonicalNameKey}=require('../../player-identity');
const {officialUrl}=require('./_official-club-transactions');
const {deriveStates}=require('./_club-availability-reconciliation');
const {compatiblePosition}=require('./_club-position-identity');
const reserve=new Set(['IR','PUP','NFI']);
const key=p=>canonicalNameKey(p.name);
function currentClubAvailability({team,season,asOf,snapshot,previousRecords=[],events=[],discoveryComplete=false,maxObservationAgeMs=7200000}){
 const cutoff=Date.parse(asOf);
 if(!Number.isFinite(cutoff)||!Number.isInteger(season)||!Number.isFinite(maxObservationAgeMs)||maxObservationAgeMs<0)throw Error('Availability cutoff/season invalid.');
 const diagnostics=[],validEvents=[];
 for(const e of events.filter(e=>e.team===team)){
  const day=Date.parse(e.reportedAt+'T00:00:00Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(e.reportedAt||'')||!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==e.reportedAt||Number(e.reportedAt.slice(0,4))!==season||day>cutoff||e.identityVerified!==true){diagnostics.push({name:e.name,reason:'EVENT_DATE_OR_IDENTITY_INVALID'});continue;}
  try{const u=new URL(e.sourceUrl);if(u.origin!=='https://www.nfl.com')officialUrl(e.sourceUrl,team);else if(!/^\/(transactions|news)\//.test(u.pathname)||u.username||u.password)throw Error('Invalid league provenance');}catch{diagnostics.push({name:e.name,reason:'EVENT_PROVENANCE_INVALID'});continue;}
  validEvents.push(e);
 }
 const prior=previousRecords.filter(e=>e.team===team&&Number(e.season||e.reportedAt?.slice(0,4))===season&&e.reportedAt<=asOf.slice(0,10));
 const derived=deriveStates(prior,validEvents,{team,asOf});diagnostics.push(...derived.unresolved);
 let usable=false,rows=[];
 if(snapshot){
  if(snapshot.team!==team)throw Error('Availability roster team mismatch.');
  officialUrl(snapshot.sourceUrl,team);
  const observed=Date.parse(snapshot.observedAt);
  usable=Number.isFinite(observed)&&observed<=cutoff&&cutoff-observed<=maxObservationAgeMs;
  if(!usable)diagnostics.push({reason:'ROSTER_OBSERVATION_STALE_OR_INVALID'});
  if(!Array.isArray(snapshot.rows)||new Set(snapshot.rows.map(key)).size!==snapshot.rows.length||snapshot.rows.some(p=>p.team!==team||!p.name||!p.position||!p.profileUrl))throw Error('Availability roster identity incomplete.');
  for(const p of snapshot.rows)officialUrl(p.profileUrl,team);
  rows=snapshot.rows;
  if(!rows.length)diagnostics.push({reason:'ROSTER_OBSERVATION_EMPTY'});
  for(const p of rows)if(/^Reserve\//.test(p.section||'')&&!reserve.has(p.status)&&p.status!=='RESERVE_RETURN_PROCESS')diagnostics.push({name:p.name,reason:'UNSUPPORTED_RESERVE_SECTION'});
 }
 const players=[];
 const names=new Set([...derived.states.map(key),...rows.map(key)]);
 for(const nameKey of names){
  const transaction=derived.states.find(p=>key(p)===nameKey),roster=rows.find(p=>key(p)===nameKey),conflicts=[];
  const identity=roster||transaction;
  const record={name:identity.name,team,position:identity.position||null,status:transaction?.status||'UNKNOWN',lastVerifiedStatus:transaction?.status==='CONFLICT'?null:transaction?.status||null,basis:transaction?'DATED_OFFICIAL_EVENT':'UNKNOWN',placementDate:transaction&&reserve.has(transaction.status)?transaction.reportedAt:null,observedAt:usable&&roster?snapshot.observedAt:null,health:'UNKNOWN',customerEligible:false,conflicts,provenance:transaction?[...transaction.history]:[]};
  if(usable&&roster){
   record.provenance.push({sourceUrl:snapshot.sourceUrl,profileUrl:roster.profileUrl,observedAt:snapshot.observedAt,section:roster.section,status:roster.status});
   if(reserve.has(roster.status)){
    if(!transaction){record.status=roster.status;record.lastVerifiedStatus=roster.status;record.basis='OFFICIAL_ROSTER_OBSERVATION';}
    else if(transaction.status!==roster.status)conflicts.push('ROSTER_TRANSACTION_CONFLICT');
   }else if(roster.status==='RESERVE_RETURN_PROCESS'){
    if(!transaction){record.status='RESERVE_UNSPECIFIED';record.basis='OFFICIAL_ROSTER_OBSERVATION';}
    else if(!reserve.has(transaction.status))conflicts.push('RETURN_PROCESS_TRANSACTION_CONFLICT');
   }else if(roster.status==='ACTIVE_ROSTER'&&transaction&&transaction.status!=='ACTIVE'){
    const departure=transaction.status==='DEPARTED'&&transaction.kind==='DEPARTURE'&&transaction.identityVerified===true;
    if(departure)record.rosterDiscrepancy={reason:'ACTIVE_ROSTER_LISTING_CONTRADICTS_EXPLICIT_DEPARTURE',transactionDate:transaction.reportedAt,rosterObservedAt:snapshot.observedAt,resolution:'DATED_DEPARTURE_CONTROLS_MEMBERSHIP'};
    else conflicts.push('ACTIVE_LISTING_DOES_NOT_CLEAR_RESERVE_OR_DEPARTURE');
   }
  }
  if(usable&&transaction&&!roster&&[...reserve,'ACTIVE'].includes(transaction.status))conflicts.push('ROSTER_ABSENCE_NOT_PROOF_OF_EXIT');
  if(transaction?.status==='CONFLICT')conflicts.push('CONFLICTING_DATED_EVENTS');
  if(transaction&&roster&&transaction.position&&!compatiblePosition(roster.position,transaction.position))conflicts.push('POSITION_IDENTITY_CONFLICT');
  else if(transaction&&roster&&transaction.position&&roster.position!==transaction.position)record.positionLabelDifference={transactionPosition:transaction.position,rosterPosition:roster.position,resolution:'EXPLICIT_BROAD_SPECIFIC_POSITION_COMPATIBILITY'};
  record.availability=conflicts.length?'UNRESOLVED':reserve.has(record.status)||record.status==='RESERVE_UNSPECIFIED'?'RESERVE_RESTRICTED':record.status==='ACTIVE'?'RESERVE_EXIT_CONFIRMED':record.status==='DEPARTED'?'DEPARTURE_CONFIRMED':'UNKNOWN';
  // A dated event is evidence, not a claim that the discovery run covered every later move.
  record.customerEligible=usable&&discoveryComplete&&diagnostics.length===0&&!!roster&&conflicts.length===0&&['IR','PUP','NFI','ACTIVE'].includes(record.status);
  players.push(record);
 }
 return {team,season,asOf,collectionHealthy:usable&&diagnostics.length===0,discoveryComplete,coveragePassed:usable&&discoveryComplete&&diagnostics.length===0&&!players.some(p=>p.conflicts.length||p.status==='RESERVE_UNSPECIFIED'),historyComplete:false,players,diagnostics,productionEnabled:false};
}
module.exports={currentClubAvailability};
