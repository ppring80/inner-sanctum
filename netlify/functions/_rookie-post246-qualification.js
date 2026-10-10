'use strict';
const {hash,signJob}=require('./_super-sage-shadow-llm');
const {VERSION,POST241,STREAM_DIAGNOSTIC,POST246,ROLE_SYSTEM,focusEvidence,runFastReview}=require('./_super-sage-shadow-fast-review');
const reviewKey=(decisionId,ownerHash)=>`llm-drill/${VERSION}/${POST246.caseId}/${decisionId}/${ownerHash}`;
async function authorized({store,decisionId,ownerHash}) {
 if(decisionId!==POST241.decisionId||!/^[a-f0-9]{64}$/.test(ownerHash||''))return false;
 const [evidence,prior]=await Promise.all([
  store.get(`evidence/${decisionId}/${ownerHash}`,{type:'json'}),
  store.get(`llm-drill/${VERSION}/${STREAM_DIAGNOSTIC.caseId}/${decisionId}/${ownerHash}`,{type:'json'})
 ]);
 return Boolean(evidence?.ownerHash===ownerHash&&evidence.frozenEvidence?.evidenceHash===POST241.parentEvidenceHash&&hash(JSON.stringify(evidence.frozenEvidence.packet))===POST241.parentEvidenceHash&&prior?.status==='INVALID'&&prior.requestId===POST246.priorRequestId&&hash(ROLE_SYSTEM)===POST246.promptHash&&prior.parentEvidenceHash===POST241.parentEvidenceHash&&prior.promptHash===POST241.promptHash);
}
async function queueQualification(args) {
 const {store,decisionId,ownerHash,apiKey,fetchImpl=fetch,now=new Date()}=args;
 if(!await authorized(args))return{status:'UNAVAILABLE',error:'diagnostic_authorization_mismatch'};
 const saved=await store.get(reviewKey(decisionId,ownerHash),{type:'json'});
 if(saved)return{...saved,cached:true};
 if(!apiKey)return{status:'UNAVAILABLE',error:'model_not_configured'};
 const queueKey=`llm-queue/${VERSION}/${POST246.caseId}/${decisionId}/${ownerHash}`;
 const queued={status:'QUEUED',experiment:POST246.caseId,diagnosticOnly:true,customerEligible:false,decisionId,capturedAt:now.toISOString()};
 const previous=await store.get(queueKey,{type:'json'});if(previous)return previous;
 const reserved=await store.setJSON(queueKey,queued,{onlyIfNew:true});if(!reserved?.modified)return queued;
 try {
  const body=JSON.stringify({decisionId,ownerHash,issuedAt:now.getTime(),mode:POST246.caseId});
  const response=await fetchImpl('https://theinnersanctum.xyz/.netlify/functions/super-sage-rookie-review-background',{method:'POST',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json','x-rookie-signature':signJob(body,apiKey)},body});
  if(response.status!==202)throw new Error('queue_failed');return queued;
 }catch{const failed={...queued,status:'UNAVAILABLE',error:'diagnostic_queue_failed'};await store.setJSON(queueKey,failed);return failed;}
}
async function executeQualification(args) {
 if(!await authorized(args))return{status:'UNAVAILABLE',error:'diagnostic_authorization_mismatch'};
 const start=Date.now();
 const result=await runFastReview({...args,transport:'stream',drill:{version:VERSION,caseId:POST246.caseId,build:frozen=>{
  const pair=focusEvidence(frozen,['Blake Corum','Will Shipley']);Object.assign(pair.packet,{requireSentenceEvidence:true,requireBackfieldExplanation:true,requireCandidateStatusSentence:true});pair.evidenceHash=hash(JSON.stringify(pair.packet));return pair;
 }}});
 // Background-only finalization stores the full request breakdown once complete.
 if(!result.cached&&!result.error?.includes('reserved')&&result.requestTiming){
  const completed={...result,backgroundTotalMs:Date.now()-start,completedAt:new Date().toISOString(),diagnosticOnly:true,customerEligible:false,deliveryTargetMet:null,deliveryTimingScope:'BACKGROUND_REVIEW_ONLY; caller must measure queue-to-read delivery'};
  await args.store.setJSON(reviewKey(args.decisionId,args.ownerHash),completed);return completed;
 }
 return result;
}
module.exports={queueQualification,executeQualification,reviewKey};
