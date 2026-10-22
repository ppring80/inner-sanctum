'use strict';
const assert=require('node:assert/strict');
const {reserveTank01Calls,PROJECTION_RESERVE,projectionProtection}=require('../netlify/functions/_tank01-daily-budget');
const {runJob,stateKey}=require('../netlify/functions/_weekly-refresh-recovery');
function memory(){
 const data=new Map();let revision=0;
 return {data,get:async k=>data.get(k)?.data||null,getWithMetadata:async k=>{const v=data.get(k);return v?structuredClone(v):null;},setJSON:async(k,next,options={})=>{
  const old=data.get(k);if(options.onlyIfNew&&old||options.onlyIfMatch&&old?.etag!==options.onlyIfMatch)return {modified:false};
  data.set(k,{data:structuredClone(next),etag:String(++revision)});return {modified:true};
 }};
}
async function main(){
 assert.equal(PROJECTION_RESERVE,8);for(const invalid of ['bad',Infinity,-1,1.5])assert.equal(projectionProtection({projectionReserved:invalid},600).remaining,8);const now=new Date('2026-10-22T04:00:00Z'),key='day:2026-10-22';
 const store=memory(),deps={store,limit:700,normalLimit:600,now};
 const normal=async calls=>reserveTank01Calls({}, {job:'backfill',calls},deps);
 const projection=async(calls=1)=>reserveTank01Calls({}, {job:'refresh-weekly-projections',calls},deps);
 assert((await normal(592)).allowed);assert.equal((await normal(1)).reason,'projection-reserve');
 for(let i=0;i<8;i++)assert((await projection()).allowed);
 assert.equal((await store.get(key)).normalReserved,600);assert.equal((await projection()).reason,'daily-limit');
 assert((await reserveTank01Calls({}, {job:'injuries',calls:100,priority:'injury'},deps)).allowed);assert.equal((await store.get(key)).reserved,700);
 assert.equal((await reserveTank01Calls({}, {job:'injuries',calls:1,priority:'injury'},deps)).reason,'daily-limit');
 // Injury priority is unchanged, including its right to use the total budget
 // when urgent work exhausts it. A projection reserve cannot bypass that cap.
 const urgent=memory();await urgent.setJSON(key,{reserved:699,normalReserved:592,injuryReserved:107,jobs:{}});
 assert((await reserveTank01Calls({}, {job:'injuries',calls:1,priority:'injury'},{...deps,store:urgent})).allowed);
 assert.equal((await reserveTank01Calls({}, {job:'refresh-weekly-projections',calls:1},{...deps,store:urgent})).reason,'daily-limit');
 // Competing real CAS claims at the boundary cannot steal the protected calls.
 const race=memory();await race.setJSON(key,{reserved:598,normalReserved:598,injuryReserved:0,projectionReserved:6,jobs:{'refresh-weekly-projections':6}});
 const raced=await Promise.all([
  ...Array.from({length:12},()=>reserveTank01Calls({}, {job:'refresh-weekly-projections',calls:1},{...deps,store:race})),
  ...Array.from({length:8},()=>reserveTank01Calls({}, {job:'backfill',calls:1},{...deps,store:race})),
  ...Array.from({length:3},()=>reserveTank01Calls({}, {job:'injuries',calls:33,priority:'injury'},{...deps,store:race}))
 ]);
 const end=await race.get(key);assert.equal(end.normalReserved,600);assert.equal(end.projectionReserved,8);assert.equal(end.injuryReserved,99);assert.equal(end.reserved,699);
 assert.equal(raced.filter(r=>r.allowed&&r.job==='backfill').length,0);
 const stale={getWithMetadata:async()=>({data:{reserved:0},etag:'stale'}),setJSON:async()=>({modified:false})};
 assert.equal((await reserveTank01Calls({}, {job:'refresh-weekly-projections',calls:1},{...deps,store:stale})).reason,'reservation-contention');
 // Already spent calls are never refunded or relabelled during deployment.
 const legacy=memory();await legacy.setJSON(key,{reserved:600,jobs:{'refresh-weekly-projections':7}});
 assert.equal((await reserveTank01Calls({}, {job:'refresh-weekly-projections',calls:1},{...deps,store:legacy})).reason,'daily-limit');assert.equal((await legacy.get(key)).reserved,600);
 const nextDay={...deps,store:legacy,now:new Date('2026-10-23T00:00:00Z')};assert((await reserveTank01Calls({}, {job:'backfill',calls:592},nextDay)).allowed);assert((await reserveTank01Calls({}, {job:'refresh-weekly-projections',calls:1},nextDay)).allowed);
 assert.equal((await legacy.get('day:2026-10-23')).projectionReserved,1);assert.equal((await legacy.get(key)).reserved,600);
 const small=memory();assert((await reserveTank01Calls({}, {job:'backfill',calls:2},{...deps,store:small,limit:10,normalLimit:10})).allowed);assert.equal((await reserveTank01Calls({}, {job:'backfill',calls:1},{...deps,store:small,limit:10,normalLimit:10})).reason,'projection-reserve');
 assert.equal((await reserveTank01Calls({}, {job:'refresh-weekly-projections',calls:1},{...deps,killSwitch:true})).reason,'kill-switch');
 const capped=memory();assert((await reserveTank01Calls({}, {job:'refresh-weekly-projections',calls:1,maxJobCalls:1},{...deps,store:capped})).allowed);assert.equal((await reserveTank01Calls({}, {job:'refresh-weekly-projections',calls:1,maxJobCalls:1},{...deps,store:capped})).reason,'job-daily-limit');
 // Legacy non-production store adapters obey the same partition.
 const fallback={get:async()=>null},f={...deps,store:fallback,now:new Date('2026-11-02T00:00:00Z')};
 assert((await reserveTank01Calls({}, {job:'backfill',calls:592},f)).allowed);assert.equal((await reserveTank01Calls({}, {job:'backfill',calls:1},f)).reason,'projection-reserve');assert((await reserveTank01Calls({}, {job:'refresh-weekly-projections',calls:8},f)).allowed);
 // Latest failures survive successful rollover, without resetting retry limits.
 const stores=new Map(),getStore=({name})=>{if(!stores.has(name))stores.set(name,memory());return stores.get(name);};
 const job={job:'refresh-weekly-projections',store:'weekly-projections',season:'2026',week:7,seasonType:'reg'},clock=Date.parse('2026-10-21T22:00:00Z');let builds=0;
 const fail=async()=>{builds++;return {statusCode:429,body:JSON.stringify({error:'Protected calls unavailable',budget:{reason:'daily-limit'}})};};
 const failed=await runJob(job,{}, {getStore,build:fail,now:clock});assert.equal(failed.attemptLimit,8);assert.equal(failed.attempts,1);
 await runJob(job,{}, {getStore,build:fail,now:clock+60000});assert.equal(builds,1);
 const ready=await runJob(job,{}, {getStore,build:async()=>({statusCode:200,body:JSON.stringify({cached:true})}),now:clock+3*3600000});
 assert.equal(ready.status,'ready');assert.equal(ready.attempts,1);assert.equal(ready.lastFailure.day,'2026-10-21');assert.equal(ready.lastFailure.budgetReason,'daily-limit');assert.equal(ready.lastFailure.statusCode,429);
 console.log('PASS: projection reserve, injury priority, total/normal caps, CAS concurrency, stale reads, legacy migration, UTC rollover, retry cooldown and retained failure evidence.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
