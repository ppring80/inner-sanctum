"use strict";
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function add(out,label,value,unit=null,sample=null,source=null){if(value!==null&&value!==undefined)out.push({label,value,unit,sample,source});}
function buildRbMatchupIntelligence({player,offense,defense,schemeTeam,opportunity={},gameContext={}}={}) {
  if(!player||!defense) throw new Error("RB matchup intelligence requires player and defense.");
  const d=schemeTeam?.defense||{}, o=schemeTeam?.offense||{}, adv=[];
  add(adv,"Light box",finite(d.lightBoxPct),"percent",schemeTeam?.sample,schemeTeam?.source);
  add(adv,"Heavy box",finite(d.heavyBoxPct),"percent",schemeTeam?.sample,schemeTeam?.source);
  add(adv,"Sub-package",finite(d.subPackagePct),"percent",schemeTeam?.sample,schemeTeam?.source);
  add(adv,"11 personnel",finite(o.personnel11Pct),"percent",schemeTeam?.sample,schemeTeam?.source);
  add(adv,"12 personnel",finite(o.personnel12Pct),"percent",schemeTeam?.sample,schemeTeam?.source);
  add(adv,"21 personnel",finite(o.personnel21Pct),"percent",schemeTeam?.sample,schemeTeam?.source);
  add(adv,"Carries/game",finite(opportunity.carriesPerGame),"carries",opportunity.sample,opportunity.source);
  add(adv,"Rush share",finite(opportunity.rushSharePct),"percent",opportunity.sample,opportunity.source);
  add(adv,"Targets/game",finite(opportunity.targetsPerGame),"targets",opportunity.sample,opportunity.source);
  add(adv,"Target share",finite(opportunity.targetSharePct),"percent",opportunity.sample,opportunity.source);
  add(adv,"Routes/game",finite(opportunity.routesPerGame),"routes",opportunity.sample,opportunity.source);
  add(adv,"Route participation",finite(opportunity.routeParticipationPct),"percent",opportunity.sample,opportunity.source);
  add(adv,"Red-zone carries",finite(opportunity.redZoneCarriesPerGame),"carries",opportunity.sample,opportunity.source);
  add(adv,"Goal-line carry share",finite(opportunity.goalLineCarrySharePct),"percent",opportunity.sample,opportunity.source);
  add(adv,"Red-zone target share",finite(opportunity.redZoneTargetSharePct),"percent",opportunity.sample,opportunity.source);
  add(adv,"Targets when trailing",finite(gameContext.targetsWhenTrailingPerGame),"targets",gameContext.sample,gameContext.source);
  add(adv,"Carries when leading",finite(gameContext.carriesWhenLeadingPerGame),"carries",gameContext.sample,gameContext.source);
  const rushingRole=finite(opportunity.carriesPerGame)!==null||finite(opportunity.rushSharePct)!==null;
  const receivingRole=finite(opportunity.targetsPerGame)!==null||finite(opportunity.routeParticipationPct)!==null;
  const boxKnown=finite(d.lightBoxPct)!==null||finite(d.heavyBoxPct)!==null;
  let primaryInteraction="insufficient-advanced-evidence";
  if(rushingRole&&receivingRole&&boxKnown) primaryInteraction="dual-role-vs-box";
  else if(rushingRole&&boxKnown) primaryInteraction="rushing-role-vs-box";
  else if(receivingRole) primaryInteraction="receiving-role";
  else if(rushingRole) primaryInteraction="rushing-role";
  return {
    version:1,player,position:"RB",offense:offense||null,defense,primaryInteraction,
    summary:{oneSecond:"RB MATCHUP ANALYSIS READY",threeSecond:
      primaryInteraction==="dual-role-vs-box"?"The key matchup is how the back's rushing workload and receiving role combine against the expected box structure."
      :primaryInteraction==="rushing-role-vs-box"?"The rushing workload is clear; expected box structure is the primary matchup variable."
      :primaryInteraction==="receiving-role"?"Receiving usage provides the clearest verified fantasy path, even if the rushing matchup is uncertain."
      :primaryInteraction==="rushing-role"?"Carry volume is the clearest verified role signal; richer defensive-front evidence is still needed."
      :"More verified running-back matchup evidence is required."},
    advancedDetail:{metrics:adv,caveats:[
      "Box tendency alone does not determine rushing efficiency.",
      "A difficult rushing matchup can be offset by receiving usage in fantasy.",
      "Personnel grouping does not prove which RB receives the touch.",
      "Goal-line and red-zone roles require player-level evidence.",
      "Game-script splits describe historical behavior, not guaranteed future script."
    ]},
    progressiveDisclosure:{prompt:`Would you like the deeper SAGE analysis on ${player}?`,yes:"Show verified box/front, rushing, receiving, red-zone, personnel and game-state evidence.",no:"Stop after the 1/3/10 summary."},
    canChangeProductionRanking:false
  };
}
module.exports={buildRbMatchupIntelligence};
