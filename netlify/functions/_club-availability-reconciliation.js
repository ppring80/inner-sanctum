'use strict';
// Pure derived state. Never mutates source records, evidence history, or caches.
const {canonicalNameKey}=require('../../player-identity');
const {officialUrl}=require('./_official-club-transactions');
const clean=s=>String(s).replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const key=p=>p.team+':'+canonicalNameKey(p.name);
function rosterSnapshot(html,{team,sourceUrl,observedAt}){
 officialUrl(sourceUrl,team);if(!Number.isFinite(Date.parse(observedAt)))throw Error('Roster observation time missing.');
 const rows=[];
 const sections=[...html.matchAll(/<h4\b[^>]*class=["'][^"']*nfl-o-roster__title[^"']*["'][^>]*>[\s\S]*?<span\b[^>]*class=["'][^"']*nfl-o-roster__title-status[^"']*["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
 if(!sections.length)throw Error('Official roster section contract changed.');
 for(const [,label,table]of sections){
  const section=clean(label),headers=[...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(m=>clean(m[1]));
  const positionIndex=headers.indexOf('Pos');if(headers[0]!=='Player'||positionIndex<0)throw Error('Official roster columns changed.');
  let status=/^Reserve\/Injured(?:; Designated for Return)?$/.test(section)?'IR':section==='Reserve/Physically Unable to Perform'?'PUP':['Reserve/Non-Football Injury','Reserve/Non-Football Illness'].includes(section)?'NFI':section==='Reserve/Designated to Return'?'RESERVE_RETURN_PROCESS':section==='Reserve/Suspended by Commissioner'?'SUSPENDED':section==='Reserve/Retired'?'RETIRED':section==='Active'?'ACTIVE_ROSTER':null;
  for(const [,tr]of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
   const cells=[...tr.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>m[1]);if(!cells.length)continue;
   const profiles=[...cells[0].matchAll(/<a\b[^>]*href=(["'])(.*?)\1[^>]*title=(["'])(.*?)\3/gi)].map(m=>({profileUrl:officialUrl(new URL(m[2],sourceUrl).href,team),name:m[4].replace(/&#39;|&#x27;|&apos;/gi,"'")}));
   const unique=[...new Map(profiles.map(p=>[p.profileUrl,p])).values()];
   if(unique.length!==1||!/^\/team\/players-roster\/[^/]+\/$/.test(new URL(unique[0].profileUrl).pathname)||!clean(cells[positionIndex]))throw Error('Official roster player identity incomplete.');
   rows.push({...unique[0],team,position:clean(cells[positionIndex]),section,status,sourceUrl,observedAt});
  }
 }
 if(!rows.some(p=>p.status==='ACTIVE_ROSTER'))throw Error('Official active roster missing.');
 if(new Set(rows.map(key)).size!==rows.length)throw Error('Player appears in multiple roster sections.');
 return {team,sourceUrl,observedAt,rows};
}
function deriveStates(previousRecords,events,{team,asOf}){
 if(!Number.isFinite(Date.parse(asOf)))throw Error('State cutoff missing.');
 const groups=new Map();const unresolved=[];
 const incoming=events.filter(e=>e.team===team&&e.status&&['RESERVE_PLACEMENT','RESERVE_EXIT','DEPARTURE','MEMBERSHIP_ENTRY'].includes(e.kind));
 for(const e of incoming)if(e.identityVerified!==true||!Number.isFinite(Date.parse(e.publishedAt||e.observedAt))||Date.parse(e.publishedAt||e.observedAt)>Date.parse(asOf))unresolved.push({name:e.name,reason:'EVENT_IDENTITY_OR_CUTOFF_UNVERIFIED'});
 const eligible=incoming.filter(e=>e.identityVerified===true&&Number.isFinite(Date.parse(e.publishedAt||e.observedAt))&&Date.parse(e.publishedAt||e.observedAt)<=Date.parse(asOf));
 for(const e of [...previousRecords.filter(r=>r.team===team),...eligible]){
  if(!/^(IR|PUP|NFI|ACTIVE|DEPARTED)$/.test(e.status)||!/^\d{4}-\d{2}-\d{2}$/.test(e.reportedAt))continue;
  const k=key(e);if(!groups.has(k))groups.set(k,[]);groups.get(k).push({...e});
 }
 const states=[];
 for(const history of groups.values()){
  const newestDay=history.map(e=>e.reportedAt).sort().at(-1),latest=history.filter(e=>e.reportedAt===newestDay),statuses=[...new Set(latest.map(e=>e.status))];
  const latestRecord=latest.at(-1);
  if(statuses.length>1){states.push({...latestRecord,status:'CONFLICT',health:'UNKNOWN',membership:'UNKNOWN',history});continue;}
  const status=statuses[0];states.push({...latestRecord,status,health:status==='DEPARTED'?'UNKNOWN':status==='ACTIVE'?'RESERVE_EXIT_CONFIRMED':'RESERVE_RESTRICTION',membership:status==='DEPARTED'?'DEPARTURE_CONFIRMED':'TEAM_RECORDED',history});
 }
 return {team,asOf,states,unresolved,customerEligible:false};
}
function reconcileRoster(derived,snapshot){
 if(derived.team!==snapshot.team)throw Error('Reconciliation team mismatch.');
 if(!Number.isFinite(Date.parse(snapshot.observedAt))||Date.parse(snapshot.observedAt)>Date.parse(derived.asOf))throw Error('Roster is after reconciliation cutoff.');
 const gaps=[],matches=[];
 for(const player of snapshot.rows.filter(p=>['IR','PUP','NFI','RESERVE_RETURN_PROCESS','ACTIVE_ROSTER'].includes(p.status))){
  const state=derived.states.find(s=>key(s)===key(player));
  if(['IR','PUP','NFI','RESERVE_RETURN_PROCESS'].includes(player.status)){
   if(!state)gaps.push({name:player.name,reason:'RESERVE_WITHOUT_EVENT',rosterStatus:player.status});
   else if(player.status==='RESERVE_RETURN_PROCESS'?!['IR','PUP','NFI'].includes(state.status):state.status!==player.status)gaps.push({name:player.name,reason:'ROSTER_EVENT_CONFLICT',rosterStatus:player.status,eventStatus:state.status});
   else matches.push({name:player.name,status:state.status});
  }else if(state){
   if(state.status==='ACTIVE')matches.push({name:player.name,status:state.status});
   else gaps.push({name:player.name,reason:'ACTIVE_ROSTER_WITHOUT_EXPLICIT_EXIT_OR_NEW_MEMBERSHIP',eventStatus:state.status});
  }
 }
 for(const state of derived.states){
  if(state.status==='CONFLICT')gaps.push({name:state.name,reason:'CONFLICTING_DATED_EVENTS'});
  if(['IR','PUP','NFI','ACTIVE'].includes(state.status)&&!snapshot.rows.some(p=>key(p)===key(state)))gaps.push({name:state.name,reason:'EVENT_PLAYER_ABSENT_FROM_ROSTER_NOT_PROOF_OF_EXIT',eventStatus:state.status});
 }
 gaps.push(...derived.unresolved);
 return {team:derived.team,stateReconciled:gaps.length===0,matches,gaps,customerEligible:false};
}
module.exports={rosterSnapshot,deriveStates,reconcileRoster};
