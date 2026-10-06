"use strict";

// SUPER SAGE OPERATOR — PRESENTER V1
//
// Translation layer only. The Operator thinks in structured evidence; this
// module turns an already-built SHADOW decision trace into clear football
// analysis. It does not rank players, fetch evidence, call providers, or alter
// the decision. THINK DEEP. EXPLAIN PROPORTIONALLY. MAKE THE CALL.

const VERSION=1;
const clean=v=>v==null?null:String(v).trim()||null;
const arr=v=>Array.isArray(v)?v:[];
const sentence=s=>{s=clean(s);if(!s)return null;return /[.!?]$/.test(s)?s:s+".";};
const lower=s=>{s=clean(s);return s?s.charAt(0).toLowerCase()+s.slice(1):s;};

function customerConcernEvidence(trace){
  return arr(trace?.evidence).filter(e=>e.customerConcern===true || e.source==="customer-stated-concern");
}

function depthFor(trace){
  const active=arr(trace?.evidenceDiscipline?.decisionActiveIndependent).length;
  const material=arr(trace?.materialChanges).length;
  if(trace?.threshold?.state==="UNRESOLVED" || material>0 || active>=4) return "DEEP";
  if(active>=2 || trace?.beliefMovement==="COMPETING_EVIDENCE") return "STANDARD";
  return "QUICK";
}

function presentDecision(trace,{customerConcern=null}={}){
  if(!trace || trace.type!=="SUPER_SAGE_DECISION_TRACE") throw new Error("Presenter requires a Super SAGE decision trace.");
  if(trace.mode!=="SHADOW" || trace.canChangeProductionDecision!==false) throw new Error("Presenter V1 accepts shadow traces only.");
  const pick=clean(trace.decision?.selected);
  if(!pick) return {version:VERSION,type:"SUPER_SAGE_PRESENTATION",mode:"SHADOW",available:false,text:"I don't have enough evidence to make the call yet.",canChangeProductionDecision:false};

  const depth=depthFor(trace);
  const reasons=arr(trace.decision?.rationale).map(sentence).filter(Boolean);
  const losing=clean(trace.losingCase?.player);
  const counter=arr(trace.losingCase?.rationale).map(sentence).filter(Boolean);
  const flips=arr(trace.flipConditions).map(sentence).filter(Boolean);
  const concern=clean(customerConcern) || clean(customerConcernEvidence(trace)[0]?.statement);
  const confidence=clean(trace.decision?.confidence);

  const p=[];
  p.push(`I'd start ${pick}.`);
  if(concern) p.push(`Your concern is legitimate: ${sentence(concern)}`);
  if(reasons.length) p.push(reasons.slice(0,depth==="DEEP"?3:2).join(" "));
  if(losing && counter.length) p.push(`${losing} is a legitimate consideration. ${counter.slice(0,depth==="DEEP"?2:1).join(" ")}`);
  if(confidence) p.push(`I'd call this ${confidence.toLowerCase()} confidence.`);
  if(flips.length) p.push(`I'd reopen the decision if ${lower(flips[0])}`);

  return {
    version:VERSION,type:"SUPER_SAGE_PRESENTATION",mode:"SHADOW",available:true,
    call:pick,confidence,depth,customerConcern:concern,losingPlayer:losing,
    text:p.filter(Boolean).join("\n\n"),
    canChangeProductionDecision:false,
    guardrails:{decisionImmutable:true,providerCallsAllowed:false,outcomeDataAllowed:false}
  };
}
module.exports={VERSION,presentDecision,depthFor,customerConcernEvidence};
