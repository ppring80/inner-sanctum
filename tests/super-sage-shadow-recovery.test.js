'use strict';
const assert=require('assert');
const {executeReview,runReview,buildEvidence,hash,VERSION}=require('../netlify/functions/_super-sage-shadow-llm');
const decisionId='a'.repeat(64),ownerHash=hash('owner'),now=new Date('2026-10-08T02:00:00Z');
const frozenEvidence=buildEvidence({decisionId,request:{},slots:[{slotLabel:'RB',eligiblePositions:['RB'],starter:{name:'Alpha',position:'RB',standing:{tier:'START'}}}]});
const key=`llm/rookie-independent-v1/${decisionId}/${ownerHash}`;
function makeStore(status='UNAVAILABLE',evidenceHash=frozenEvidence.evidenceHash){const data=new Map([[`evidence/${decisionId}/${ownerHash}`,{ownerHash,frozenEvidence}],[key,{status,error:'model_request_failed',evidenceHash}],['llm-budget/2026-10-08',{decisionId}]]);return{data,get:async k=>data.get(k),setJSON:async(k,v,o={})=>{if(o.onlyIfNew&&data.has(k))return{modified:false};data.set(k,v);return{modified:true};}};}
const answer={slots:[{slotId:'S1',playerId:'P1',confidence:'LOW',explanation:'Alpha has the supplied START standing.',countercase:'No alternative has been supplied.',missingInformation:[],reconsider:['New eligible alternative.'],factIds:['P1:standing']}]};
(async()=>{
 let calls=0;
 const args={store:makeStore(),decisionId,ownerHash,now,apiKey:'synthetic-key',fetchImpl:async()=>{calls++;return{ok:true,json:async()=>({model:'claude-sonnet-4-6',stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(answer)}]})};}};
 const results=await Promise.all([executeReview(args),executeReview(args)]);assert.strictEqual(calls,1);assert.ok(results.some(r=>r.status==='REVIEW_READY'));assert.ok(args.store.data.has('llm-recovery/2026-10-08'));assert.strictEqual((await executeReview(args)).recoveryOf,'rookie-independent-v1');assert.strictEqual(calls,1);
 for(const store of [makeStore('REVIEW_READY'),makeStore('UNAVAILABLE','different-evidence')]){assert.strictEqual((await runReview({...args,store})).error,'daily_model_call_limit');assert.strictEqual(calls,1);}
 const otherBudget=makeStore();otherBudget.data.set('llm-budget/2026-10-08',{decisionId:'b'.repeat(64)});assert.strictEqual((await runReview({...args,store:otherBudget})).error,'daily_model_call_limit');
 const consumed=makeStore();consumed.data.set('llm-recovery/2026-10-08',{});assert.strictEqual((await runReview({...args,store:consumed})).error,'daily_model_call_limit');
 const eligible=makeStore();assert.strictEqual((await runReview({...args,store:eligible,fetchImpl:async()=>({status:202})})).status,'QUEUED');assert.strictEqual(calls,1);
 console.log('Bounded recovery passed: identical failed v1 evidence only, one atomic recovery, ordinary cap preserved, successful/different/consumed requests blocked.');
})().catch(e=>{console.error(e);process.exitCode=1;});
