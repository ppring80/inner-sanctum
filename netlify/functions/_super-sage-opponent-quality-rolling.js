"use strict";
function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function mean(a){const v=a.filter(x=>n(x)!==null).map(Number);return v.length?v.reduce((s,x)=>s+x,0)/v.length:null;}
function buildRollingOpponentQuality(defenses={}){
  const games=[];
  for(const [defTeam,d] of Object.entries(defenses||{})){
    for(const g of d.gamesUsed||[]){
      games.push({defTeam,week:Number(g.week),opponent:g.opponent,
        passYards:n(g.opponentPassYards),passAttempts:n(g.opponentPassAttempts),
        rushYards:n(g.opponentRushYards),rushAttempts:n(g.opponentRushAttempts)});
    }
  }
  games.sort((a,b)=>a.week-b.week);
  const history={}; const enriched=[];
  for(const g of games){
    const h=history[g.opponent]||[];
    const priorPassYpa=mean(h.map(x=>x.passAttempts?x.passYards/x.passAttempts:null));
    const priorRushYpc=mean(h.map(x=>x.rushAttempts?x.rushYards/x.rushAttempts:null));
    enriched.push({...g,opponentPriorGames:h.length,
      opponentPriorPassYpa:priorPassYpa===null?null:Number(priorPassYpa.toFixed(2)),
      opponentPriorRushYpc:priorRushYpc===null?null:Number(priorRushYpc.toFixed(2))});
    (history[g.opponent]??=[]).push(g);
  }
  const byDefense={};
  for(const g of enriched){
    const a=byDefense[g.defTeam]??={games:0,adjustablePassGames:0,adjustableRushGames:0,passOpponentBaselineYpa:[],rushOpponentBaselineYpc:[]};
    a.games++;
    if(g.opponentPriorPassYpa!==null){a.adjustablePassGames++;a.passOpponentBaselineYpa.push(g.opponentPriorPassYpa);}
    if(g.opponentPriorRushYpc!==null){a.adjustableRushGames++;a.rushOpponentBaselineYpc.push(g.opponentPriorRushYpc);}
  }
  for(const a of Object.values(byDefense)){
    a.passOpponentBaselineYpa=mean(a.passOpponentBaselineYpa); if(a.passOpponentBaselineYpa!==null)a.passOpponentBaselineYpa=Number(a.passOpponentBaselineYpa.toFixed(2));
    a.rushOpponentBaselineYpc=mean(a.rushOpponentBaselineYpc); if(a.rushOpponentBaselineYpc!==null)a.rushOpponentBaselineYpc=Number(a.rushOpponentBaselineYpc.toFixed(2));
  }
  return {version:1,source:"Inner Sanctum rolling opponent-quality context",byDefense,games:enriched,
    rules:["Each game's opponent baseline uses only that opponent's earlier games in the supplied evidence window.","Week 1 has no prior baseline and remains unadjusted.","Missing pregame baseline remains missing; future games are never backfilled into the baseline.","Opponent quality is context and confidence evidence, not a production ranking change."],canChangeProductionRanking:false};
}
module.exports={buildRollingOpponentQuality};
