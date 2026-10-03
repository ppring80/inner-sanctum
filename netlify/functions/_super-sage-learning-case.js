"use strict";

function reviewLearningCase(record,{decisionProcess=null,explanationQuality=null,varianceNotes=[],evidenceGaps=[],hypothesis=null}={}) {
  if(!record?.outcome || record.learningStatus!=="READY_FOR_REVIEW") throw new Error("Completed decision record required.");
  const process=decisionProcess||"UNREVIEWED";
  const explanation=explanationQuality||"UNREVIEWED";
  const actual=record.outcome.actualFantasyPoints;
  const needsHypothesis=process==="BAD_DECISION" || evidenceGaps.length>0 || Boolean(hypothesis);
  return {
    version:1,source:"Super SAGE Learning Case",
    decisionId:record.id,
    player:record.player,season:record.season,week:record.week,
    originalDecision:record.decision,
    outcome:{actualFantasyPoints:actual,observedAt:record.outcome.observedAt},
    review:{
      decisionProcess:process,
      explanationQuality:explanation,
      outcomeClass:actual==null?"UNKNOWN":"OBSERVED",
      varianceNotes:varianceNotes.slice(0,12),
      evidenceGaps:evidenceGaps.slice(0,12)
    },
    learning:{
      createHypothesis:needsHypothesis,
      hypothesis:hypothesis||null,
      nextStep:needsHypothesis?"BACKTEST_OR_GATHER_EVIDENCE":"RETAIN_AS_CALIBRATION_CASE"
    },
    rules:[
      "A bad fantasy outcome does not prove the recommendation was bad.",
      "A good fantasy outcome does not prove the recommendation was good.",
      "Judge the information and reasoning available at decision time.",
      "Separate recommendation quality from explanation quality.",
      "Promote no production change from a single case."
    ],
    canChangeProductionRanking:false
  };
}

module.exports={reviewLearningCase};
