'use strict';
const assert=require('node:assert/strict');
const {run}=require('../scripts/run-super-sage-week4-acceptance');
const {toCustomerAnswer}=require('../netlify/functions/_super-sage-lineup-presenters');
const {secondOpinion}=require('../netlify/functions/_rookie-second-opinion');
const copy=v=>JSON.parse(JSON.stringify(v));
(async()=>{
 const record=run().record,before=copy(record),customer=toCustomerAnswer(record);
 const unresolved=record.slots.findIndex(s=>s.decisionState==='PROVISIONAL_UNRESOLVED'&&s.comparator);
 const decided=record.slots.findIndex(s=>s.decisionState==='DECIDED');
 assert.ok(unresolved>=0&&decided>=0);
 function unchanged(result){assert.deepEqual(record,before);assert.deepEqual(result.sageRecord,before);assert.deepEqual(result.sageAnswer,customer);assert.equal(result.decisionId,record.decisionId);}
 let calls=0;
 const ready=await secondOpinion({record,slotIndex:unresolved,reviewPair:async packet=>{
  calls++;assert.equal(packet.players.length,2);assert.equal(packet.players[1].name,record.slots[unresolved].comparator.name);
  assert.equal(packet.slots,undefined);assert.equal(packet.decisionState,undefined);
  const p=packet.players[1],q=packet.players[0];
  return {status:'REVIEW_READY',answer:{selected:'B',confidence:'LOW',caveat:'The supplied evidence leaves this close.',reconsider:`If ${q.name} earns more targets before kickoff.`,explanationSentences:[
   {text:`I lean ${p.name}, though this remains a close decision.`,factIds:[p.facts[0].factId]},
   {text:`${q.name} remains the other option; I would revisit this before kickoff.`,factIds:[q.facts[0].factId]}
  ]}};
 }});
 assert.equal(calls,1);assert.equal(ready.secondOpinion.status,'READY');assert.equal(ready.secondOpinion.lean,record.slots[unresolved].comparator.name);unchanged(ready);
 console.log('PASS 1: unresolved pair produces a validated separate lean; SAGE record, decision ID, confidence, provisional state, alerts and 1/3/10 unchanged.');
 const skipped=await secondOpinion({record,slotIndex:decided,reviewPair:async()=>{calls++;throw Error('must not run');}});
 assert.equal(calls,1);assert.equal(skipped.secondOpinion.status,'SKIPPED');unchanged(skipped);
 console.log('PASS 2: decided slot invokes no Rookie callback.');
 for(const reviewPair of [async()=>({status:'REVIEW_READY',answer:{selected:'invented',confidence:'HIGH'}}),async()=>{const e=Error('mock timeout');e.name='TimeoutError';throw e;}]){
  const failed=await secondOpinion({record,slotIndex:unresolved,reviewPair});
  assert.equal(failed.secondOpinion.status,'UNAVAILABLE');assert.equal(failed.secondOpinion.label,'Rookie second opinion unavailable');unchanged(failed);
 }
 console.log('PASS 3: invalid answer and timeout preserve SAGE record and exact customer answer.');
 console.log('3/3 boundary checks passed. Mocked provider only; no live accuracy or latency claim.');
})().catch(e=>{console.error(e);process.exitCode=1;});
