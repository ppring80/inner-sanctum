"use strict";

function clean(v){return v==null?null:String(v).trim()||null;}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}

function evidenceStrength(candidate={}) {
  const intelligence=candidate.intelligence||{};
  const metrics=intelligence.advancedDetail?.metrics||[];
  const sourced=metrics.filter(m=>m && m.source).length;
  const sampled=metrics.filter(m=>m && m.sample).length;
  return {metrics:metrics.length,sourced,sampled};
}

function buildStartSitIntelligence({candidates=[],weeklySagePreferredPlayer=null,weeklySageReason=null}={}) {
  if(!Array.isArray(candidates)||candidates.length<2) throw new Error("Start/Sit intelligence requires at least two candidates.");
  const rows=candidates.map(c=>({
    player:clean(c.player), position:clean(c.position), weeklyRank:finite(c.weeklyRank),
    recommendation:clean(c.recommendation), confidence:clean(c.confidence),
    intelligence:c.intelligence||null, evidenceStrength:evidenceStrength(c)
  }));
  const preferred=rows.find(r=>r.player===weeklySagePreferredPlayer)||null;
  const alternatives=rows.filter(r=>!preferred||r.player!==preferred.player);
  const separator=preferred?.intelligence?.summary?.threeSecond
    || clean(weeklySageReason)
    || "Weekly SAGE prefers this player; deeper verified matchup evidence is available only where supplied.";
  return {
    version:1, source:"Super SAGE Start/Sit Intelligence",
    authority:{
      ranking:"Weekly SAGE", explanation:"Super SAGE",
      rule:"Super SAGE explains the production Weekly SAGE preference; it does not create or reorder rankings."
    },
    preferredPlayer:preferred?.player||clean(weeklySagePreferredPlayer),
    candidates:rows, alternatives:alternatives.map(r=>r.player),
    summary:{
      oneSecond:preferred ? "START " + preferred.player.toUpperCase() : "WEEKLY SAGE PREFERENCE REQUIRED",
      threeSecond:separator,
      tenSecond:{
        whyPreferred:separator,
        primaryRisk:preferred?.intelligence?.advancedDetail?.caveats?.[0]||null,
        confidence:preferred?.confidence||null,
        evidenceCoverage:preferred?.evidenceStrength||null
      }
    },
    progressiveDisclosure:{
      prompt:"Would you like the deeper SAGE comparison?",
      yes:"Compare only verified evidence that materially separates the candidates: role, opportunity, scheme fit, stress exposure, scoring paths, risk, sample and source.",
      no:"Stop after the concise 1/3/10 recommendation."
    },
    guardrails:[
      "Never override or reorder Weekly SAGE.",
      "Do not declare a candidate superior because it has more advanced metrics available.",
      "Missing advanced evidence is uncertainty, not negative evidence.",
      "Use position-specific intelligence rather than forcing unlike positions onto one invented score.",
      "Preserve sample/timeframe/source in advanced comparisons."
    ],
    canChangeProductionRanking:false
  };
}
module.exports={buildStartSitIntelligence};
