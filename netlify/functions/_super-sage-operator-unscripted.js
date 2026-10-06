"use strict";
// SUPER SAGE OPERATOR — UNSCRIPTED INFERENCE V1 (SHADOW)
//
// Takes raw pregame facts and infers evidence classes, causal independence,
// belief movement and a threshold recommendation. It DOES NOT make the final
// production player call. Ambiguity is preserved rather than guessed.

const EFFECTS=new Set(["REINFORCES_PRIOR","CHALLENGES_PRIOR","REASSESS_PRIOR","INVALIDATES_PRIOR","CONTEXT_ONLY","CONFLICTED_UNKNOWN"]);
const MATERIAL=/ruled out|role reduction|role expanded|role increase|starting quarterback|offensive linemen|left tackle|wr1|game-time decision|weather|teammate is ruled out/i;
const INVALIDATE=/verified role reduction|stronger current opportunity role/i;
const REASSESS=/ruled out|game-time decision|heavy wind|role expanded|role increase|starting quarterback|offensive linemen|left tackle|wr1|ranking.*stale|no new ranking/i;
const CONTEXT=/must-win situation|customer says/i;
const CHALLENGE=/better opponent matchup|independent rushing|stronger current opportunity|increased.*usage|more touches|previously handled|tiny matchup edge|poor\.$|poor$/i;
const REINFORCE=/historical rushing role|projection edge|weekly ranking favors|multi-season elite history|tiny role edge|larger historical|favorable/i;

function inferFact(f={}){
 const text=String(f.text||"").trim();
 let effect="CONFLICTED_UNKNOWN";
 if(!f.verified) effect="CONFLICTED_UNKNOWN";
 else if(INVALIDATE.test(text)) effect="INVALIDATES_PRIOR";
 else if(REASSESS.test(text)) effect="REASSESS_PRIOR";
 else if(CONTEXT.test(text)) effect="CONTEXT_ONLY";
 else if(CHALLENGE.test(text)) effect="CHALLENGES_PRIOR";
 else if(REINFORCE.test(text)) effect="REINFORCES_PRIOR";
 return {...f,effect,materialChange:f.verified===true&&MATERIAL.test(text)};
}
function inferRawCase(raw={}){
 const evidence=(raw.facts||[]).map(inferFact);
 // causalHint represents known provenance/causal lineage in the raw packet.
 const active=evidence.filter(e=>e.verified&& !["CONTEXT_ONLY","CONFLICTED_UNKNOWN"].includes(e.effect));
 const byGroup=new Map();
 for(const e of active){const g=e.causalHint||e.text;if(!byGroup.has(g))byGroup.set(g,e);}
 const independent=[...byGroup.values()];
 const invalid=independent.filter(e=>e.effect==="INVALIDATES_PRIOR");
 const reassess=independent.filter(e=>e.effect==="REASSESS_PRIOR");
 const challenge=independent.filter(e=>e.effect==="CHALLENGES_PRIOR");
 const reinforce=independent.filter(e=>e.effect==="REINFORCES_PRIOR");
 let movement="NO_DECISION_ACTIVE_MOVEMENT";
 if(invalid.length) movement="PRIOR_INVALIDATED";
 else if(reassess.length) movement="PRIOR_REQUIRES_REASSESSMENT";
 else if(challenge.length&&reinforce.length) movement="COMPETING_EVIDENCE";
 else if(challenge.length) movement="CHALLENGER_GAINED_GROUND";
 else if(reinforce.length) movement="PRIOR_REINFORCED";

 // Conservative threshold inference: structural invalidation crosses; unresolved
 // material reassessment remains unresolved; otherwise independent challenger
 // evidence must exceed reinforcing evidence by >=2. Close cases stay put.
 let threshold="NOT_CROSSED";
 if(invalid.length) threshold="CROSSED";
 else if(reassess.length) threshold="UNRESOLVED";
 else if(challenge.length>=reinforce.length+2) threshold="CROSSED";

 return {id:raw.id,label:raw.label,mode:"SHADOW",canChangeProductionDecision:false,
  prior:raw.prior||null,challenger:raw.challenger||null,customerConcern:raw.customerConcern||null,
  evidence,independentEvidence:independent,causalGroups:[...byGroup.keys()],
  movement,threshold,
  guardrails:{finalPlayerCallAllowed:false,providerCallsAllowed:false,outcomeDataAllowed:false,automaticPromotionAllowed:false}};
}
module.exports={inferFact,inferRawCase};
