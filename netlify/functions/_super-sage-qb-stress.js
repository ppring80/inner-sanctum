"use strict";

function pct(n,d){return d>0?Number((100*n/d).toFixed(1)):null;}
function rate(sum,n){return n>0?Number((sum/n).toFixed(3)):null;}

function buildQbStressProfile(plays=[], {qbId=null,qbName=null}={}) {
  const rows=plays.filter((p)=>{
    const isQb=!qbId || p.passer_player_id===qbId || p.rusher_player_id===qbId;
    return isQb && Number(p.qb_dropback)===1;
  });
  const disruption=rows.filter((p)=>Number(p.sack)===1 || Number(p.qb_hit)===1);
  const cleanProxy=rows.filter((p)=>!(Number(p.sack)===1 || Number(p.qb_hit)===1));
  const summarize=(xs)=>({
    dropbacks:xs.length,
    epaPerDropback:rate(xs.reduce((a,p)=>a+(Number(p.epa)||0),0),xs.length),
    successPct:pct(xs.filter((p)=>Number(p.success)===1).length,xs.length),
    sackPct:pct(xs.filter((p)=>Number(p.sack)===1).length,xs.length),
    scramblePct:pct(xs.filter((p)=>Number(p.qb_scramble)===1).length,xs.length),
    explosivePct:pct(xs.filter((p)=>Number(p.yards_gained)>=20).length,xs.length),
    cpoe:rate(xs.reduce((a,p)=>a+(Number(p.cpoe)||0),0),xs.filter((p)=>Number.isFinite(Number(p.cpoe))).length)
  });
  return {
    version:1,
    qbId,qbName,
    all:summarize(rows),
    disruptionProxy:summarize(disruption),
    noRecordedDisruptionProxy:summarize(cleanProxy),
    disruptionProxyPct:pct(disruption.length,rows.length),
    pressureDefinition:"Public-PBP proxy: sack OR recorded QB hit. This is not equivalent to charted pressure/hurry data.",
    limitations:[
      "Do not label the disruption proxy as true pressure rate.",
      "Blitz classification requires a separately sourced blitz/coverage dataset.",
      "Four-man pressure requires rush-count or charting evidence.",
      "Use charted was_pressure/time_to_throw when available and temporally valid."
    ],
    canChangeProductionRanking:false
  };
}

function compareQbToDefenseStress(qbProfile, defense={}) {
  const defenseDisruptionPct=Number.isFinite(Number(defense.disruptionProxyPct))?Number(defense.disruptionProxyPct):null;
  return {
    qb:qbProfile,
    defenseStress:{disruptionProxyPct:defenseDisruptionPct,blitzPct:defense.blitzPct??null,chartedPressurePct:defense.pressurePct??null},
    interpretationReady:Boolean(qbProfile?.all?.dropbacks && (defenseDisruptionPct!==null || defense.blitzPct!=null || defense.pressurePct!=null)),
    rules:[
      "Separate blitz frequency from pressure/disruption outcome.",
      "A high-blitz defense is not automatically a bad QB matchup.",
      "Compare QB efficiency under stress with the defense's ability to create that same stress.",
      "Preserve sample size and definition in customer-facing advanced detail."
    ],
    canChangeProductionRanking:false
  };
}

module.exports={buildQbStressProfile,compareQbToDefenseStress};
