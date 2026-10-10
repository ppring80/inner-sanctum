'use strict';
const {hash}=require('./_super-sage-shadow-llm');
const {VERSION,POST241,STREAM_DIAGNOSTIC,POST246,POST248,FINAL_VOICE,ROLE_SYSTEM,focusEvidence,runFastReview}=require('./_super-sage-shadow-fast-review');
const reviewKey=(decisionId,ownerHash)=>`llm-drill/${VERSION}/${FINAL_VOICE.caseId}/${decisionId}/${ownerHash}`;
async function authorized({store,decisionId,ownerHash}) {
 if(decisionId!==POST241.decisionId||!/^[a-f0-9]{64}$/.test(ownerHash||''))return false;
 const [evidence,prior]=await Promise.all([
  store.get(`evidence/${decisionId}/${ownerHash}`,{type:'json'}),
  store.get(`llm-drill/${VERSION}/${POST248.caseId}/${decisionId}/${ownerHash}`,{type:'json'})
 ]);
 return Boolean(evidence?.ownerHash===ownerHash&&evidence.frozenEvidence?.evidenceHash===POST241.parentEvidenceHash&&hash(JSON.stringify(evidence.frozenEvidence.packet))===POST241.parentEvidenceHash&&prior?.status==='REVIEW_READY'&&prior.requestId===FINAL_VOICE.priorRequestId&&hash(ROLE_SYSTEM)===FINAL_VOICE.promptHash&&prior.parentEvidenceHash===POST241.parentEvidenceHash&&prior.promptHash===POST248.promptHash);
}
async function executeQualification(args) {
 if(!await authorized(args))return{status:'UNAVAILABLE',error:'diagnostic_authorization_mismatch'};
 const start=Date.now();
 const result=await runFastReview({...args,transport:'stream',drill:{version:VERSION,caseId:FINAL_VOICE.caseId,build:frozen=>{
  const pair=focusEvidence(frozen,['Blake Corum','Will Shipley']);Object.assign(pair.packet,{requireSentenceEvidence:true,requireBackfieldExplanation:true,requireCandidateStatusSentence:true});pair.evidenceHash=hash(JSON.stringify(pair.packet));return pair;
 }}});
 // Background-only finalization stores the full request breakdown once complete.
 if(!result.cached&&!result.error?.includes('reserved')&&result.requestTiming){
  const completed={...result,qualificationTotalMs:Date.now()-start,completedAt:new Date().toISOString(),diagnosticOnly:true,customerEligible:false,deliveryTargetMet:null,deliveryTimingScope:'SYNCHRONOUS_PRIVATE_REVIEW; caller must measure full tool delivery'};
  await args.store.setJSON(reviewKey(args.decisionId,args.ownerHash),completed);return completed;
 }
 return result;
}
module.exports={executeQualification,reviewKey};
