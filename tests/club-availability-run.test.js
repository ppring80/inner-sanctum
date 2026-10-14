'use strict';
const assert=require('node:assert/strict');
const {runCollection,summarize}=require('../netlify/functions/_club-availability-run');
const clubs=require('../netlify/functions/_official-club-sources.json');
const now=Date.parse('2026-10-13T05:00:00Z');
function fakeStore(seed={}){
 const data=new Map(Object.entries(seed)),writes=[];let etag=0;
 return {data,writes,get:async key=>data.get(key)||null,getWithMetadata:async key=>data.has(key)?{data:data.get(key),etag:String(etag)}:null,setJSON:async(key,value,options={})=>{
  if(options.onlyIfNew&&data.has(key))return {modified:false};
  if(options.onlyIfMatch&&options.onlyIfMatch!==String(etag))return {modified:false};
  data.set(key,JSON.parse(JSON.stringify(value)));etag++;writes.push(key);return {modified:true};
 }};
}
function input(club,discoveryComplete=true){return {snapshot:{team:club.team,sourceUrl:club.origin+'/team/players-roster/',observedAt:new Date(now).toISOString(),rows:[{name:'Observed Player',team:club.team,position:'RB',profileUrl:club.origin+'/team/players-roster/observed-player/',section:'Reserve/Injured',status:'IR'}]},events:[],discoveryComplete};}
(async()=>{
 const club=clubs[0],old={asOf:'2026-10-13T04:00:00Z',coveragePassed:true,players:[{name:'Old Player'}]};
 const seed={latest:{checkedAt:old.asOf,teams:{[club.team]:old}}};
 const failed=fakeStore(seed),frozen=JSON.stringify(seed.latest);
 const result=await runCollection({store:failed,season:2026,now:()=>now,adapters:{[club.team]:async()=>input(club,false)}});
 assert.equal(JSON.stringify(failed.data.get('latest')),frozen);assert.ok(!failed.writes.includes('latest'));
 assert.equal(failed.data.get('observations').teams[club.team].discoveryComplete,false);
 assert.equal(failed.data.get('observations').teams[club.team].players[0].status,'IR');
 assert.equal(failed.data.get('observations').teams[club.team].players[0].placementDate,null);
 assert.equal(result.summary.fresh,false);assert.equal(result.summary.customerReadsEnabled,false);assert.equal(failed.data.get('collection-lease').until,0);
 assert.ok(failed.writes.some(k=>k.startsWith('runs/')&&k.endsWith('/'+club.team)));
 const partial=fakeStore(seed);
 const qualified=await runCollection({store:partial,season:2026,now:()=>now,adapters:{[club.team]:async()=>input(club)}});
 assert.equal(partial.data.get('latest').teams[club.team].players[0].placementDate,null);
 assert.equal(qualified.summary.coveredTeams.length,1);assert.equal(qualified.summary.coveragePassed,false);assert.equal(qualified.summary.fresh,false);
 const historicalEvent={name:'Observed Player',team:club.team,position:'RB',kind:'RESERVE_PLACEMENT',status:'IR',reportedAt:'2026-09-25',observedAt:old.asOf,sourceUrl:club.origin+'/news/placement',identityVerified:true};
 const priorHistory=fakeStore({latest:{teams:{[club.team]:{...old,players:[{name:'Observed Player',provenance:[historicalEvent]}]}}}});
 await runCollection({store:priorHistory,season:2026,now:()=>now,adapters:{[club.team]:async()=>{const r=input(club);r.snapshot.rows[0].section='Reserve/Designated to Return';r.snapshot.rows[0].status='RESERVE_RETURN_PROCESS';return r;}}});
 assert.equal(priorHistory.data.get('latest').teams[club.team].players[0].placementDate,'2026-09-25');
 assert.equal(priorHistory.data.get('latest').teams[club.team].coveragePassed,true);
 const quarantined={teams:{[club.team]:{...old,discovery:{quarantined:[{name:'Unknown Player',status:null}]}}}};
 assert.equal(summarize(quarantined,{error:null},{now}).teams[0].quarantinedClaims[0].status,null);
 const active=fakeStore({'collection-lease':{owner:'other',until:now+60000}});let calls=0;
 assert.equal((await runCollection({store:active,season:2026,now:()=>now,adapters:{[club.team]:async()=>{calls++;}}})).reason,'COLLECTION_IN_PROGRESS');assert.equal(calls,0);
 const budget=fakeStore();let fetched=0;
 const bounded=await runCollection({store:budget,season:2026,now:()=>now,maxRequests:1,minIntervalMs:0,fetchImpl:async()=>{fetched++;return {ok:true,text:async()=>'<html>'};},adapters:{[club.team]:async({read})=>{await read(club.origin+'/team/players-roster/');await read(club.origin+'/news/');return input(club);}}});
 assert.equal(fetched,1);assert.match(bounded.health.teams[0].error,/budget/);assert.ok(!budget.writes.includes('latest'));
 // A deadline on a later club must not discard an earlier qualified checkpoint.
 let clock=now;
 const checkpoint=fakeStore();
 const first=clubs[0],second=clubs[1];
 const timed=await runCollection({store:checkpoint,season:2026,now:()=>clock,deadlineMs:100,
  adapters:{[first.team]:async()=>input(first),[second.team]:async()=>{clock+=100;throw Error('Slow source');}}});
 assert.equal(checkpoint.data.get('latest').teams[first.team].coveragePassed,true);
 assert.equal(timed.summary.fresh,false);
 assert.ok(timed.health.deferredTeams.length>0);
 assert.match(timed.health.error,/checkpoints preserved/);
 // Missing teams run before recent successes, and the next bounded run advances.
 const rotation=fakeStore({latest:{teams:{[first.team]:{...old,asOf:new Date(now).toISOString()}}}});
 const order=[];
 const limitedAdapters=Object.fromEntries(clubs.map(c=>[c.team,async({read})=>{
  order.push(c.team);await read(c.origin+'/news/');return input(c);
 }]));
 const rotationOptions={store:rotation,season:2026,now:()=>now,maxRequests:1,minIntervalMs:0,
  fetchImpl:async()=>({ok:true,text:async()=>'<html>'}),adapters:limitedAdapters};
 await runCollection(rotationOptions);
 assert.equal(order[0],second.team);
 await runCollection(rotationOptions);
 assert.equal(order[1],clubs[2].team);
 assert.equal(rotation.data.get('latest').teams[first.team].asOf,new Date(now).toISOString());
 // Cheap roster evidence is checkpointed league-wide before a long news probe.
 const section=(label,name)=>'<h4 class="nfl-o-roster__title"><span class="nfl-o-roster__title-status">'+label+'</span></h4><table><thead><tr><th>Player</th><th>Pos</th></tr></thead><tbody><tr><td><a href="/team/players-roster/'+name.toLowerCase().replace(/ /g,'-')+'/" title="'+name+'">'+name+'</a></td><td>RB</td></tr></tbody></table>';
 const rosterHtml=section('Active','Active Player')+section('Reserve/Injured','Observed Player');
 const rosterStore=fakeStore();let rosterFetches=0,newsFetches=0;
 const firstPass=await runCollection({store:rosterStore,season:2026,now:()=>now,rosterFirst:true,maxRequests:33,minIntervalMs:0,
  fetchImpl:async url=>{if(url.endsWith('/news/')){newsFetches++;return {ok:false,status:502};}rosterFetches++;return {ok:true,text:async()=>rosterHtml};},
  adapters:{[first.team]:async({read})=>{await read(first.origin+'/team/players-roster/');await read(first.origin+'/news/');throw Error('Never reached');}}});
 assert.equal(rosterFetches,32);assert.equal(newsFetches,1);
 assert.equal(Object.keys(rosterStore.data.get('observations').teams).length,32);
 assert.equal(rosterStore.data.get('observations').teams[first.team].players.find(p=>p.name==='Observed Player').placementDate,null);
 assert.equal(firstPass.summary.fresh,false);assert.equal(firstPass.summary.coveragePassed,false);
 assert.equal(rosterStore.data.has('latest'),false,'Roster observations never overwrite qualified history');
 const retainedObservations=JSON.stringify(rosterStore.data.get('observations').teams[first.team]);
 await runCollection({store:rosterStore,season:2026,now:()=>now+1000,rosterFirst:true,maxRequests:1,minIntervalMs:0,fetchImpl:async()=>({ok:true,text:async()=>'<html>layout changed</html>'})});
 assert.equal(JSON.stringify(rosterStore.data.get('observations').teams[first.team]),retainedObservations,'A changed roster page preserves the prior observation and timestamp');
 const all={teams:Object.fromEntries(clubs.map(c=>[c.team,{...old,coveragePassed:true}]))};
 assert.equal(summarize(all,{error:'failed'},{enabled:true,now}).fresh,false);
 assert.equal(summarize(all,{error:'failed'},{enabled:true,now}).coveragePassed,false);
 assert.equal(summarize(all,{error:null},{enabled:false,now}).fresh,false);
 console.log('PASS: per-team qualified persistence, immutable last success, incomplete runs, independent history, lease ownership, request budget and honest activation status.');
})().catch(e=>{console.error(e);process.exitCode=1;});
