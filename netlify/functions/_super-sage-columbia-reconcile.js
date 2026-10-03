"use strict";
function clean(v){return v==null?null:String(v).trim()||null;}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function reconcileColumbiaEvidence(items=[]){
  const rows=items.filter(Boolean).map((x,i)=>({
    id:x.id||"e"+(i+1),tributary:clean(x.tributary)||"unknown",claim:clean(x.claim),
    direction:clean(x.direction)||"neutral",concept:clean(x.concept)||clean(x.claim)||"unknown",
    observedAt:clean(x.observedAt),source:clean(x.source),sample:x.sample||null,
    confidence:finite(x.confidence),stale:Boolean(x.stale)
  }));
  const groups={};
  for(const r of rows){(groups[r.concept]??=[]).push(r);}
  const concepts=Object.entries(groups).map(([concept,g])=>{
    const dirs=new Set(g.filter(x=>!x.stale).map(x=>x.direction).filter(x=>x!=="neutral"));
    return {
      concept,
      evidenceIds:g.map(x=>x.id),
      tributaries:[...new Set(g.map(x=>x.tributary))],
      corroborated:g.filter(x=>!x.stale).length>1 && dirs.size===1,
      contradictory:dirs.size>1,
      staleCount:g.filter(x=>x.stale).length,
      rule:g.length>1?"Treat overlapping evidence as corroboration/context, not additive independent signal.":"Single evidence stream."
    };
  });
  return {
    version:1,source:"Super SAGE Columbia Evidence Reconciliation",
    evidence:rows,concepts,
    contradictions:concepts.filter(x=>x.contradictory).map(x=>x.concept),
    staleConcepts:concepts.filter(x=>x.staleCount>0).map(x=>x.concept),
    rules:[
      "Do not double-count correlated metrics or repeated descriptions of the same underlying concept.",
      "Corroboration can raise confidence but does not multiply effect size.",
      "Contradictory current evidence must be surfaced to SAGE Skeptic.",
      "Stale evidence cannot overrule fresher verified evidence.",
      "Missing evidence remains uncertainty rather than negative evidence."
    ],
    canChangeProductionRanking:false
  };
}
module.exports={reconcileColumbiaEvidence};
