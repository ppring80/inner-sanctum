"use strict";
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function buildGameEnvironment({team,opponent,total,spread,teamImpliedPoints,opponentImpliedPoints,observedAt,source}={}) {
  if(!team||!opponent) throw new Error("Game environment requires team and opponent.");
  const t=finite(total),s=finite(spread);
  const tip=finite(teamImpliedPoints)!==null?finite(teamImpliedPoints):(t!==null&&s!==null?Number(((t-s)/2).toFixed(1)):null);
  const oip=finite(opponentImpliedPoints)!==null?finite(opponentImpliedPoints):(t!==null&&s!==null?Number(((t+s)/2).toFixed(1)):null);
  return {
    version:1,team,opponent,observedAt:observedAt||null,source:source||null,
    total:t,spread:s,teamImpliedPoints:tip,opponentImpliedPoints:oip,
    contextualSignals:{
      expectedScoring:tip===null?"unknown":tip>=27?"high":tip<=19?"low":"normal",
      expectedScript:s===null?"unknown":s<=-6?"favored":s>=6?"underdog":"competitive"
    },
    fantasyChannels:[
      "team touchdown opportunity",
      "QB/WR/TE pass-volume environment",
      "RB rushing script when leading",
      "RB receiving/checkdown script when trailing"
    ],
    rules:[
      "Market context is not a player recommendation.",
      "Do not convert spread into guaranteed game script.",
      "Preserve timestamp/source because lines move.",
      "Use implied points as one tributary alongside role, matchup, scheme and current evidence.",
      "Re-evaluate only when a meaningful line move or underlying news changes the context."
    ],
    canChangeProductionRanking:false
  };
}
module.exports={buildGameEnvironment};
