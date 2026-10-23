'use strict';
const assert=require('node:assert/strict');
const {sources,discover,collectRoleSources,MAX_ARTICLES,MAX_BYTES}=require('../netlify/functions/_role-report-collection');
const {refresh}=require('../netlify/functions/refresh-role-evidence');
const {jobsForWeek,cacheKey,completeCache,nextJob,runJob}=require('../netlify/functions/_weekly-refresh-recovery');
const NOW=Date.parse('2026-10-23T02:45:00Z');
const source={url:'https://www.giants.com/news/',team:'NYG'},url='https://www.giants.com/news/mccarthy-to-start';
const html='<script type="application/ld+json">'+JSON.stringify({'@type':'NewsArticle',url,headline:'Giants starting quarterback',datePublished:'2026-10-22T16:43:00Z',dateModified:'2026-10-22T16:43:43.232Z',articleBody:"J.J. McCarthy will be the Giants' starting quarterback."})+'</script>';
const index='<a href="'+url+'">Quarterback starter</a>';
const response=(body,status=200)=>({ok:status===200,status,text:async()=>body});
(async()=>{
 assert.equal(MAX_ARTICLES,32);assert.equal(sources.length,34);assert.equal(new Set(sources.map(s=>s.team).filter(Boolean)).size,32);
 const dirty=Array.from({length:6},(_,i)=>'<a href="/news/fantasy-start-em-sit-em-'+i+'">Start em</a>').join('')+index+'<a href="https://evil.example/news/new-starter">Starter</a><a href="/news/new-starter?secret=yes">Starter</a>';
 assert.deepEqual(discover(dirty,source).map(c=>c.url),[url]);
 let requests=[];const collected=await collectRoleSources(async target=>{requests.push(target);return response(target===source.url?dirty:html);},{indexes:[source]});
 assert.equal(requests.length,2);assert.equal(collected.items.length,1);assert.equal(collected.collection.omittedByArticleLimit,0);
 let active=0,maxActive=0;
 const many=await collectRoleSources(async(target,options)=>{
  assert.equal(options.redirect,'error');active++;maxActive=Math.max(maxActive,active);await Promise.resolve();active--;
  if(target.endsWith('/news/'))return response(Array.from({length:40},(_,i)=>'<a href="/news/starter-'+i+'">Starter</a>').join(''));
  return response('',403);
 },{indexes:sources.filter(s=>s.team).slice(0,5)});
 assert.equal(many.collection.articlesAttempted,MAX_ARTICLES);assert(many.collection.omittedByArticleLimit>0);assert(maxActive<=4);
 assert(many.collection.errors.every(e=>e.error==='HTTP 403'));assert.equal(many.items.length,0);
 const oversized=await collectRoleSources(async()=>({ok:true,headers:{get:()=>String(MAX_BYTES+1)}}),{indexes:[source]});assert.equal(oversized.collection.indexesSucceeded,0);assert.match(oversized.collection.errors[0].error,/size limit/);
 const stores=new Map();let writes=0;
 const getStore=({name})=>{if(!stores.has(name)){let data=null,etag=0;stores.set(name,{get:async()=>data,getWithMetadata:async()=>data?{data:structuredClone(data),etag:String(etag)}:null,setJSON:async(k,next,opts={})=>{if(opts.onlyIfNew&&data||opts.onlyIfMatch&&opts.onlyIfMatch!==String(etag))return{modified:false};writes++;data=structuredClone(next);etag++;return{modified:true};}});}return stores.get(name);};
 const player={updatedAt:new Date(NOW).toISOString(),players:{one:{longName:'J.J. McCarthy',team:'NYG',pos:'QB'}}};
 await getStore({name:'player-data'}).setJSON('playerData',player);
 let calls=0;const collect=async(_,options)=>{calls++;assert.equal(options.now,NOW);assert.equal(options.previousCollection,undefined);return collected;};
 const first=await refresh({getStore,collect,season:2026,now:NOW});assert.equal(first.cached,true);assert.equal(calls,1);
 const saved=await getStore({name:'sage-role-events'}).get('season:2026');assert(saved.events.some(e=>e.player==='J.J. McCarthy'));assert.equal(saved.dedicatedCollection.indexesSucceeded,1);
 assert.equal((await refresh({getStore,collect,season:2026,now:NOW+60000})).skipped,true);assert.equal(calls,1,'Six-hour collection deduplication');
 await assert.rejects(refresh({getStore,collect,season:2026,now:NOW+9*3600000}),/Fresh player identity/);assert.equal(calls,1,'Stale identity prevents public fanout');
 await getStore({name:'player-data'}).setJSON('playerData',{...player,updatedAt:new Date(NOW+9*3600000).toISOString()});
 await assert.rejects(refresh({getStore,collect:async()=>({items:[],collection:{indexesSucceeded:0}}),season:2026,now:NOW+9*3600000}),/No role sources/);
 assert.deepEqual(await getStore({name:'sage-role-events'}).get('season:2026'),saved,'Outage preserves evidence and last successful health');
 const job=jobsForWeek(2026,7).find(j=>j.store==='sage-role-events');assert(job.optional);assert.equal(cacheKey(job),'season:2026');assert(completeCache(saved,job,NOW));assert(!completeCache(saved,job,NOW+6*3600000));
 const blocked={store:'weekly-sage-defense',ready:false,status:{day:'2026-10-23',attempts:2,attemptLimit:2}};
 assert.equal(nextJob([blocked,{...job,ready:false}],NOW).store,'sage-role-events','Role collection cannot be starved by ranking backfill');
 // Shared lease/retry machinery, eight bounded attempts; no provider imported.
 const result=await runJob(job,{}, {getStore,now:NOW+6*3600000,build:async()=>({statusCode:502,body:JSON.stringify({error:'Fixture outage'})})});assert.equal(result.attemptLimit,8);assert.equal(result.status,'failed');
 const handler=require('../netlify/functions/refresh-role-evidence').handler;assert.equal((await handler({httpMethod:'GET'})).statusCode,401);assert.equal((await handler({httpMethod:'POST',body:'{}'})).statusCode,401);
 await isolation();
 console.log('PASS: separate 34-source discovery, fantasy isolation, bounded concurrency/requests/bytes, publisher failures, identity gate, no-call deduplication, optional readiness and shared leases/retries.');
})().catch(error=>{console.error(error);process.exitCode=1;});

