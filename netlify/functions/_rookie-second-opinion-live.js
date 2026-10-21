"use strict";
// Private adapter only. Reuses the existing pair prompt, cache and paid budget.
const {hash,buildEvidence}=require('./_super-sage-shadow-llm');
const {runFastReview}=require('./_super-sage-shadow-fast-review');
const {secondOpinion}=require('./_rookie-second-opinion');
const recordKey=(id,owner)=>`second-opinion-input/${id}/${owner}`;
async function runSecondOpinion(args){
 const {store,decisionId,ownerHash}=args;
 const fail=error=>({status:'UNAVAILABLE',error,customerEligible:false});
 if(!/^[a-f0-9]{64}$/.test(decisionId||'')||!/^[a-f0-9]{64}$/.test(ownerHash||''))return fail('invalid_request');
 const [saved,evidence]=await Promise.all([store.get(recordKey(decisionId,ownerHash),{type:'json'}),store.get(`evidence/${decisionId}/${ownerHash}`,{type:'json'})]);
 if(saved?.ownerHash!==ownerHash||evidence?.ownerHash!==ownerHash||!saved?.record||!evidence?.frozenEvidence)return fail('owned_second_opinion_input_unavailable');
 const record=saved.record;
 if(record.decisionId!==decisionId||hash(JSON.stringify(record))!==saved.recordHash||hash(JSON.stringify(evidence.frozenEvidence.packet))!==evidence.frozenEvidence.evidenceHash||buildEvidence(record).evidenceHash!==evidence.frozenEvidence.evidenceHash)return fail('second_opinion_integrity_failure');
 const slotIndex=record.slots.findIndex(s=>['PROVISIONAL_UNRESOLVED','CLOSE_CALL_WITHIN_NOISE'].includes(s.decisionState)&&s.starter&&s.comparator);
 let review=null,selection=null;
 const composed=await secondOpinion({record,slotIndex,capturedAt:evidence.capturedAt,loadUsageSnapshot:args.loadUsageSnapshot,reviewPair:async packet=>{
  selection={players:packet.players.map(p=>p.name),slotId:packet.slotId};
  review=await runFastReview({...args,selection,caseId:null});
  const contractPair=review.legacyContract==='structured-pair-v1'?await require('./_super-sage-shadow-fast-review').prepareSelectedPair(evidence.frozenEvidence,selection,{capturedAt:evidence.capturedAt,loadUsageSnapshot:args.loadUsageSnapshot,contract:'v1'}):{evidenceHash:hash(JSON.stringify(packet))};
  if(review.parentEvidenceHash!==evidence.frozenEvidence.evidenceHash||review.evidenceHash!==contractPair.evidenceHash)return{status:'UNAVAILABLE'};
  return review;
 }});
 return {status:composed.secondOpinion.status==='READY'?'REVIEW_READY':composed.secondOpinion.status==='SKIPPED'?'SKIPPED':'UNAVAILABLE',type:'PRIVATE_ROOKIE_SECOND_OPINION',customerEligible:false,decisionId,sageAnswer:composed.sageAnswer,secondOpinion:composed.secondOpinion,selection,review,cached:review?.cached===true};
}
module.exports={recordKey,runSecondOpinion};
