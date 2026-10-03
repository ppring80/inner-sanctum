"use strict";
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function add(out,label,value,unit=null,sample=null,source=null){if(value!==null&&value!==undefined)out.push({label,value,unit,sample,source});}
function buildTeMatchupIntelligence({player,offense,defense,schemeTeam,opportunity={},stressContext={}}={}) {
  if(!player||!defense) throw new Error("TE matchup intelligence requires player and defense.");
  const d=schemeTeam?.defense||{}, o=schemeTeam?.offense||{}, adv=[];
  add(adv,"Middle closed",finite(d.middleClosedPct),"percent",schemeTeam?.sample,schemeTeam?.source);
  add(adv,"Middle open",finite(d.middleOpenPct),"percent",schemeTeam?.sample,schemeTeam?.source);
  add(adv,"Defense zone",finite(d.zonePct),"percent",schemeTeam?.sample,schemeTeam?.source);
  add(adv,"Defense man",finite(d.manPct),"percent",schemeTeam?.sample,schemeTeam?.source);
  [1,2,3,4,6].forEach(n=>add(adv,`Cover ${n}`,finite(d[`cover${n}Pct`]),"percent",schemeTeam?.sample,schemeTeam?.source));
  add(adv,"12 personnel",finite(o.personnel12Pct),"percent",schemeTeam?.sample,schemeTeam?.source);
  add(adv,"13 personnel",finite(o.personnel13Pct),"percent",schemeTeam?.sample,schemeTeam?.source);
  add(adv,"Targets/game",finite(opportunity.targetsPerGame),"targets",opportunity.sample,opportunity.source);
  add(adv,"Target share",finite(opportunity.targetSharePct),"percent",opportunity.sample,opportunity.source);
  add(adv,"Routes/game",finite(opportunity.routesPerGame),"routes",opportunity.sample,opportunity.source);
  add(adv,"Route participation",finite(opportunity.routeParticipationPct),"percent",opportunity.sample,opportunity.source);
  add(adv,"Red-zone target share",finite(opportunity.redZoneTargetSharePct),"percent",opportunity.sample,opportunity.source);
  add(adv,"aDOT",finite(opportunity.adot),"yards",opportunity.sample,opportunity.source);
  add(adv,"Targets under QB disruption",finite(stressContext.targetShareUnderDisruptionPct),"percent",stressContext.sample,stressContext.source);
  const hasMiddle=finite(d.middleClosedPct)!==null||finite(d.middleOpenPct)!==null;
  const hasRole=finite(opportunity.targetSharePct)!==null||finite(opportunity.targetsPerGame)!==null||finite(opportunity.routeParticipationPct)!==null;
  const primaryInteraction=hasMiddle&&hasRole?"middle-field-role":hasRole?"te-opportunity":hasMiddle?"middle-field-structure":"insufficient-advanced-evidence";
  return {
    version:1,player,position:"TE",offense:offense||null,defense,primaryInteraction,
    summary:{oneSecond:"TE MATCHUP ANALYSIS READY",threeSecond:
      primaryInteraction==="middle-field-role"?"The key matchup is how this tight end's route/target role interacts with the defense's middle-field structure."
      :primaryInteraction==="te-opportunity"?"Routes and targets are the clearest verified indicators of the tight end's usable fantasy role."
      :primaryInteraction==="middle-field-structure"?"The defense's middle-field structure is known, but TE-specific opportunity evidence is incomplete."
      :"More verified tight-end matchup evidence is required."},
    advancedDetail:{metrics:adv,caveats:[
      "Middle-open or middle-closed structure alone is not a TE advantage.",
      "Personnel usage does not prove a specific TE is running routes.",
      "Routes/targets and red-zone opportunity require player-level evidence.",
      "Do not infer linebacker/safety coverage assignments without sourced charting."
    ]},
    progressiveDisclosure:{prompt:`Would you like the deeper SAGE analysis on ${player}?`,yes:"Show verified middle-field structure, personnel, route, target, red-zone and stress-redistribution evidence.",no:"Stop after the 1/3/10 summary."},
    canChangeProductionRanking:false
  };
}
module.exports={buildTeMatchupIntelligence};
