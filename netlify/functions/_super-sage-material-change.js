"use strict";
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function delta(a,b){const x=finite(a),y=finite(b);return x===null||y===null?null:Number((y-x).toFixed(3));}
function detectMaterialChanges(previous={},current={},thresholds={}){
  const t={rank:thresholds.rank??4,usagePct:thresholds.usagePct??8,schemePct:thresholds.schemePct??10,linePoints:thresholds.linePoints??2,impliedPoints:thresholds.impliedPoints??2};
  const changes=[];
  const push=(type,field,before,after,material,reason)=>changes.push({type,field,before:before??null,after:after??null,delta:delta(before,after),material,reason});
  if(previous.status!==current.status && current.status) push("availability","status",previous.status,current.status,true,"Player availability changed.");
  for(const f of ["targetSharePct","rushSharePct","routeParticipationPct","snapSharePct"]){
    const d=delta(previous[f],current[f]); if(d!==null) push("role",f,previous[f],current[f],Math.abs(d)>=t.usagePct,"Usage change threshold.");
  }
  for(const f of ["zonePct","manPct","blitzPct","pressurePct","middleClosedPct","middleOpenPct"]){
    const d=delta(previous[f],current[f]); if(d!==null) push("scheme",f,previous[f],current[f],Math.abs(d)>=t.schemePct,"Scheme/stress tendency threshold.");
  }
  const rd=delta(previous.weeklyRank,current.weeklyRank);
  if(rd!==null) push("weekly-sage","weeklyRank",previous.weeklyRank,current.weeklyRank,Math.abs(rd)>=t.rank,"Weekly SAGE rank movement threshold.");
  const sd=delta(previous.spread,current.spread);
  if(sd!==null) push("game-environment","spread",previous.spread,current.spread,Math.abs(sd)>=t.linePoints,"Meaningful spread movement.");
  const ip=delta(previous.teamImpliedPoints,current.teamImpliedPoints);
  if(ip!==null) push("game-environment","teamImpliedPoints",previous.teamImpliedPoints,current.teamImpliedPoints,Math.abs(ip)>=t.impliedPoints,"Meaningful implied-points movement.");
  const material=changes.filter(c=>c.material);
  return {
    version:1,source:"Super SAGE Columbia Material Change Detector",
    materialChange:material.length>0,materialChanges:material,allObservedChanges:changes,
    action:material.length?"REANALYZE_AFFECTED_PLAYERS":"NO_REANALYSIS",
    rules:[
      "Reanalyze affected players, not the entire league, when possible.",
      "Availability changes are material immediately.",
      "Thresholds prevent noise from causing constant refreshes.",
      "A source refresh with no material evidence change does not trigger new reasoning.",
      "Material change detection schedules analysis; it does not itself change a ranking."
    ],
    canChangeProductionRanking:false
  };
}
module.exports={detectMaterialChanges};
