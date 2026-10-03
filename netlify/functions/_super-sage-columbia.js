"use strict";

const POSITION_KEYS={QB:"qb",RB:"rb",WR:"wr",TE:"te"};

function buildPlayerEvidencePacket({player,weeklySage=null,currentEvidence=null,matchupIntelligence=null,historical=null}={}) {
  if(!player?.name||!POSITION_KEYS[player.position]) throw new Error("Supported QB/RB/WR/TE player required.");
  const evidence=Array.isArray(currentEvidence?.evidence)?currentEvidence.evidence:[];
  const stale=Array.isArray(currentEvidence?.stale)?currentEvidence.stale:[];
  return {
    version:1,
    source:"Super SAGE Columbia Evidence Packet",
    player:{
      id:player.id||player.playerID||null,
      name:player.name,
      position:player.position,
      team:player.team||null,
      opponent:player.opponent||null
    },
    weeklySage:weeklySage?{
      rank:weeklySage.rank??weeklySage.positionRank??null,
      overallRank:weeklySage.overallRank??null,
      recommendation:weeklySage.recommendation??null,
      label:weeklySage.sageLabel??null,
      confidence:weeklySage.sageConfidenceLabel??weeklySage.confidence??null,
      matchup:weeklySage.matchup??null,
      take:weeklySage.sageTake??null
    }:null,
    current:{
      evidence:evidence.slice(0,20),
      stale:stale.slice(0,20),
      observedAt:currentEvidence?.observedAt||null
    },
    matchupIntelligence:matchupIntelligence||null,
    historical:historical||null,
    readiness:{
      weeklySage:Boolean(weeklySage),
      currentEvidence:evidence.length>0,
      matchupIntelligence:Boolean(matchupIntelligence),
      historical:Boolean(historical),
      advancedCustomerDetail:Boolean(matchupIntelligence && matchupIntelligence.advancedDetail)
    },
    rules:[
      "Weekly SAGE remains ranking authority.",
      "Current evidence must be timestamped/sourced upstream.",
      "Historical outcomes never become same-week pre-decision features.",
      "Missing tributaries remain missing; do not synthesize them.",
      "Customer output uses 1/3/10 then opt-in deeper analysis."
    ],
    canChangeProductionRanking:false
  };
}

function buildColumbiaWeeklySnapshot({season,week,players=[]}={}) {
  const packets=players.map(buildPlayerEvidencePacket);
  return {
    version:1,source:"The Columbia",season,week,
    generatedAt:new Date().toISOString(),
    playerCount:packets.length,
    byPosition:Object.fromEntries(["QB","RB","WR","TE"].map(pos=>[pos,packets.filter(p=>p.player.position===pos)])),
    packets,
    canChangeProductionRanking:false
  };
}

module.exports={buildPlayerEvidencePacket,buildColumbiaWeeklySnapshot};
