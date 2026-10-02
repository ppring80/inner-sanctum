"use strict";

const NFL_TEAMS = ["ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE","DAL","DEN","DET","GB","HOU","IND","JAX","KC","LV","LAC","LAR","MIA","MIN","NE","NO","NYG","NYJ","PHI","PIT","SEA","SF","TB","TEN","WSH"];

function finite(value) {
  const n=Number(value);
  return Number.isFinite(n)?n:null;
}

function normalizeSchemeTeam(input={}) {
  if (!NFL_TEAMS.includes(input.team)) throw new Error("Unknown NFL team");
  if (!input.observedAt || !Number.isFinite(Date.parse(input.observedAt))) throw new Error("observedAt required");
  if (!input.source) throw new Error("source required");
  return {
    team:input.team,
    season:finite(input.season),
    week:finite(input.week),
    observedAt:new Date(input.observedAt).toISOString(),
    source:String(input.source),
    sourceUrl:input.sourceUrl||null,
    sample:input.sample||null,
    defense:{
      manPct:finite(input.defense?.manPct),
      zonePct:finite(input.defense?.zonePct),
      middleClosedPct:finite(input.defense?.middleClosedPct),
      middleOpenPct:finite(input.defense?.middleOpenPct),
      cover0Pct:finite(input.defense?.cover0Pct),
      cover1Pct:finite(input.defense?.cover1Pct),
      cover2Pct:finite(input.defense?.cover2Pct),
      cover3Pct:finite(input.defense?.cover3Pct),
      cover4Pct:finite(input.defense?.cover4Pct),
      cover6Pct:finite(input.defense?.cover6Pct),
      blitzPct:finite(input.defense?.blitzPct),
      pressurePct:finite(input.defense?.pressurePct),
      lightBoxPct:finite(input.defense?.lightBoxPct),
      heavyBoxPct:finite(input.defense?.heavyBoxPct),
      subPackagePct:finite(input.defense?.subPackagePct)
    },
    offense:{
      motionPct:finite(input.offense?.motionPct),
      playActionPct:finite(input.offense?.playActionPct),
      airYardsPerAttempt:finite(input.offense?.airYardsPerAttempt),
      shotgunPct:finite(input.offense?.shotgunPct),
      noHuddlePct:finite(input.offense?.noHuddlePct),
      personnel11Pct:finite(input.offense?.personnel11Pct),
      personnel12Pct:finite(input.offense?.personnel12Pct),
      personnel13Pct:finite(input.offense?.personnel13Pct),
      personnel21Pct:finite(input.offense?.personnel21Pct),
      personnel22Pct:finite(input.offense?.personnel22Pct),
      twoPlusTePct:finite(input.offense?.twoPlusTePct),
      twoPlusRbPct:finite(input.offense?.twoPlusRbPct),
      threePlusWrPct:finite(input.offense?.threePlusWrPct),
      epaPerPlay:finite(input.offense?.epaPerPlay),
      explosivePlayPct:finite(input.offense?.explosivePlayPct)
    }
  };
}

function buildSchemeMatrix(rows=[]) {
  const teams={};
  for (const row of rows) {
    const normalized=normalizeSchemeTeam(row);
    const current=teams[normalized.team];
    if (!current || Date.parse(normalized.observedAt)>=Date.parse(current.observedAt)) teams[normalized.team]=normalized;
  }
  return {
    version:1,
    source:"Super SAGE Scheme Matrix",
    teams,
    teamCount:Object.keys(teams).length,
    complete:Object.keys(teams).length===32,
    missingTeams:NFL_TEAMS.filter((team)=>!teams[team]),
    canChangeProductionRanking:false,
    rules:[
      "Scheme rates are current evidence, not permanent team identity.",
      "Preserve source, timestamp and sample.",
      "Missing coverage families remain null; never infer them from man/zone or shell rates.",
      "A matchup conclusion requires offense-defense interaction evidence, not tendency alone."
    ]
  };
}

module.exports={NFL_TEAMS,normalizeSchemeTeam,buildSchemeMatrix};
