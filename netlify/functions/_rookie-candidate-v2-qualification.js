"use strict";
const {hash,signJob}=require('./_super-sage-shadow-llm');
const candidate=require('./_rookie-lineup-candidate-v2');
const previous=require('./_rookie-candidate-qualification');
const MODE='lineup-candidate-qualification-v2';
const PIN=Object.freeze({decisionId:previous.PIN.decisionId,parentEvidenceHash:previous.PIN.parentEvidenceHash,priorRequestId:'msg_011Cg3WkHcoTTqgFZqwNLWmE',day:'2026-10-16',requestHash:'81773167230378750101c92a19718d57bfa85a680c20ec28ef08e89397f9e6f8'});
const reviewKey=(id,owner)=>`llm-qualification/${MODE}/${id}/${owner}`;
const budgetKey=`llm-qualification-budget/${MODE}`;
function allowed({decisionId,artifact,prior,now=new Date()}) {
 if(decisionId!==PIN.decisionId||now.toISOString().slice(0,10)!==PIN.day||artifact?.frozenEvidence?.evidenceHash!==PIN.parentEvidenceHash||prior?.requestId!==PIN.priorRequestId||prior.status!=='INVALID'||prior.evidenceHash!==PIN.parentEvidenceHash||!prior.validationErrors?.includes('incomplete_model_response'))return false;
 try{return hash(JSON.stringify(candidate.buildRequest(artifact.frozenEvidence)))===PIN.requestHash;}catch{return false;}
}
async function context({store,decisionId,ownerHash}) {
 if(!/^[a-f0-9]{64}$/.test(decisionId||'')||!/^[a-f0-9]{64}$/.test(ownerHash||''))return null;
 const artifact=await store.get(`evidence/${decisionId}/${ownerHash}`,{type:'json'});
 if(artifact?.ownerHash!==ownerHash||!artifact.frozenEvidence||hash(JSON.stringify(artifact.frozenEvidence.packet))!==artifact.frozenEvidence.evidenceHash)return null;
 const prior=await store.get(previous.reviewKey(decisionId,ownerHash),{type:'json'});
 return {artifact,prior};
}
async function queueQualification(args) {
 const {store,decisionId,ownerHash,apiKey,fetchImpl=fetch,now=new Date()}=args;
 const ctx=await context(args);if(!ctx)return{status:'UNAVAILABLE',error:'owned_frozen_evidence_unavailable'};
 const saved=await store.get(reviewKey(decisionId,ownerHash),{type:'json'});if(saved)return{...saved,cached:true};
 if(!module.exports.allowed({...ctx,decisionId,now}))return{status:'UNAVAILABLE',error:'candidate_authorization_mismatch'};
 if(!apiKey)return{status:'UNAVAILABLE',error:'model_not_configured'};
 if(await store.get(budgetKey,{type:'json'}))return{status:'UNAVAILABLE',error:'candidate_budget_consumed'};
 const key=`llm-queue/${MODE}/${decisionId}/${ownerHash}`;
 const old=await store.get(key,{type:'json'});if(old)return old;
 const queued={status:'QUEUED',qualification:MODE,decisionId,capturedAt:now.toISOString(),customerEligible:false};
 if(!(await store.setJSON(key,queued,{onlyIfNew:true}))?.modified)return queued;
 try{
  const body=JSON.stringify({decisionId,ownerHash,issuedAt:now.getTime(),mode:MODE});
  const r=await fetchImpl('https://theinnersanctum.xyz/.netlify/functions/super-sage-rookie-review-background',{method:'POST',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json','x-rookie-signature':signJob(body,apiKey)},body});
  if(r.status!==202)throw Error();return queued;
 }catch{const failed={...queued,status:'UNAVAILABLE',error:'candidate_queue_failed'};await store.setJSON(key,failed);return failed;}
}
async function executeQualification(args) {
 const {store,decisionId,ownerHash,apiKey,fetchImpl=fetch,now=new Date()}=args;
 const ctx=await context(args);if(!ctx)return{status:'UNAVAILABLE',error:'owned_frozen_evidence_unavailable'};
 const key=reviewKey(decisionId,ownerHash),saved=await store.get(key,{type:'json'});if(saved)return{...saved,cached:true};
 if(!module.exports.allowed({...ctx,decisionId,now}))return{status:'UNAVAILABLE',error:'candidate_authorization_mismatch'};
 if(!apiKey)return{status:'UNAVAILABLE',error:'model_not_configured'};
 const reservation={status:'PENDING',qualification:MODE,qualificationOf:ctx.prior.requestId,decisionId,evidenceHash:ctx.artifact.frozenEvidence.evidenceHash,capturedAt:now.toISOString(),customerEligible:false,semanticReviewRequired:true};
 if(!(await store.setJSON(key,reservation,{onlyIfNew:true}))?.modified)return reservation;
 if(!(await store.setJSON(budgetKey,{decisionId,at:now.toISOString()},{onlyIfNew:true}))?.modified){const blocked={...reservation,status:'UNAVAILABLE',error:'candidate_budget_consumed'};await store.setJSON(key,blocked);return blocked;}
 let result;
 try{
  const request=candidate.buildRequest(ctx.artifact.frozenEvidence),started=Date.now();
  const response=await fetchImpl('https://api.anthropic.com/v1/messages',{method:'POST',signal:AbortSignal.timeout(180000),headers:{'content-type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'},body:JSON.stringify(request)});
  if(!response.ok)throw Error(`provider_http_${response.status}`);
  const body=await response.json(),providerMs=Date.now()-started;
  const calls=(body.content||[]).filter(c=>c.type==='tool_use'&&c.name==='submit_candidate_v2');
  const answer=calls.length===1?calls[0].input:null;
  let validationErrors=candidate.validate(answer,ctx.artifact.frozenEvidence.packet);
  if(body.stop_reason!=='tool_use'||calls.length!==1)validationErrors.push('incomplete_model_response');
  result={...reservation,status:validationErrors.length?'INVALID':'REVIEW_READY',provider:'anthropic',model:body.model||request.model,requestId:body.id||null,usage:body.usage||null,stopReason:body.stop_reason,rawContent:body.content,rawText:answer?JSON.stringify(answer):(body.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n'),answer,normalizedAnswer:candidate.normalize(answer,ctx.artifact.frozenEvidence.packet),validationErrors,providerMs,outgoing:{requestHash:hash(JSON.stringify(request)),systemHash:hash(request.system),evidenceHash:hash(request.messages[0].content),schemaHash:hash(JSON.stringify(request.tools[0].input_schema)),maxTokens:request.max_tokens},candidateNames:ctx.artifact.frozenEvidence.packet.players.map(p=>({playerId:p.playerId,name:p.name,position:p.position})),slotLabels:ctx.artifact.frozenEvidence.packet.slots.map(s=>({slotId:s.slotId,slotLabel:s.slotLabel})),completedAt:new Date().toISOString()};
 }catch(error){result={...reservation,status:'UNAVAILABLE',error:/^provider_http_\d+$/.test(error.message)?error.message:error.name==='TimeoutError'?'model_request_timeout':'model_request_failed',completedAt:new Date().toISOString()};}
 await store.setJSON(key,result);return result;
}
module.exports={MODE,PIN,reviewKey,budgetKey,allowed,queueQualification,executeQualification};
