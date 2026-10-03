"use strict";

const STAGES=["DISCOVERY","VALIDATION","HOLDOUT","PROSPECTIVE","SKEPTIC"];
function pass(x){return x && x.status==="PASS";}
function evaluateHypothesisPromotion({id,title,stages={},effect=null,regressions=[],notes=[]}={}) {
  if(!id||!title) throw new Error("Hypothesis id and title required.");
  const stageResults=Object.fromEntries(STAGES.map(s=>[s,stages[s]||{status:"NOT_RUN"}]));
  const allPassed=STAGES.every(s=>pass(stageResults[s]));
  const regressionFree=!regressions.some(r=>r && r.severity==="BLOCKING");
  const promoted=allPassed&&regressionFree;
  const failed=STAGES.filter(s=>stageResults[s].status==="FAIL");
  return {
    version:1,source:"Super SAGE Hypothesis Promotion Gate",id,title,
    stages:stageResults,effect:effect||null,regressions,notes,
    decision:promoted?"APPROVED_FOR_PRODUCTION_REVIEW":failed.length?"REJECT_OR_REVISE":"KEEP_TESTING",
    promoted,
    requirements:[
      "Discovery identifies the relationship without using holdout.",
      "Validation confirms it on a later unseen period.",
      "Holdout remains untouched until the hypothesis and tuning are frozen.",
      "Prospective/live evidence must not materially contradict the historical result.",
      "SAGE Skeptic must pass leakage, sample, era-drift, confounding and regression review.",
      "Approval permits production review; it does not auto-deploy a ranking change."
    ],
    canAutoDeploy:false
  };
}
module.exports={STAGES,evaluateHypothesisPromotion};
