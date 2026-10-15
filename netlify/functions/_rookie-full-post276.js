'use strict';
const PIN=Object.freeze({decisionId:'215d4f4db4ca6f3baa0cad4fc2d8a459396d7e9b438ac4c080eebee577076cf8',parentEvidenceHash:'d4c17ca05a2b09cf4598bd33c6c6349fe140afe48abf1f815f3aab6305595953',priorRequestId:'msg_011Cg3KBwgpy2dDjRvuwM51n',day:'2026-10-15',promptHash:'d20c4e2834fd768fd7400bdb7302276ec3f015328d34d0c9bb1acce4a9378e31',schemaBuilderHash:'53c7aeda5804352c409fada98d9beadd646180998e9ce008d438180604e2b26f'});
const MODE='full-qualification-post276';
const reviewKey=(decisionId,ownerHash)=>`llm-qualification/${MODE}/${decisionId}/${ownerHash}`;
const budgetKey=`llm-qualification-budget/${MODE}`;
function allowed({decisionId,artifact,prior,now=new Date()}) {
 const {hash,SYSTEM,fullReviewSchema}=require('./_super-sage-shadow-llm');
 return Boolean(decisionId===PIN.decisionId&&now.toISOString().slice(0,10)===PIN.day&&artifact?.frozenEvidence?.evidenceHash===PIN.parentEvidenceHash&&prior?.status==='INVALID'&&prior.requestId===PIN.priorRequestId&&prior.evidenceHash===PIN.parentEvidenceHash&&prior.validationErrors?.includes('invalid_json')&&hash(SYSTEM)===PIN.promptHash&&hash(fullReviewSchema.toString())===PIN.schemaBuilderHash);
}
async function queueQualification({store,decisionId,ownerHash,apiKey,fetchImpl=fetch,now=new Date()}) {
 const {hash,signJob,VERSION}=require('./_super-sage-shadow-llm');
 const [artifact,prior,saved]=await Promise.all([store.get(`evidence/${decisionId}/${ownerHash}`,{type:'json'}),store.get(`llm/${VERSION}/${decisionId}/${ownerHash}`,{type:'json'}),store.get(reviewKey(decisionId,ownerHash),{type:'json'})]);
 if(!artifact?.frozenEvidence||artifact.ownerHash!==ownerHash||hash(JSON.stringify(artifact.frozenEvidence.packet))!==artifact.frozenEvidence.evidenceHash)return{status:'UNAVAILABLE',error:'owned_frozen_evidence_unavailable'};
 if(saved)return{...saved,cached:true};
 if(!allowed({decisionId,artifact,prior,now}))return{status:'UNAVAILABLE',error:'qualification_authorization_mismatch'};
 if(!apiKey)return{status:'UNAVAILABLE',error:'model_not_configured'};
 if(await store.get(budgetKey,{type:'json'}))return{status:'UNAVAILABLE',error:'qualification_budget_consumed'};
 const key=`llm-queue/${MODE}/${decisionId}/${ownerHash}`,queued={status:'QUEUED',qualification:MODE,decisionId,capturedAt:now.toISOString(),customerEligible:false};
 const old=await store.get(key,{type:'json'});if(old)return old;
 if(!(await store.setJSON(key,queued,{onlyIfNew:true}))?.modified)return queued;
 try {
  const body=JSON.stringify({decisionId,ownerHash,issuedAt:now.getTime(),mode:MODE});
  const r=await fetchImpl('https://theinnersanctum.xyz/.netlify/functions/super-sage-rookie-review-background',{method:'POST',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json','x-rookie-signature':signJob(body,apiKey)},body});
  if(r.status!==202)throw Error('queue_failed');return queued;
 }catch{const failed={...queued,status:'UNAVAILABLE',error:'qualification_queue_failed'};await store.setJSON(key,failed);return failed;}
}
module.exports={PIN,MODE,reviewKey,budgetKey,allowed,queueQualification};
