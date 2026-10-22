'use strict';
const assert=require('node:assert/strict'),Module=require('node:module');
const {refreshDiagnostics}=require('../netlify/functions/_weekly-refresh-diagnostics');
const {canRetry}=require('../netlify/functions/_weekly-refresh-recovery');
async function main(){
 const now=Date.parse('2026-10-22T00:47:00Z');let reads=[],writes=0;
 const ledger={'day:2026-10-21':{day:'2026-10-21',updatedAt:'2026-10-21T22:30:00Z',reserved:650,normalReserved:600,injuryReserved:50,limit:700,normalLimit:600,jobs:{'refresh-weekly-projections':2}},'day:2026-10-22':{day:'2026-10-22',reserved:1,normalReserved:1,limit:700,normalLimit:600,jobs:{'refresh-weekly-projections':1}}};
 const getStore=({name})=>({get:async key=>{assert.equal(name,'tank01-daily-budget');reads.push(key);return ledger[key]||null;},setJSON:async()=>{writes++;throw Error('Unexpected write');}});
 const status={status:'ready',day:'2026-10-22',attempts:1,attemptLimit:8,startedAt:'2026-10-22T00:00:31Z',statusCode:200};
 const rows=[{job:'refresh-weekly-projections',store:'weekly-projections',ready:true,status}];
 const result=await refreshDiagnostics(getStore,rows,now);
 assert.equal(result.budgetDays[1].normalExhausted,true);assert.equal(result.budgetDays[1].totalExhausted,false);assert.equal(result.budgetDays[0].normalExhausted,false);assert.equal(result.budgetDays[1].projectionReservations,2);
 assert.equal(result.historicalJobFailuresAvailable,false);assert.deepEqual(reads,['day:2026-10-22','day:2026-10-21']);assert.equal(writes,0);
 const full={...status,day:'2026-10-21',attempts:8};assert.equal(canRetry(full,Date.parse('2026-10-21T23:59:59Z')),false);assert.equal(canRetry(full,Date.parse('2026-10-22T00:00:00Z')),true,'UTC reset can revive a retry-exhausted job without a code change');
 delete ledger['day:2026-10-21'];ledger['day:2026-10-22']={reserved:1,limit:null,normalLimit:null};
 const unknown=await refreshDiagnostics(getStore,[],now);assert.equal(unknown.budgetDays[0].normalExhausted,null);assert.equal(unknown.budgetDays[0].totalExhausted,null);assert.equal(unknown.budgetDays[1].available,false);
 const original=Module._load;let allowed=false,connected=0,lookups=0;
 Module._load=function(name,parent,main){
  if(name==='@netlify/blobs')return {connectLambda:()=>{connected++;},getStore:args=>{lookups++;return getStore(args);}};
  if(name==='./_injury-workflow-auth')return {verifyWorkflowToken:async token=>allowed&&token==='test-only-identity'};
  if(name==='./_weekly-refresh-recovery.js')return {inspectJobs:async()=>rows,resolveCurrentNFLWeek:()=>7};
  return original.call(this,name,parent,main);
 };
 try{
  delete require.cache[require.resolve('../netlify/functions/weekly-sage-status')];const endpoint=require('../netlify/functions/weekly-sage-status');
  const query={httpMethod:'GET',queryStringParameters:{diagnostics:'refresh'}};
  assert.equal((await endpoint.handler(query)).statusCode,401);assert.equal(connected,0);assert.equal(lookups,0);
  assert.equal((await endpoint.handler({...query,headers:{Authorization:'Bearer invalid'}})).statusCode,401);
  allowed=true;
  const response=await endpoint.handler({...query,headers:{Authorization:'Bearer test-only-identity'}});assert.equal(response.statusCode,200);assert.equal(response.headers['Cache-Control'],'no-store');assert(Array.isArray(JSON.parse(response.body).budgetDays));assert.equal(writes,0);
  assert.equal((await endpoint.handler({...query,httpMethod:'POST'})).statusCode,405);
 }finally{Module._load=original;}
 console.log('PASS: authenticated read-only current/prior UTC budget and retry diagnosis; no provider calls or state writes; unknown history stays unknown.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
