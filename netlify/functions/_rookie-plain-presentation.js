'use strict';
// Model-facing presentation only. Frozen source facts and their IDs stay intact.
const labels=['Strong Negative','Negative','Neutral','Positive','Strong Positive'];
const phrases=['very difficult','difficult','neutral','favorable','very favorable'];
function matchupRank(value){
 if(typeof value==='string'){const i=labels.indexOf(value);return i<0?null:i+1;}
 return Number.isInteger((value?.favorabilityOrder??value?.favorabilityRank))&&(value.favorabilityOrder??value.favorabilityRank)>=1&&(value.favorabilityOrder??value.favorabilityRank)<=5?(value.favorabilityOrder??value.favorabilityRank):null;
}
function expansionConfirmed(value){return value?.workloadChangeConfirmed===true||value?.validated===true;}
function plainPresentation(focused){
 const result=JSON.parse(JSON.stringify(focused));
 for(const player of result.packet.players)for(const fact of player.facts){
  const value=fact.value;
  if(fact.field==='matchup'){
   const rank=matchupRank(value);fact.value=rank===null?{plain:'matchup not supplied',favorabilityOrder:null}:{plain:phrases[rank-1],favorabilityOrder:rank};
  }
  if(fact.field==='establishedRole'&&value&&typeof value==='object'){
   const {level,description,reason,status,...rest}=value;
   const phrase={'high-volume':'large','moderate-volume':'steady','role-player':'smaller'}[level];
   fact.value={...rest,crossPositionComparable:result.packet.players.every(p=>p.position===player.position),plain:phrase?`${phrase} recent role for his position`:'recent role size not established for his position'};
  }
  if(fact.field==='roleExpansion'&&value&&typeof value==='object'){
   const confirmed=expansionConfirmed(value);
   fact.value={workloadChangeReported:value.claimed===true||value.workloadChangeReported===true,workloadChangeConfirmed:confirmed,plain:confirmed?'A larger workload is confirmed by the supplied evidence.':'A larger workload is not confirmed; how the work will be shared remains uncertain.'};
  }
 }
 result.packet.presentation='plain-v1';
 result.packet.answerContract=require('./_rookie-structured-pair').CONTRACT;
 result.packet.decisionFactors=require('./_rookie-structured-pair').factors(result.packet);
 result.packet.comparisons=require('./_super-sage-pair-comparisons').pairComparisons(result.packet);
 result.evidenceHash=require('./_super-sage-shadow-llm').hash(JSON.stringify(result.packet));
 return result;
}
const GUIDANCE='Use the supplied plain football wording, not internal labels or metadata codes. In reconsider, name your pick or the alternative and specify new evidence that would reverse your lean: a setback for your pick or more work / resolution of an existing availability concern for the alternative. Every clause must point toward that reversal. Do not invent an injury diagnosis or opponent statistics.';
const RECONSIDER_DESCRIPTION='At most 18 words. Name a player and new evidence that would reverse this lean, not reinforce it. Each clause must describe a setback for the pick, more work for the alternative, or resolution of the alternative\'s supplied uncertain status. No generic updates, new injury diagnoses or opponent statistics.';
module.exports={matchupRank,expansionConfirmed,plainPresentation,GUIDANCE,RECONSIDER_DESCRIPTION};
