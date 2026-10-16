'use strict';
const assert=require('node:assert/strict');
const {hash,buildEvidence,runReview}=require('../netlify/functions/_super-sage-shadow-llm');
const q=require('../netlify/functions/_rookie-candidate-v2-qualification');
const previous=require('../netlify/functions/_rookie-candidate-qualification');
const {readSavedReview}=require('../netlify/functions/_rookie-saved-review');
const ownerHash=hash('synthetic-candidate-owner'),decisionId=q.PIN.decisionId,now=new Date('2026-10-16T01:05:00Z');
const frozenEvidence=buildEvidence({decisionId,request:{},slots:[{slotLabel:'RB',eligiblePositions:['RB'],starter:{name:'Alpha',position:'RB',standing:{tier:'START'}}}]});
const prior={status:'INVALID',requestId:q.PIN.priorRequestId,evidenceHash:q.PIN.parentEvidenceHash,validationErrors:['incomplete_model_response']};
const original={rawText:'original full failure'};
const artifact={ownerHash,frozenEvidence};
function store(){const data=new Map([[`evidence/${decisionId}/${ownerHash}`,artifact],[previous.reviewKey(decisionId,ownerHash),prior],[`llm/rookie-independent-v2/${decisionId}/${ownerHash}`,original]]);return{data,get:async k=>data.get(k),setJSON:async(k,v,o={})=>{if(o.onlyIfNew&&data.has(k))return{modified:false};data.set(k,v);return{modified:true};}};}
(async()=>{
 let calls=0;const s=store(),answer={choices:[{p:'P1',c:'L',b:''}],decisions:[],alerts:[],contingencies:[]};
 const args={store:s,decisionId,ownerHash,apiKey:'synthetic',now,fetchImpl:async()=>{calls++;return{ok:true,json:async()=>({id:'synthetic-id',stop_reason:'tool_use',content:[{type:'tool_use',name:'submit_candidate_v2',input:answer}]})};}};
 assert.equal(q.allowed({decisionId,artifact,prior,now}),false,'unpinned request denied');
 assert.equal(q.allowed({decisionId,artifact,prior,now:new Date('2026-10-17')}),false);
 assert.equal((await q.executeQualification(args)).error,'candidate_authorization_mismatch');assert.equal(calls,0);
 assert.equal((await q.executeQualification({...args,ownerHash:hash('other')})).error,'owned_frozen_evidence_unavailable');
 const real=q.allowed;q.allowed=()=>true;
 try{
  await Promise.all([q.executeQualification(args),q.executeQualification(args)]);assert.equal(calls,1);
  const result=s.data.get(q.reviewKey(decisionId,ownerHash));assert.equal(result.status,'REVIEW_READY');assert.deepEqual(result.rawContent[0].input,answer);assert.equal(result.customerEligible,false);
  await q.executeQualification(args);await runReview(args);assert.equal(calls,1,'worker and tool redelivery read saved result');
  assert.strictEqual(s.data.get(previous.reviewKey(decisionId,ownerHash)),prior);
  const read=await readSavedReview({store:s,decisionId,ownerHash,kind:'full'});assert.strictEqual(read.priorCandidate,prior);assert.strictEqual(read.priorReview,original);assert.strictEqual(read.review,result);
  const capped=store();capped.data.set(q.budgetKey,{spent:true});assert.equal((await q.executeQualification({...args,store:capped})).error,'candidate_budget_consumed');assert.equal(calls,1);
  const queued=store();let queues=0;const queueArgs={...args,store:queued,fetchImpl:async()=>{queues++;return{status:202};}};
  await Promise.all([q.queueQualification(queueArgs),q.queueQualification(queueArgs)]);assert.equal(queues,1);
  const bad=store();await q.executeQualification({...args,store:bad,fetchImpl:async()=>({ok:true,json:async()=>({stop_reason:'max_tokens',content:[{type:'text',text:'unfinished original'}]})})});
  const invalid=bad.data.get(q.reviewKey(decisionId,ownerHash));assert.equal(invalid.status,'INVALID');assert.equal(invalid.rawText,'unfinished original');assert.ok(invalid.validationErrors.includes('incomplete_model_response'));
 }finally{q.allowed=real;}
 console.log('Candidate v2 qualification: exact authorization gate, owned evidence, atomic single spend/queue, no retry, raw preservation and four separate saved histories.');
})().catch(e=>{console.error(e);process.exitCode=1;});
