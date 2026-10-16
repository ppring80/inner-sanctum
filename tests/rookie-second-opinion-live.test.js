'use strict';
const assert=require('node:assert/strict');
const {run}=require('../scripts/run-super-sage-week4-acceptance');
const {hash,buildEvidence}=require('../netlify/functions/_super-sage-shadow-llm');
const {toCustomerAnswer}=require('../netlify/functions/_super-sage-lineup-presenters');
const fast=require('../netlify/functions/_super-sage-shadow-fast-review');
let calls=0,behavior='ready',lastSelection;
const original=fast.runFastReview;
fast.runFastReview=async args=>{
 calls++;lastSelection=args.selection;
 if(behavior==='timeout')throw Error('mock timeout');
 const artifact=await args.store.get(`evidence/${args.decisionId}/${args.ownerHash}`);
 const pair=await fast.prepareSelectedPair(artifact.frozenEvidence,args.selection);
 return {status:'REVIEW_READY',cached:true,parentEvidenceHash:artifact.frozenEvidence.evidenceHash,evidenceHash:pair.evidenceHash,answer:behavior==='invalid'?{selected:'invented'}:{selected:'B',confidence:'LOW',caveat:'The evidence remains close.',reconsider:'A new injury report.',explanationSentences:pair.packet.players.map(p=>({text:`${p.name} remains an option on the supplied evidence.`,factIds:[p.facts[0].factId]}))}};
};
const {runSecondOpinion,recordKey}=require('../netlify/functions/_rookie-second-opinion-live');
const ownerHash=hash('synthetic-owner'),record=run().record,decisionId=record.decisionId;
const before=JSON.stringify(record),data=new Map();
function capture(r){data.set(recordKey(decisionId,ownerHash),{ownerHash,record:r,recordHash:hash(JSON.stringify(r))});data.set(`evidence/${decisionId}/${ownerHash}`,{ownerHash,frozenEvidence:buildEvidence(r)});}
capture(record);
const args={store:{get:async k=>data.get(k)},decisionId,ownerHash};
(async()=>{
 const ready=await runSecondOpinion(args);assert.equal(ready.status,'REVIEW_READY');assert.equal(ready.secondOpinion.lean,'Courtland Sutton');assert.equal(calls,1);assert.equal(ready.cached,true);assert.deepEqual(lastSelection,{players:['Blake Corum','Courtland Sutton'],slotId:'S7'});assert.deepEqual(ready.sageAnswer,toCustomerAnswer(record));assert.equal(JSON.stringify(record),before);
 console.log('PASS 1: owned automatic selection calls the existing pair path; cache reuse and separate result preserve SAGE.');
 const decided=JSON.parse(before);decided.slots.forEach(s=>s.decisionState='DECIDED');capture(decided);assert.equal((await runSecondOpinion(args)).status,'SKIPPED');assert.equal(calls,1);capture(record);
 console.log('PASS 2: no unresolved slot means no model-path invocation.');
 for(const mode of ['invalid','timeout']){behavior=mode;const r=await runSecondOpinion(args);assert.equal(r.status,'UNAVAILABLE');assert.deepEqual(r.sageAnswer,toCustomerAnswer(record));assert.equal(JSON.stringify(record),before);}
 assert.equal((await runSecondOpinion({...args,ownerHash:hash('other')})).error,'owned_second_opinion_input_unavailable');
 console.log('PASS 3: invalid/timeout remains isolated; another owner cannot reach the pair path.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{fast.runFastReview=original;});
