"use strict";
const crypto=require("crypto");
function clean(v){return v==null?null:String(v).trim()||null;}
function createDecisionRecord({season,week,player,decision,evidenceSnapshot,trigger=null,confidence=null,createdAt=null}={}) {
  if(!season||!week||!player?.name||!decision) throw new Error("Decision record requires season, week, player and decision.");
  const at=createdAt||new Date().toISOString();
  const seed=[season,week,player.id||player.name,decision,at].join("|");
  return {
    version:1,id:crypto.createHash("sha256").update(seed).digest("hex").slice(0,24),
    season,week,createdAt:at,
    player:{id:player.id||null,name:player.name,position:player.position||null,team:player.team||null,opponent:player.opponent||null},
    trigger:trigger||{type:"scheduled-weekly"},
    decision:{direction:clean(decision),confidence:clean(confidence)},
    evidenceSnapshot:evidenceSnapshot||null,
    outcome:null,
    learningStatus:"AWAITING_OUTCOME",
    immutableDecisionBoundary:true,
    rules:[
      "Never rewrite the original decision after the outcome is known.",
      "Outcome data is appended only after the decision timestamp.",
      "Separate recommendation-quality failure from explanation-quality failure.",
      "Record material-change reanalysis as a new linked decision, not an overwrite.",
      "Learning may propose hypotheses; production logic changes require validation."
    ]
  };
}
function appendOutcome(record,{observedAt,actualFantasyPoints=null,started=null,outcomeEvidence=null,diagnosis=null}={}) {
  if(!record?.immutableDecisionBoundary) throw new Error("Valid immutable decision record required.");
  return {...record,outcome:{observedAt:observedAt||new Date().toISOString(),actualFantasyPoints,started,outcomeEvidence:outcomeEvidence||null,diagnosis:diagnosis||null},learningStatus:"READY_FOR_REVIEW"};
}
function linkReanalysis(previous,next){return {...next,previousDecisionId:previous?.id||null,reanalysis:true};}
module.exports={createDecisionRecord,appendOutcome,linkReanalysis};
