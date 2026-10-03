"use strict";
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function add(out,label,value,unit=null,sample=null,source=null){if(value!==null&&value!==undefined)out.push({label,value,unit,sample,source});}
function buildWrMatchupIntelligence({player,offense,defense,schemeTeam,opportunity={},stressContext={}}={}) {
  if(!player||!defense) throw new Error("WR matchup intelligence requires player and defense.");
  const d=schemeTeam?.defense||{}, adv=[];
  add(adv,"Defense zone",finite(d.zonePct),"percent",schemeTeam?.sample,schemeTeam?.source);
  add(adv,"Defense man",finite(d.manPct),"percent",schemeTeam?.sample,schemeTeam?.source);
  add(adv,"Middle closed",finite(d.middleClosedPct),"percent",schemeTeam?.sample,schemeTeam?.source);
  add(adv,"Middle open",finite(d.middleOpenPct),"percent",schemeTeam?.sample,schemeTeam?.source);
  [0,1,2,3,4,6].forEach(n=>add(adv,`Cover ${n}`,finite(d[`cover${n}Pct`]),"percent",schemeTeam?.sample,schemeTeam?.source));
  add(adv,"Targets/game",finite(opportunity.targetsPerGame),"targets",opportunity.sample,opportunity.source);
  add(adv,"Target share",finite(opportunity.targetSharePct),"percent",opportunity.sample,opportunity.source);
  add(adv,"Air yards/game",finite(opportunity.airYardsPerGame),"yards",opportunity.sample,opportunity.source);
  add(adv,"Air-yard share",finite(opportunity.airYardSharePct),"percent",opportunity.sample,opportunity.source);
  add(adv,"aDOT",finite(opportunity.adot),"yards",opportunity.sample,opportunity.source);
  add(adv,"Explosive target rate",finite(opportunity.explosiveTargetPct),"percent",opportunity.sample,opportunity.source);
  add(adv,"Slot alignment",finite(opportunity.slotPct),"percent",opportunity.sample,opportunity.source);
  add(adv,"Outside alignment",finite(opportunity.outsidePct),"percent",opportunity.sample,opportunity.source);
  add(adv,"Targets under QB disruption",finite(stressContext.targetShareUnderDisruptionPct),"percent",stressContext.sample,stressContext.source);
  const hasCoverage=finite(d.zonePct)!==null||finite(d.manPct)!==null;
  const hasOpportunity=finite(opportunity.targetSharePct)!==null||finite(opportunity.targetsPerGame)!==null;
  const primaryInteraction=hasCoverage&&hasOpportunity?"coverage-opportunity":hasOpportunity?"opportunity-quality":hasCoverage?"coverage-structure":"insufficient-advanced-evidence";
  return {
    version:1,player,position:"WR",offense:offense||null,defense,
    primaryInteraction,
    summary:{
      oneSecond:"WR MATCHUP ANALYSIS READY",
      threeSecond:primaryInteraction==="coverage-opportunity"
        ?"The key question is whether this receiver's role and opportunity fit the coverage structure he is likely to face."
        :primaryInteraction==="opportunity-quality"
          ?"Recent target and air-yard opportunity are the clearest verified forward signals."
          :primaryInteraction==="coverage-structure"
            ?"The opponent's coverage structure is known, but receiver-specific response evidence is still incomplete."
            :"More verified receiver matchup evidence is required."
    },
    advancedDetail:{metrics:adv,caveats:[
      "Coverage tendency alone is not a receiver advantage.",
      "Targets and air yards describe opportunity, not guaranteed fantasy production.",
      "Do not infer man/zone or coverage-family player splits when they are not directly sourced.",
      "Preserve alignment, sample, timeframe and source when available."
    ]},
    progressiveDisclosure:{prompt:`Would you like the deeper SAGE analysis on ${player}?`,yes:"Show verified coverage, alignment, target, air-yard, stress-redistribution and sample-aware evidence.",no:"Stop after the 1/3/10 summary."},
    canChangeProductionRanking:false
  };
}
module.exports={buildWrMatchupIntelligence};
