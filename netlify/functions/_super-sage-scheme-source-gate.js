"use strict";

const REQUIRED_COVERAGE_FIELDS=["zonePct","manPct"];
const DESIRED_COVERAGE_FIELDS=["cover0Pct","cover1Pct","cover2Pct","cover3Pct","cover4Pct","cover6Pct"];

function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function evaluateSchemeSource({source,season,throughWeek,observedAt,usageStatus,teams={},sampleField="dropbacks"}={}) {
  const teamEntries=Object.entries(teams||{});
  const all32=teamEntries.length===32;
  const missingCore=[];
  const missingSample=[];
  const shellCoverage={};
  for(const [team,row] of teamEntries){
    for(const f of REQUIRED_COVERAGE_FIELDS) if(finite(row&&row[f])===null) missingCore.push(team+":"+f);
    if(finite(row&&row[sampleField])===null) missingSample.push(team+":"+sampleField);
    shellCoverage[team]=DESIRED_COVERAGE_FIELDS.filter(f=>finite(row&&row[f])!==null);
  }
  const usageApproved=["licensed","public_api_approved","owned","permission_confirmed"].includes(String(usageStatus||"").toLowerCase());
  const coreComplete=all32&&missingCore.length===0&&missingSample.length===0;
  return {
    version:1,source:source||null,season:season||null,throughWeek:throughWeek||null,observedAt:observedAt||null,
    usageStatus:usageStatus||"unknown",teamCount:teamEntries.length,
    checks:{all32,coreComplete,usageApproved,hasSeason:Boolean(season),hasThroughWeek:Number.isInteger(Number(throughWeek)),hasObservedAt:Boolean(observedAt)},
    missingCore:missingCore.slice(0,100),missingSample:missingSample.slice(0,100),shellCoverage,
    decision:coreComplete&&usageApproved&&season&&throughWeek&&observedAt?"APPROVED_FOR_COLUMBIA":"DO_NOT_INGEST",
    rules:[
      "Coverage knowledge definitions are not team observations.",
      "Do not ingest a source without explicit sustainable usage status.",
      "Every team observation requires season/week window, freshness and sample.",
      "Zone/man are core; individual shell rates may remain partially dry until verified.",
      "Never synthesize missing Cover 0/1/2/3/4/6 percentages."
    ],
    canChangeProductionRanking:false
  };
}
module.exports={REQUIRED_COVERAGE_FIELDS,DESIRED_COVERAGE_FIELDS,evaluateSchemeSource};
