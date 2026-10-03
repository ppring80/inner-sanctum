"use strict";
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function weightedMean(rows,valueKey,weightKey){
  let num=0,den=0;
  for(const r of rows){const v=finite(r[valueKey]),w=finite(r[weightKey]);if(v!==null&&w!==null&&w>0){num+=v*w;den+=w;}}
  return den?num/den:null;
}
function buildOpponentQualityAdjustment({games=[],metric="passEpaPerDropback"}={}) {
  const valid=games.filter(g=>finite(g[metric])!==null);
  const adjusted=valid.map(g=>{
    const opponentBaseline=finite(g.opponentBaseline);
    const raw=finite(g[metric]);
    return {...g,opponentAdjusted:opponentBaseline===null?null:Number((raw-opponentBaseline).toFixed(3))};
  });
  const sampleWeight=metric.toLowerCase().includes("pass")?"dropbacks":"rushes";
  const raw=weightedMean(adjusted,metric,sampleWeight);
  const adjRows=adjusted.filter(g=>finite(g.opponentAdjusted)!==null);
  const adjustedMean=weightedMean(adjRows,"opponentAdjusted",sampleWeight);
  return {
    version:1,metric,
    raw:raw===null?null:Number(raw.toFixed(3)),
    opponentAdjusted:adjustedMean===null?null:Number(adjustedMean.toFixed(3)),
    games:adjusted,
    contextFlags:{
      weakOpponentGames:adjusted.filter(g=>g.opponentQuality==="weak").length,
      strongOpponentGames:adjusted.filter(g=>g.opponentQuality==="strong").length,
      backupQbGames:adjusted.filter(g=>g.qbContext==="backup"||g.qbContext==="third-string").length
    },
    rules:[
      "Opponent adjustment is context, not an excuse to discard observed defensive performance.",
      "QB availability/status must come from verified game-time evidence.",
      "Do not infer quarterback quality from name recognition.",
      "Preserve raw and adjusted performance side by side.",
      "Small opponent samples reduce confidence."
    ],
    canChangeProductionRanking:false
  };
}
module.exports={buildOpponentQualityAdjustment};
