'use strict';
const assert=require('node:assert/strict');
const {startClubCollection}=require('../scripts/start-club-evidence-collection');
const now=Date.parse('2026-10-14T05:00:00Z');
async function run(club,status=202){const calls=[];const result=await startClubCollection({token:'test-only-identity',now,fetchImpl:async(url,options)=>{
 calls.push({url,options});return calls.length===1?{ok:true,json:async()=>({clubAvailability:club})}:{status};
 }});return {result,calls};}
(async()=>{
 const disabled=await run({enabled:false});assert.equal(disabled.calls.length,1);assert.equal(disabled.result.requested,false);
 const recent=await run({enabled:true,observations:{freshRosterCoverage:true,oldestObservedAt:'2026-10-14T04:20:00Z'}});assert.equal(recent.calls.length,1);
 for(const club of [{enabled:true,customerReadsEnabled:false},{enabled:true,observations:{freshRosterCoverage:false,oldestObservedAt:'2026-10-14T04:55:00Z'}},{enabled:true,observations:{freshRosterCoverage:true,oldestObservedAt:'2026-10-14T04:00:00Z'}}]){
  const {result,calls}=await run(club);assert.equal(calls.length,2);assert.equal(calls[1].options.method,'POST');
  assert.equal(calls[1].url,'https://theinnersanctum.xyz/.netlify/functions/refresh-club-availability-background');
  assert.equal(calls[1].options.headers.Authorization,'Bearer test-only-identity');assert.equal(result.collectionVerified,false);assert.equal(result.accepted,true);
  assert.ok(!calls.some(call=>/tank01|anthropic|rookie/.test(call.url)));
 }
 await assert.rejects(()=>run({enabled:true},401),/not accepted/);
 await assert.rejects(()=>startClubCollection({token:''}),/identity token missing/);
 const unavailable=await startClubCollection({token:'test-only',fetchImpl:async()=>({ok:false})});assert.equal(unavailable.requested,false);
 const source=require('fs').readFileSync(require('path').join(__dirname,'../scripts/refresh-injury-evidence-workflow.js'),'utf8');
 assert.ok(source.includes("startClubCollection({token:value})"));assert.ok(source.includes('await recover({token:value})'),'Primary NFL recovery remains intact');
 console.log('PASS: existing workflow identity starts only the enabled official-club collector, preserves primary recovery, respects recent observations, and never calls paid providers or claims completion.');
})().catch(error=>{console.error(error);process.exitCode=1;});
