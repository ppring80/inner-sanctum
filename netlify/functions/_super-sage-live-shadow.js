"use strict";

// SUPER SAGE — LIVE SHADOW COMPARISON HARNESS V1
//
// Purpose: pair a customer-facing production lineup decision with a
// non-authoritative shadow Operator review without changing the customer call.
// This is the bridge from synthetic training to real Decision Labs.
//
// HARD BOUNDARY:
// - productionRecord is immutable input and remains the only customer decision.
// - shadowReview is observational only.
// - no provider fetches, outcomes, ranking mutation, or automatic promotion.
// - a disagreement is a learning case candidate, never a production override.

const crypto=require("crypto");

const VERSION=1;
const GRADES=new Set(["PASS","PASS_DIFFERENT_CALL","QUESTIONABLE","FAIL","UNREVIEWED"]);
const clean=v=>v==null?null:String(v).trim()||null;
const hash=v=>crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0,24);

function slotMap(record){
  const m=new Map();
  for(const s of (record&&record.slots)||[]) m.set(String(s.slotLabel||"").toUpperCase(),s);
  return m;
}

function buildLiveShadowComparison({season,week,scoring,productionRecord,shadowRecord,decisionAt=null,caseLabel=null}={}){
  if(!productionRecord||!shadowRecord) throw new Error("Production and shadow records are required.");
  const at=decisionAt||new Date().toISOString();
  const prod=slotMap(productionRecord), shadow=slotMap(shadowRecord);
  const labels=[...new Set([...prod.keys(),...shadow.keys()])].sort();
  const slots=labels.map(label=>{
    const p=prod.get(label)||null,s=shadow.get(label)||null;
    const productionStarter=clean(p&&p.starter&&p.starter.name);
    const shadowStarter=clean(s&&s.starter&&s.starter.name);
    return {
      slotLabel:label,
      productionStarter,
      shadowStarter,
      sameCall:Boolean(productionStarter&&shadowStarter&&productionStarter===shadowStarter),
      productionDecisionState:clean(p&&p.decisionState),
      shadowDecisionState:clean(s&&s.decisionState),
      productionDecidedBy:clean(p&&p.decidedBy),
      shadowDecidedBy:clean(s&&s.decidedBy),
      productionConfidence:clean(p&&p.confidence&&p.confidence.label),
      shadowConfidence:clean(s&&s.confidence&&s.confidence.label)
    };
  });
  const body={version:VERSION,type:"SUPER_SAGE_LIVE_SHADOW_COMPARISON",season:Number(season),week:Number(week),scoring:clean(scoring),decisionAt:at,caseLabel:clean(caseLabel),slots,
    summary:{slotsCompared:slots.length,agreements:slots.filter(x=>x.sameCall).length,disagreements:slots.filter(x=>x.productionStarter&&x.shadowStarter&&!x.sameCall).length},
    authority:{customerDecision:"PRODUCTION_ONLY",shadowCanChangeProduction:false,providerCallsAllowed:false,outcomeDataAllowed:false,automaticPromotionAllowed:false}};
  return {...body,id:hash(body)};
}

function gradeLiveShadowComparison(comparison,{decisionQuality="UNREVIEWED",reasoningQuality="UNREVIEWED",explanationQuality="UNREVIEWED",notes=[]}={}){
  if(!comparison||comparison.type!=="SUPER_SAGE_LIVE_SHADOW_COMPARISON") throw new Error("Valid live shadow comparison required.");
  for(const g of [decisionQuality,reasoningQuality,explanationQuality]) if(!GRADES.has(g)) throw new Error("Unsupported shadow grade: "+g);
  return {...comparison,review:{decisionQuality,reasoningQuality,explanationQuality,notes:(notes||[]).slice(0,12)},
    learning:{decisionLabCandidate:comparison.summary.disagreements>0||[decisionQuality,reasoningQuality,explanationQuality].includes("QUESTIONABLE")||[decisionQuality,reasoningQuality,explanationQuality].includes("FAIL"),
      automaticCodeChange:false,requiredNextStep:"REVIEW_REAL_CASE_THEN_BACKTEST_IF_REPEATABLE"}};
}

module.exports={VERSION,buildLiveShadowComparison,gradeLiveShadowComparison};