async function isolation(){
 const fs=require('node:fs'),vm=require('node:vm');
 const role={job:'refresh-role-evidence',store:'sage-role-events',week:7,season:'2026',seasonType:'reg',optional:true,ready:false},news={job:'refresh-sage-newswire',store:'sage-newswire',week:7,season:'2026',seasonType:'reg',ready:true};
 let completed=[],inspected=0;
 const recovery={jobsForWeek:()=>[role,news],verify:()=>true,inspectJobs:async()=>++inspected===1?[role]:[],nextJob:()=>completed.length===1?news:null,runJob:async j=>{completed.push(j.job);return{status:j.optional?'failed':'ready'};}};
 function load(file,inspect=()=>{}){
  const sandbox={exports:{},URL,Date,process,require:p=>p==='@netlify/blobs'?{connectLambda(){},getStore:()=>({get:async()=>null})}:p==='./_weekly-refresh-recovery.js'?{...recovery,...inspect}:file==='weekly-sage-refresh-background.js'?{handler(){}}:require('../netlify/functions/'+p)};
  vm.runInNewContext(fs.readFileSync('netlify/functions/'+file,'utf8'),sandbox);return sandbox.exports;
 }
 const saved=process.env.URL;process.env.URL='https://fixture.invalid';
 try{
  await load('weekly-sage-refresh-background.js').handler({httpMethod:'POST',body:JSON.stringify({job:role.job,week:7,season:2026,targetWeek:7}),headers:{}});
  assert.deepEqual(completed,[role.job,news.job],'Optional role failure cannot block the following Newswire build');
  const endpoint=load('weekly-sage-status.js',{inspectJobs:async()=>[role,news],resolveCurrentNFLWeek:()=>7});
  const result=await endpoint.handler({httpMethod:'GET'});assert.equal(result.statusCode,200,'Optional evidence failure cannot take core rankings offline');
  const status=JSON.parse(result.body);assert.equal(status.ready,true);assert.equal(status.jobs[0].ready,false);assert.equal(status.jobs[0].optional,true);
 }finally{if(saved===undefined)delete process.env.URL;else process.env.URL=saved;}
}
