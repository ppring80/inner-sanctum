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
const CHALLENGE=/better(?: verified)?(?: pass-defense)? matchup|better opponent matchup|independent rushing|stronger current opportunity|increased.*usage|more touches|previously handled|tiny matchup edge|slightly better matchup|poor\\.$|poor$/i;
const REINFORCE=/historical rushing role|projection edge|weekly ranking favors|multi-season elite history|tiny role edge|larger historical|favorable/i;

function inferFact(f={}){
 const text=String(f.text||"").trim();
 let effect="CONFLICTED_UNKNOWN";
 if(!f.verified) effect="CONFLICTED_UNKNOWN";
 else if(INVALIDATE.test(text)) effect="INVALIDATES_PRIOR";
 else if(REASSESS.test(text)) effect="REASSESS_PRIOR";
 else if(CONTEXT.test(text)) effect="CONTEXT_ONLY";
 else if(/more work|more touches|increased.*usage/i.test(text)) effect="CHALLENGES_PRIOR";
 else if(CHALLENGE.test(text)) effect="CHALLENGES_PRIOR";
 else if(REINFORCE.test(text)) effect="REINFORCES_PRIOR";
 const materialChange=f.verified===true&&MATERIAL.test(text);
 const evidenceStrength=!f.verified?"NONE":(effect==="INVALIDATES_PRIOR"?"STRUCTURAL":(materialChange?"MATERIAL":(effect==="REASSESS_PRIOR"?"MATERIAL":"SUPPORTING")));
 return {...f,effect,materialChange,evidenceStrength};
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
 const materialChallenge=independent.filter(e=>e.effect==="CHALLENGES_PRIOR"&&["MATERIAL","STRUCTURAL"].includes(e.evidenceStrength));
 const materialReassess=reassess.filter(e=>["MATERIAL","STRUCTURAL"].includes(e.evidenceStrength));
 const informationComplete=raw.informationState==="COMPLETE";
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
 else if(reassess.length && !informationComplete) threshold="UNRESOLVED";
 else if(reassess.length && informationComplete){
   // Complete information removes the escape hatch: reconcile known structural
   // changes instead of calling them unresolved. Two or more challenger-side
   // independent lines can cross; otherwise preserve the prior narrowly.
   threshold=(challenge.length>=2 || (materialReassess.length>=1 && challenge.length>=1) || materialChallenge.length>=1)?"CROSSED":"NOT_CROSSED";
 }
 else if(challenge.length>=reinforce.length+2) threshold="CROSSED";

 // Uncertainty is not one thing. MISSING_INFORMATION means a material state is
 // unresolved; CLOSE_CALL means the known evidence competes without crossing;
 // STABLE means the available evidence supports a clear threshold state.
 const unresolvedMaterial=!informationComplete && evidence.some(e=>e.materialChange&&e.effect==="REASSESS_PRIOR");
 let uncertaintyType="STABLE";
 if(threshold==="UNRESOLVED"&&unresolvedMaterial) uncertaintyType="MISSING_INFORMATION";
 else if(threshold==="NOT_CROSSED"&&challenge.length&&reinforce.length) uncertaintyType="CLOSE_CALL";

 return {id:raw.id,label:raw.label,mode:"SHADOW",canChangeProductionDecision:false,
  prior:raw.prior||null,challenger:raw.challenger||null,customerConcern:raw.customerConcern||null,informationState:raw.informationState||"OPEN",
  evidence,independentEvidence:independent,causalGroups:[...byGroup.keys()],evidenceStrength:{materialReassess:materialReassess.length,materialChallenge:materialChallenge.length},
  movement,threshold,uncertaintyType,
  guardrails:{finalPlayerCallAllowed:false,providerCallsAllowed:false,outcomeDataAllowed:false,automaticPromotionAllowed:false}};
}

function provisionalCall(raw={}){
 const inference=inferRawCase(raw);
 const incumbent=raw?.prior?.player||null;
 const challenger=raw?.challenger?.player||null;
 let selected=null;
 let status="NO_CALL";
 let rationale=null;

 if(inference.threshold==="CROSSED"){
   selected=challenger;
   status="PROVISIONAL_CALL";
   rationale="Independent decision-active evidence crossed the threshold against the prior.";
 } else if(inference.threshold==="NOT_CROSSED"){
   selected=incumbent;
   status="PROVISIONAL_CALL";
   rationale=inference.uncertaintyType==="CLOSE_CALL"
     ?"The evidence is close, but it did not cross the threshold required to overturn the prior."
     :"The available decision-active evidence did not overturn the prior.";
 } else if(inference.threshold==="UNRESOLVED"){
   status="CONDITIONAL";
   rationale="A material state remains unresolved; a definitive player call would manufacture certainty.";
 }

 return {
   type:"SUPER_SAGE_PROVISIONAL_CALL",
   mode:"TUMBLER_ONLY",
   canChangeProductionDecision:false,
   selected,status,rationale,
   incumbent,challenger,
   movement:inference.movement,
   threshold:inference.threshold,
   uncertaintyType:inference.uncertaintyType,
   evidenceUsed:inference.independentEvidence.map(e=>({text:e.text,effect:e.effect,group:e.causalHint||e.text})),
   guardrails:{productionAuthority:false,providerCallsAllowed:false,outcomeDataAllowed:false,automaticPromotionAllowed:false}
 };
}
module.exports={inferFact,inferRawCase,provisionalCall};
