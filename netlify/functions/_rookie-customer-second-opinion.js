'use strict';
// Opt-in saved-result pilot. No provider credentials, network or write path.
const {hash}=require('./_super-sage-shadow-llm');
const {runSecondOpinion,recordKey}=require('./_rookie-second-opinion-live');
async function readCustomerOpinion({requested,enabled,usingPastedRoster,record,ownerHash,store,loadUsageSnapshot}){
 if(!requested)return null;
 const unavailable=()=>({status:'UNAVAILABLE',label:'Rookie second opinion unavailable',detail:'SAGE’s lineup is unchanged. No new model call was made.'});
 if(!enabled||usingPastedRoster||!/^[a-f0-9]{64}$/.test(ownerHash||'')||!record?.decisionId)return unavailable();
 if(!record.slots.some(s=>['PROVISIONAL_UNRESOLVED','CLOSE_CALL_WITHIN_NOISE'].includes(s.decisionState)&&s.starter&&s.comparator))return {status:'SKIPPED',label:'No Rookie second opinion needed',detail:'SAGE has no unresolved pair in this decision. No model call was made.'};
 try{
  const saved=await store.get(recordKey(record.decisionId,ownerHash),{type:'json'});
  if(saved?.ownerHash!==ownerHash||saved.recordHash!==hash(JSON.stringify(record)))return unavailable();
  const result=await runSecondOpinion({store,decisionId:record.decisionId,ownerHash,savedOnly:true,loadUsageSnapshot});
  if(result.status!=='REVIEW_READY'||result.secondOpinion?.status!=='READY'||!result.cached)return unavailable();
  const opinion=result.secondOpinion,answer=opinion.answer;
  // No legacy prose, evidence bodies, raw provider replies, storage keys or
  // request metadata can cross this boundary. English is re-rendered upstream.
  if(!['structured-pair-v1','structured-pair-v2'].includes(answer.answerContract))return unavailable();
  return {status:'READY',label:opinion.label,slotId:opinion.slotId,lean:opinion.lean,confidence:opinion.confidence,explanation:answer.explanation,reconsider:answer.reconsider,detail:'Separate saved second opinion. Confidence is Rookie’s assessment, not a calibrated probability. SAGE’s lineup is unchanged.'};
 }catch{return unavailable();}
}
// A stalled optional cache read must not hold the lineup response open. The
// losing task can only read; it has no provider key, reservation or write path.
async function savedCustomerOpinion(args){
 if(!args.requested)return null;
 let timer;
 try{return await Promise.race([readCustomerOpinion(args),new Promise(resolve=>{timer=setTimeout(()=>resolve({status:'UNAVAILABLE',label:'Rookie second opinion unavailable',detail:'SAGE’s lineup is unchanged. No new model call was made.'}),args.readTimeoutMs??1500);})]);}
 finally{clearTimeout(timer);}
}
function opinionText(opinion){
 if(!opinion)return '';
 if(opinion.status!=='READY')return `${opinion.label}. ${opinion.detail}`;
 return ['Rookie second opinion (saved)',opinion.explanation,opinion.reconsider,opinion.detail].join('\n');
}
module.exports={savedCustomerOpinion,opinionText};
