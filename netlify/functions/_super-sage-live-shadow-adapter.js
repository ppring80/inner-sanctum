"use strict";

// SUPER SAGE — LIVE SHADOW ADAPTER V1
//
// Converts the already-built production lineup record into a separate
// non-authoritative shadow record. It uses ONLY evidence already frozen inside
// each production slot packet. No provider/network calls. No outcomes.
// The adapter does not mutate production and cannot promote policy.
//
// V1 scope is intentionally conservative: evaluate the production starter
// against its recorded comparator. If the shadow evidence cannot resolve a
// displacement, preserve the production starter and mark the reason.

const { inferRawCase, provisionalCall }=require("./_super-sage-operator-unscripted.js");

function fact(text,verified,source,causalHint){return {text,verified,source,causalHint};}
function evidenceFacts(starter,challenger){
 const facts=[];
 if(starter?.standing) facts.push(fact("Production starter retains the stronger established Weekly SAGE standing.",true,"production standing","incumbent-standing"));
 if(challenger?.matchup?.label && starter?.matchup?.label && challenger.matchup.label!==starter.matchup.label)
   facts.push(fact("Challenger has the better opponent matchup.",true,"frozen matchup evidence","matchup"));
 if(challenger?.roleExpansion?.status==="VERIFIED"||challenger?.roleExpansion?.verified===true)
   facts.push(fact("Challenger has a verified material role increase.",true,"frozen role evidence","fresh-role"));
 for(const s of (challenger?.stateChanges||[])){
   if(s&&s.verified) facts.push(fact(String(s.note||s.type||"Verified challenger state change."),true,"frozen state change",String(s.type||"state-change").toLowerCase()));
 }
 for(const s of (starter?.stateChanges||[])){
   if(s&&s.verified) facts.push(fact(String(s.note||s.type||"Verified incumbent state change."),true,"frozen state change","incumbent-"+String(s.type||"state-change").toLowerCase()));
 }
 if(challenger?.projection?.admissible&&starter?.projection?.admissible&&Number.isFinite(challenger.projection.points)&&Number.isFinite(starter.projection.points)){
   if(challenger.projection.points>starter.projection.points) facts.push(fact("Challenger has a small current projection edge.",true,"frozen projection","projection"));
   else facts.push(fact("Production starter has a small current projection edge.",true,"frozen projection","projection"));
 }
 return facts;
}

function shadowSlot(slot){
 const starter=slot?.starter||null, challenger=slot?.comparator||null;
 if(!starter||!challenger) return {...slot,decidedBy:"operator-shadow-no-comparator",shadowSource:"FROZEN_PRODUCTION_PACKET"};
 const raw={id:"live-"+String(slot.slotLabel||"slot"),label:"Live lineup shadow",informationState:"COMPLETE",
   prior:{player:starter.name,strength:"MODERATE"},challenger:{player:challenger.name},facts:evidenceFacts(starter,challenger)};
 const call=provisionalCall(raw);
 const chosen=call.selected===challenger.name?challenger:starter;
 return {...slot,starter:chosen,comparator:chosen===starter?challenger:starter,decidedBy:"operator-shadow",
   decisionState:call.status==="CONDITIONAL"?"UNRESOLVED":"DECIDED",
   confidence:{label:call.uncertaintyType==="CLOSE_CALL"?"LOW":call.uncertaintyType==="MISSING_INFORMATION"?"LOW":"MODERATE"},
   shadow:{callStatus:call.status,movement:call.movement,threshold:call.threshold,uncertaintyType:call.uncertaintyType,rationale:call.rationale,evidenceUsed:call.evidenceUsed},
   shadowSource:"FROZEN_PRODUCTION_PACKET"};
}

function buildAutomaticShadowRecord(productionRecord){
 if(!productionRecord||productionRecord.evidenceType!=="super-sage-lineup-decision") throw new Error("Frozen production lineup decision required.");
 return {schemaVersion:1,evidenceType:"super-sage-live-shadow-lineup",decisionScope:productionRecord.decisionScope,
   request:productionRecord.request,productionDecisionId:productionRecord.decisionId,
   slots:(productionRecord.slots||[]).map(shadowSlot),
   authority:{productionAuthority:false,providerCallsAllowed:false,outcomeDataAllowed:false,automaticPromotionAllowed:false}};
}
module.exports={buildAutomaticShadowRecord,evidenceFacts,shadowSlot};
