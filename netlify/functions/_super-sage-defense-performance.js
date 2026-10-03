"use strict";

const METRICS={
  pass:{epa:"passEpaPerDropback",success:"passSuccessPct",yards:"passYardsPerGame",td:"passTdsAllowed"},
  rush:{epa:"rushEpaPerCarry",success:"rushSuccessPct",yards:"rushYardsPerGame",td:"rushTdsAllowed"}
};
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function rankTeams(rows,key,{lowerBetter=true}={}){
  const valid=rows.filter(r=>finite(r[key])!==null).sort((a,b)=>lowerBetter?finite(a[key])-finite(b[key]):finite(b[key])-finite(a[key]));
  const ranks={}; valid.forEach((r,i)=>{ranks[r.team]=i+1;}); return ranks;
}
function buildDefensivePerformanceMatrix(rows=[],meta={}){
  const passRanks=rankTeams(rows,"passEpaPerDropback",{lowerBetter:true});
  const rushRanks=rankTeams(rows,"rushEpaPerCarry",{lowerBetter:true});
  const passYardsRanks=rankTeams(rows,"passYardsPerGame",{lowerBetter:true});
  const rushYardsRanks=rankTeams(rows,"rushYardsPerGame",{lowerBetter:true});
  const teams={};
  for(const r of rows){
    teams[r.team]={
      team:r.team,season:meta.season??r.season??null,throughWeek:meta.throughWeek??r.throughWeek??null,
      observedAt:meta.observedAt??r.observedAt??null,source:meta.source??r.source??null,
      sample:{games:finite(r.games),dropbacks:finite(r.dropbacks),rushes:finite(r.rushes)},
      pass:{
        epaPerDropback:finite(r.passEpaPerDropback),epaRank:passRanks[r.team]??null,
        successPct:finite(r.passSuccessPct),yardsPerGame:finite(r.passYardsPerGame),yardsRank:passYardsRanks[r.team]??null,
        yardsPerDropback:finite(r.passYardsPerDropback),tdAllowed:finite(r.passTdsAllowed),explosivePct:finite(r.passExplosivePct)
      },
      rush:{
        epaPerCarry:finite(r.rushEpaPerCarry),epaRank:rushRanks[r.team]??null,
        successPct:finite(r.rushSuccessPct),yardsPerGame:finite(r.rushYardsPerGame),yardsRank:rushYardsRanks[r.team]??null,
        yardsPerCarry:finite(r.yardsPerCarry),tdAllowed:finite(r.rushTdsAllowed),explosivePct:finite(r.rushExplosivePct)
      },
      overall:{epaPerPlay:finite(r.defEpaPerPlay),successPct:finite(r.defSuccessPct),pointsAllowedPerGame:finite(r.pointsAllowedPerGame)}
    };
  }
  return {
    version:1,source:"Super SAGE Defensive Performance Tributary",
    rankDefinitions:{
      passEpaRank:"1 = lowest defensive EPA allowed per opponent dropback; lower EPA is better defense.",
      rushEpaRank:"1 = lowest defensive EPA allowed per opponent designed rush/carry; lower EPA is better defense.",
      passYardsRank:"1 = fewest passing yards allowed per game.",
      rushYardsRank:"1 = fewest rushing yards allowed per game."
    },
    teams,teamCount:Object.keys(teams).length,
    rules:[
      "Never say 'ranked X against the pass/run' without naming the ranking metric.",
      "Season rank is context, not matchup verdict.",
      "Preserve recent-window performance separately from season-to-date.",
      "Small samples and opponent quality must be surfaced as uncertainty.",
      "Join performance with scheme, QB/RB/WR/TE matchup intelligence before fantasy interpretation."
    ],
    canChangeProductionRanking:false
  };
}
function buildDefenseTrend({season=null,recent3=null,recent5=null}={}){
  return {season,recent3,recent5,direction:
    season&&recent3&&finite(season.epaRank)!==null&&finite(recent3.epaRank)!==null
      ? recent3.epaRank<season.epaRank?"improving":recent3.epaRank>season.epaRank?"declining":"stable"
      :"unknown"};
}
module.exports={METRICS,buildDefensivePerformanceMatrix,buildDefenseTrend};
