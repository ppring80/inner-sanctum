'use strict';
const assert=require('node:assert/strict');
const {_test:{providerSnapshotFreshness,guardStaleSnapshot}}=require('../netlify/functions/waiver-recommendations');
const now=Date.parse('2026-10-06T06:01:00Z');
const fresh=providerSnapshotFreshness({provider:'cbs',syncedAt:'2026-10-06T06:00:30Z'},now);
const stale=providerSnapshotFreshness({provider:'espn',syncedAt:'2026-10-06T05:59:00Z'},now);
assert.equal(fresh.stale,false);assert.equal(stale.stale,true,'Tuesday rollover invalidates the previous snapshot');
assert.equal(providerSnapshotFreshness({provider:'cbs',syncedAt:'2026-10-04T00:00:00Z'},now).stale,true);
assert.equal(providerSnapshotFreshness({provider:'cbs'},now).status,'unknown');
const item={verdict:'ADD_NOW',recommended:true,customerActionable:true,marketFaab:{recommendedPct:5},faab:{recommendedPct:5},swapFor:{name:'Drop Candidate'},decision:{action:'ADD',actionable:true,reasons:['Injury status: Q — hamstring']}};
const safe=guardStaleSnapshot(item,stale);assert.equal(safe.verdict,'REVIEW');assert.equal(safe.faab,null);assert.equal(safe.swapFor,null);assert.equal(safe.marketFaab,item.marketFaab);assert(safe.decision.reasons.includes(item.decision.reasons[0]));
assert.equal(guardStaleSnapshot(item,fresh),item,'Fresh connection preserves working advice');
assert.equal(guardStaleSnapshot({...item,verdict:'PASS'},stale).verdict,'PASS');
console.log('PASS: stale provider snapshots cannot produce actionable moves/bids; market estimates and injury context preserved.');

(async()=>{
 const candidates=require('../netlify/functions/waiver-candidates'),handler=require('../netlify/functions/waiver-recommendations').handler;
 const original=candidates.handler;
 candidates.handler=async()=>({statusCode:200,body:JSON.stringify({provider:'cbs',season:2026,week:4,teams:12,scoring:'half-ppr',metadata:{rosterPlayersReceived:3,rosterIdentified:3,rosterMatchCoverage:1},candidates:[{name:'Verified Fixture Receiver',position:'WR',team:'GB',availabilityStatus:'FREE_AGENT',identity:{sageMatched:true},sage:{position:'WR',positionRank:5,sageScore:90,availabilityVerified:true},opportunity:{lastGameTargets:9,lastGameOpportunities:9},rosterImpact:{classification:'UPGRADE',comparisonType:'same-position-fallback',weakestComparable:{name:'Fixture Bench',position:'WR',sage:{positionRank:40,sageScore:60}}}}]})});
 try{
  async function run(syncedAt){const r=await handler({httpMethod:'POST',headers:{},body:JSON.stringify({season:2026,week:4,connection:{provider:'cbs',syncedAt}})});assert.equal(r.statusCode,200);return JSON.parse(r.body);}
  const current=await run(new Date().toISOString()),old=await run('2026-09-27T00:00:00Z');
  assert.equal(current.recommendations[0].verdict,'ADD_NOW');assert(current.recommendations[0].faab);
  assert.equal(old.recommendations[0].verdict,'REVIEW');assert.equal(old.recommendations[0].faab,null);
  assert.deepEqual(old.recommendations[0].marketFaab,current.recommendations[0].marketFaab);
  assert.equal(old.metadata.providerSnapshot.stale,true);
  console.log('PASS: actual recommendations handler preserves fresh bids and blocks stale snapshot action while retaining the same market price.');
 }finally{candidates.handler=original;}
})().catch(error=>{console.error(error);process.exitCode=1;});
