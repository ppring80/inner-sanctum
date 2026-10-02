"use strict";

function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function metric(label,value,unit=null,sample=null,source=null){
  return {label,value,unit,sample,source};
}

function buildQbMatchupIntelligence({qb,offense,defense,schemeTeam,stressProfile}={}) {
  if (!qb || !defense) throw new Error("QB matchup intelligence requires qb and defense.");
  const def=schemeTeam?.defense||{};
  const off=schemeTeam?.offense||offense||{};
  const stress=stressProfile||{};
  const advanced=[];
  const add=(label,value,unit,sample,source)=>{if(value!==null&&value!==undefined)advanced.push(metric(label,value,unit,sample,source));};

  add("Defense zone",finite(def.zonePct),"percent",schemeTeam?.sample,schemeTeam?.source);
  add("Defense man",finite(def.manPct),"percent",schemeTeam?.sample,schemeTeam?.source);
  add("Middle closed",finite(def.middleClosedPct),"percent",schemeTeam?.sample,schemeTeam?.source);
  add("Middle open",finite(def.middleOpenPct),"percent",schemeTeam?.sample,schemeTeam?.source);
  for (const n of [0,1,2,3,4,6]) add(`Cover ${n}`,finite(def[`cover${n}Pct`]),"percent",schemeTeam?.sample,schemeTeam?.source);
  add("Defense blitz",finite(def.blitzPct),"percent",schemeTeam?.sample,schemeTeam?.source);
  add("Defense charted pressure",finite(def.pressurePct),"percent",schemeTeam?.sample,schemeTeam?.source);
  add("QB disruption proxy",finite(stress.disruptionProxyPct),"percent",stress.all?.dropbacks||null,"Historical Lab V2");
  add("QB EPA/dropback",finite(stress.all?.epaPerDropback),"EPA",stress.all?.dropbacks||null,"Historical Lab V2");
  add("QB EPA/dropback disrupted",finite(stress.disruptionProxy?.epaPerDropback),"EPA",stress.disruptionProxy?.dropbacks||null,"Historical Lab V2");
  add("QB sack rate disrupted",finite(stress.disruptionProxy?.sackPct),"percent",stress.disruptionProxy?.dropbacks||null,"Historical Lab V2");
  add("QB scramble rate",finite(stress.all?.scramblePct),"percent",stress.all?.dropbacks||null,"Historical Lab V2");
  add("QB explosive rate",finite(stress.all?.explosivePct),"percent",stress.all?.dropbacks||null,"Historical Lab V2");
  add("Offense motion",finite(off.motionPct),"percent",schemeTeam?.sample,schemeTeam?.source);
  add("Offense play action",finite(off.playActionPct),"percent",schemeTeam?.sample,schemeTeam?.source);

  const stressDelta=(finite(stress.disruptionProxy?.epaPerDropback)!==null&&finite(stress.noRecordedDisruptionProxy?.epaPerDropback)!==null)
    ? Number((stress.disruptionProxy.epaPerDropback-stress.noRecordedDisruptionProxy.epaPerDropback).toFixed(3)):null;

  const primaryInteraction =
    finite(def.pressurePct)!==null && stressDelta!==null
      ? "pressure-response"
      : finite(def.blitzPct)!==null
        ? "blitz-response"
        : finite(def.zonePct)!==null || finite(def.manPct)!==null
          ? "coverage-structure"
          : "insufficient-advanced-evidence";

  return {
    version:1,
    qb,
    offense:offense||null,
    defense,
    primaryInteraction,
    stressDeltaEpa:stressDelta,
    summary:{
      oneSecond:"MATCHUP ANALYSIS READY",
      threeSecond:
        primaryInteraction==="pressure-response"
          ? "The key matchup is whether the defense can create the type of pocket stress that changes this QB's efficiency."
          : primaryInteraction==="blitz-response"
            ? "Blitz tendency is the clearest verified stress signal, but blitz must not be confused with actual pressure."
            : primaryInteraction==="coverage-structure"
              ? "Coverage structure is the clearest verified matchup signal; deeper QB-vs-coverage splits are still required."
              : "More verified matchup evidence is required."
    },
    advancedDetail:{
      metrics:advanced,
      stressDefinition:stress.pressureDefinition||null,
      sampleRules:"Every advanced metric must preserve its own sample/timeframe/source.",
      caveats:[
        "Scheme tendency alone is not a fantasy verdict.",
        "Blitz and pressure are separate variables.",
        "Public-PBP disruption proxy is not charted pressure.",
        "Do not infer missing QB-vs-coverage splits."
      ]
    },
    progressiveDisclosure:{
      prompt:`Would you like the deeper SAGE analysis on ${qb}?`,
      yes:"Show verified scheme, stress, opportunity and sample-aware evidence.",
      no:"Stop after the 1/3/10 summary."
    },
    canChangeProductionRanking:false
  };
}

module.exports={buildQbMatchupIntelligence};
