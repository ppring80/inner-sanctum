'use strict';
// Isolated composition prototype. No worker/customer import, provider, budget,
// store or automatic promotion. reviewPair is supplied by the caller.
const {buildEvidence}=require('./_super-sage-shadow-llm');
const {prepareSelectedPair,formatGroundedAnswer,assessPairAnswer}=require('./_super-sage-shadow-fast-review');
const {toCustomerAnswer}=require('./_super-sage-lineup-presenters');
const copy=v=>JSON.parse(JSON.stringify(v));
const unresolved=new Set(['PROVISIONAL_UNRESOLVED','CLOSE_CALL_WITHIN_NOISE']);
async function secondOpinion({record,slotIndex,reviewPair,capturedAt,loadUsageSnapshot}){
 const sageRecord=copy(record),sageAnswer=toCustomerAnswer(sageRecord);
 const base={decisionId:sageRecord.decisionId,sageRecord,sageAnswer};
 const slot=sageRecord.slots[slotIndex];
 if(!Number.isInteger(slotIndex)||!slot||!unresolved.has(slot.decisionState))return {...base,secondOpinion:{status:'SKIPPED',reason:'slot_not_unresolved'}};
 const unavailable=()=>({...base,secondOpinion:{status:'UNAVAILABLE',label:'Rookie second opinion unavailable'}});
 if(!slot.starter||!slot.comparator||typeof reviewPair!=='function')return unavailable();
 try{
  const frozen=buildEvidence(sageRecord),selectedSlot=frozen.packet.slots[slotIndex];
  const focused=await prepareSelectedPair(frozen,{players:[slot.starter.name,slot.comparator.name],slotId:selectedSlot.slotId},{capturedAt,loadUsageSnapshot});
  // Only the pair's evidence is passed out. SAGE's answer, authority and
  // confidence are never supplied as a preferred model response.
  const result=await reviewPair(copy(focused.packet));
  if(result?.status!=='REVIEW_READY')return unavailable();
  const sp=require('./_rookie-structured-pair');
  const structured=[sp.CONTRACT,sp.CONTRACT_V1].includes(focused.packet.answerContract);
  // A saved v1 review is judged against the v1 packet rebuilt from the same frozen evidence.
  const contractFocused=structured&&result.legacyContract===sp.CONTRACT_V1?await prepareSelectedPair(frozen,{players:[slot.starter.name,slot.comparator.name],slotId:selectedSlot.slotId},{capturedAt,loadUsageSnapshot,contract:'v1'}):focused;
  if(structured&&result.evidenceHash&&result.evidenceHash!==contractFocused.evidenceHash)return unavailable();
  const answer=structured?result.answer:Array.isArray(result.answer?.sentenceFactIds)?result.answer:formatGroundedAnswer(result.answer);
  const assessment=assessPairAnswer(answer,contractFocused.packet);
  if(assessment.hard.length)return unavailable();
  const lean=focused.packet.players.find(p=>p.id===answer.selected)?.name||null;
  return {...base,secondOpinion:{status:'READY',label:lean?`Rookie leans ${lean}`:'Rookie has no call',slotId:selectedSlot.slotId,lean,confidence:answer.confidence,softFlags:assessment.soft,answer:copy(structured?sp.render(answer,contractFocused.packet):answer)}};
 }catch{return unavailable();}
}
module.exports={secondOpinion};
