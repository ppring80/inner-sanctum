"use strict";

const IMPACT_MAP={
  QB:["QB","WR","TE","RB"],
  RB:["RB","QB"],
  WR:["WR","QB","TE","RB"],
  TE:["TE","QB","WR","RB"],
  OL:["QB","RB","WR","TE"],
  CB:["OPP_WR","OPP_QB"],
  S:["OPP_QB","OPP_WR","OPP_TE"],
  LB:["OPP_RB","OPP_TE","OPP_QB"],
  EDGE:["OPP_QB","OPP_WR","OPP_TE","OPP_RB"],
  DL:["OPP_RB","OPP_QB"]
};

function buildImpactGraph({event,team,opponent,position,player=null}={}) {
  if(!event||!team||!position) throw new Error("Impact graph requires event, team and position.");
  const channels=IMPACT_MAP[position]||[];
  const affected=channels.map(channel=>{
    const opp=channel.startsWith("OPP_");
    return {
      team:opp?(opponent||null):team,
      position:opp?channel.replace("OPP_",""):channel,
      reason:opp
        ? position+" change on "+team+" alters opponent "+channel.replace("OPP_","")+" matchup context."
        : position+" change on "+team+" alters "+channel+" role/protection/opportunity context."
    };
  }).filter(x=>x.team);
  return {
    version:1,source:"Super SAGE Columbia Impact Graph",
    event,player,team,opponent:opponent||null,position,
    affected,
    reanalysisScope:[...new Set(affected.map(x=>x.team+":"+x.position))],
    rules:[
      "Propagate only to plausibly affected position groups.",
      "Impact propagation schedules re-analysis; it does not assume the direction of the effect.",
      "Replacement opportunity requires separate role evidence.",
      "Defensive personnel changes propagate to opponent matchup intelligence.",
      "Offensive-line changes propagate broadly because they can alter both rushing and passing environments."
    ],
    canChangeProductionRanking:false
  };
}
module.exports={IMPACT_MAP,buildImpactGraph};
