'use strict';
const assert=require('node:assert/strict');
const {hash,executeReview,runReview,buildEvidence,VERSION}=require('../netlify/functions/_super-sage-shadow-llm');
const q=require('../netlify/functions/_rookie-full-post276');
const {_unused,...pin}=q.PIN;
const now=new Date('2026-10-15T04:10:00Z');
const metadata={decisionId:pin.decisionId,now,artifact:{frozenEvidence:{evidenceHash:pin.parentEvidenceHash}},prior:{status:'INVALID',requestId:pin.priorRequestId,evidenceHash:pin.parentEvidenceHash,validationErrors:['invalid_json']}};
assert.equal(q.allowed(metadata),true);
for(const patch of [{decisionId:'a'.repeat(64)},{now:new Date('2026-10-16T00:00:00Z')},{artifact:{frozenEvidence:{evidenceHash:'wrong'}}},{prior:{...metadata.prior,status:'REVIEW_READY'}},{prior:{...metadata.prior,requestId:'other'}},{prior:{...metadata.prior,validationErrors:[]}}])assert.equal(q.allowed({...metadata,...patch}),false);
const ownerHash=hash('synthetic-owner'),decisionId=pin.decisionId;
const frozenEvidence=buildEvidence({decisionId,request:{},slots:[{slotLabel:'RB',eligiblePositions:['RB'],starter:{name:'Alpha',position:'RB',standing:{tier:'START'}}}]});
const prior={...metadata.prior,rawText:'original failed full response'};
const oldKey=`llm/${VERSION}/${decisionId}/${ownerHash}`;
const answer={slots:[{slotId:'S1',playerId:'P1',confidence:'LOW',explanation:'Start Alpha.',countercase:'No other back supplied.',missingInformation:[],reconsider:['New injury information.'],factIds:['P1:standing']}]};
function makeStore(){const data=new Map([[`evidence/${decisionId}/${ownerHash}`,{ownerHash,frozenEvidence}],[oldKey,prior],['llm-budget/2026-10-15',{spent:true}]]);return{data,get:async k=>data.get(k),setJSON:async(k,v,o={})=>{if(o.onlyIfNew&&data.has(k))return{modified:false};data.set(k,v);return{modified:true};}};}
(async()=>{
 const realAllowed=q.allowed;
 let calls=0;
 const args={store:makeStore(),decisionId,ownerHash,now,apiKey:'synthetic',qualification:q.MODE,fetchImpl:async()=>{calls++;return{ok:true,json:async()=>({stop_reason:'tool_use',content:[{type:'tool_use',name:'submit_lineup',input:answer}]})};}};
 assert.equal((await executeReview(args)).error,'qualification_authorization_mismatch','valid frozen hash but unpinned synthetic evidence denied');assert.equal(calls,0);
 // Gate tested above; use internally owned synthetic data for worker/dedup tests.
 q.allowed=context=>{assert.equal(context.decisionId,pin.decisionId);assert.strictEqual(context.prior,prior);return true;};
 try {
  const results=await Promise.all([executeReview(args),executeReview(args)]);
  assert.equal(calls,1);assert.ok(results.some(r=>r.status==='REVIEW_READY'));
  assert.strictEqual(args.store.data.get(oldKey),prior);
  assert.deepEqual(args.store.data.get('llm-budget/2026-10-15'),{spent:true});
  assert.ok(args.store.data.has(q.budgetKey));
  const saved=args.store.data.get(q.reviewKey(decisionId,ownerHash));assert.equal(saved.qualificationOf,pin.priorRequestId);assert.equal(saved.customerEligible,false);
  await executeReview(args);assert.equal(calls,1,'redelivery cannot make another provider call');
  const cached=await runReview(args);assert.equal(cached.cached,true);assert.equal(calls,1);
  const capped=makeStore();capped.data.set(q.budgetKey,{spent:true});
  assert.equal((await executeReview({...args,store:capped})).error,'daily_model_call_limit');assert.equal(calls,1);
 }finally{q.allowed=realAllowed;}
 const {readSavedReview}=require('../netlify/functions/_rookie-saved-review');
 const read=await readSavedReview({store:args.store,decisionId,ownerHash,kind:'full'});
 assert.equal(read.review.qualification,q.MODE);assert.strictEqual(read.priorReview,prior);
 assert.equal((await readSavedReview({store:args.store,decisionId,ownerHash:hash('other'),kind:'full'})).available,false);
 assert.equal(VERSION,'rookie-independent-v2');
 console.log('Authorized post-276 full review: exact date/evidence/failed request/contract pins; one atomic spend; prior result and budget retained; saved-only reader, owner isolation, cache/no retry. No live provider.');
})().catch(e=>{console.error(e);process.exitCode=1;});
