'use strict';
const {randomUUID}=require('node:crypto');
const clubs=require('./_official-club-sources.json');
const {currentClubAvailability}=require('./_current-club-availability');
const STORE='official-club-availability';
const TTL=2*3600000;
function summarize(latest,health,{enabled=false,customerReadsEnabled=false,now=Date.now()}={}){
 const teams=clubs.map(club=>{
  const r=latest?.teams?.[club.team],attempt=health?.teams?.find(t=>t.team===club.team);
  const age=now-Date.parse(r?.asOf||'');
  const fresh=Number.isFinite(age)&&age>=0&&age<TTL&&r?.coveragePassed===true;
  return {team:club.team,checkedAt:r?.asOf||null,fresh,coveragePassed:fresh,
   lastAttempt:attempt?.lastAttempt||null,error:attempt?.error||null,
   conflicts:attempt?.conflicts||0,players:r?.players?.length||0,quarantinedClaims:r?.discovery?.quarantined||[]};
 });
 return {enabled,customerReadsEnabled:enabled&&customerReadsEnabled,coverageMode:'PER_PLAYER_RESERVE_SAFETY',checkedAt:latest?.checkedAt||null,
  fresh:enabled&&health?.error===null&&teams.every(t=>t.fresh),coveragePassed:health?.error===null&&teams.every(t=>t.coveragePassed),
  coveredTeams:teams.filter(t=>t.fresh).map(t=>t.team),requiredTeams:clubs.length,
  teams,health:health||null};
}
async function runCollection({store,adapters={},previousRecords=[],season,rosterFirst=false,now=()=>Date.now(),maxRequests=360,deadlineMs=12*60000,minIntervalMs=1000,fetchImpl=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 const started=now(),owner=randomUUID(),runId=new Date(started).toISOString()+'-'+owner;
 const lease=await store.getWithMetadata('collection-lease',{type:'json'});
 if(lease?.data?.until>started)return {skipped:true,reason:'COLLECTION_IN_PROGRESS'};
 const claim=await store.setJSON('collection-lease',{owner,until:started+deadlineMs+60000},lease?{onlyIfMatch:lease.etag}:{onlyIfNew:true});
 if(!claim.modified)return {skipped:true,reason:'COLLECTION_IN_PROGRESS'};
 let requests=0,lastStart=null;
 const health={runId,lastAttempt:new Date(started).toISOString(),error:null,teams:[],requests:0};
 try{
  const prior=await store.get('latest',{type:'json'});
  const previousObservations=await store.get('observations',{type:'json'});
  const observations={version:1,teams:{...(previousObservations?.teams||{})}};
  const rosterPages=new Map();
  // A private copy preserves every previously qualified team when another fails.
  const latest={version:1,checkedAt:prior?.checkedAt||null,teams:{...(prior?.teams||{})}};
  async function read(url,team){
   require('./_official-club-transactions').officialUrl(url,team);
   if(rosterPages.has(url))return rosterPages.get(url).html;
   if(requests>=maxRequests||now()-started>=deadlineMs)throw Error('Club collection budget exhausted.');
   if(lastStart!==null){const delay=Math.max(0,minIntervalMs-(now()-lastStart));if(delay)await sleep(delay);}
   const remaining=deadlineMs-(now()-started);
   if(remaining<=0)throw Error('Club collection deadline exceeded.');
   lastStart=now();requests++;
   const response=await fetchImpl(url,{redirect:'manual',signal:AbortSignal.timeout(Math.max(1,Math.min(12000,Math.ceil(remaining))))});
   if(!response.ok)throw Error('Official club HTTP '+response.status);
   const html=await response.text();
   if(now()-started>=deadlineMs)throw Error('Club collection deadline exceeded.');
   return html;
  }
  if(rosterFirst){
   // Read present reserve restrictions for every club before spending the
   // remaining budget on longer announcement histories. These observations
   // never establish activations and do not claim full discovery coverage.
   health.rosterAttempts=[];
   for(const club of clubs){
    if(requests>=maxRequests||now()-started>=deadlineMs)break;
    const sourceUrl=club.origin+'/team/players-roster/';
    const attempt={team:club.team,error:null};
    try{
     const html=await read(sourceUrl,club.team),observedAt=new Date(now()).toISOString();
     const snapshot=require('./_club-availability-reconciliation').rosterSnapshot(html,{team:club.team,sourceUrl,observedAt});
     rosterPages.set(sourceUrl,{html,observedAt});
     const history=(prior?.teams?.[club.team]?.players||[]).flatMap(player=>player.provenance||[]).filter(event=>event.reportedAt&&event.status);
     const report=currentClubAvailability({team:club.team,season,asOf:observedAt,snapshot,previousRecords:[...previousRecords,...history],discoveryComplete:false});
     await store.setJSON('runs/'+runId+'/roster/'+club.team,report,{onlyIfNew:true});
     if(now()-started>=deadlineMs)throw Error('Club collection deadline exceeded before observation persistence.');
     if(report.collectionHealthy){observations.teams[club.team]=report;await store.setJSON('observations',observations);}
     else throw Error('Official roster observation contract incomplete.');
    }catch(error){attempt.error=error.message;}
    health.rosterAttempts.push(attempt);
   }
  }
  // Missing and oldest evidence goes first so repeated bounded runs cannot
  // permanently starve the clubs at the end of the registry.
  const pending=[...clubs].sort((a,b)=>{
   const age=c=>{const r=prior?.teams?.[c.team];return r?.coveragePassed===true?(Date.parse(r.asOf)||0):0;};
   return age(a)-age(b);
  });
  for(const club of pending){
   if(requests>=maxRequests||now()-started>=deadlineMs)break;
   const attempt={team:club.team,lastAttempt:new Date(now()).toISOString(),error:null,conflicts:0};
   try{
    const adapter=adapters[club.team];
    if(typeof adapter!=='function')throw Error('Announcement discovery adapter not qualified.');
    const input=await adapter({club,read:url=>read(url,club.team),previous:prior?.teams?.[club.team]||null,season,asOf:new Date(now()).toISOString()});
    const cachedRoster=rosterPages.get(input.snapshot?.sourceUrl);
    if(cachedRoster)input.snapshot={...input.snapshot,observedAt:cachedRoster.observedAt,rows:input.snapshot.rows.map(row=>({...row,observedAt:cachedRoster.observedAt}))};
    const asOf=new Date(now()).toISOString();
    const preservedHistory=(prior?.teams?.[club.team]?.players||[]).flatMap(p=>p.provenance||[]).filter(e=>e.team===club.team&&e.reportedAt&&e.status);
    const report=currentClubAvailability({team:club.team,season,asOf,snapshot:input.snapshot,previousRecords:[...previousRecords,...preservedHistory],events:input.events||[],discoveryComplete:input.discoveryComplete===true});
    report.discovery=input.discovery||null;
    attempt.conflicts=report.players.filter(p=>p.conflicts.length).length;
    attempt.diagnostics=report.diagnostics;
    // Persist each attempt independently for audit, including incomplete evidence.
    await store.setJSON('runs/'+runId+'/'+club.team,report,{onlyIfNew:true});
    if(now()-started>=deadlineMs)throw Error('Club collection deadline exceeded before persistence.');
    // Preserve a fully parsed current observation independently of league-wide
    // discovery. It can support keeping a reserve restriction, not an inferred
    // activation. Last qualified results and frozen NFL history stay untouched.
    if(report.collectionHealthy){
     observations.teams[club.team]=report;
     await store.setJSON('observations',observations);
    }
    if(!report.coveragePassed)throw Error('Official club coverage incomplete.');
    latest.teams[club.team]=report;
    latest.checkedAt=asOf;
    // Checkpoint each qualified team while inside the deadline. A later failure
    // preserves this evidence without promoting incomplete league coverage.
    await store.setJSON('latest',latest);
   }catch(error){attempt.error=error.message;}
   health.teams.push(attempt);
  }
  health.requests=requests;
  const coverage=summarize(latest,{error:null},{enabled:true,now:now()});
  health.error=health.teams.some(t=>t.error)||!coverage.coveragePassed?'Official club coverage incomplete.':null;
  health.deferredTeams=pending.filter(c=>!health.teams.some(t=>t.team===c.team)).map(c=>c.team);
  if(now()-started>=deadlineMs)health.error='Club collection deadline exceeded; qualified checkpoints preserved.';
  await store.setJSON('health',health);
  await store.setJSON('runs/'+runId+'/health',health,{onlyIfNew:true});
  return {runId,requests,health,summary:summarize(latest,health,{enabled:true,now:now()})};
 }finally{
  try{
   const current=await store.getWithMetadata('collection-lease',{type:'json'});
   if(current?.data?.owner===owner)await store.setJSON('collection-lease',{owner,until:0},{onlyIfMatch:current.etag});
  }catch{/* A failed release expires at the bounded lease deadline. */}
 }
}
module.exports={STORE,summarize,runCollection};
