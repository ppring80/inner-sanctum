"use strict";

// SUPER SAGE — TURBINE #6: LEARNING CASE PIPELINE
//
// Pure postgame orchestration. This module accepts an immutable pregame
// decision record plus separately supplied outcome/review evidence, appends the
// outcome, and produces an outcome assessment. It does not fetch live data,
// mutate rankings, or participate in the customer decision path.

const { appendOutcome } = require("./_super-sage-decision-ledger.js");
const { buildOutcomeAssessment } = require("./_super-sage-outcome-learning.js");

const PIPELINE_VERSION = 1;

function normalizeReview(review = {}) {
  return {
    decisionQuality: review.decisionQuality || "INSUFFICIENT_EVIDENCE",
    evidenceQuality: review.evidenceQuality || "UNREVIEWED",
    explanationQuality: review.explanationQuality || "UNREVIEWED",
    varianceClass: review.varianceClass || "UNREVIEWED",
    varianceNotes: Array.isArray(review.varianceNotes) ? review.varianceNotes : [],
    evidenceGaps: Array.isArray(review.evidenceGaps) ? review.evidenceGaps : [],
    rationale: Array.isArray(review.rationale) ? review.rationale : [],
    hypothesis: review.hypothesis || null
  };
}

function buildLearningCaseFromOutcome(decisionRecord, { outcome = {}, review = {} } = {}) {
  if (!decisionRecord?.immutableDecisionBoundary) {
    throw new Error("Turbine #6 pipeline requires an immutable pregame decision record.");
  }
  if (decisionRecord.outcome) {
    throw new Error("Turbine #6 pipeline refuses to overwrite an existing outcome.");
  }
  const completed = appendOutcome(decisionRecord, {
    observedAt: outcome.observedAt,
    actualFantasyPoints: outcome.actualFantasyPoints,
    started: outcome.started,
    outcomeEvidence: outcome.outcomeEvidence || null,
    diagnosis: outcome.diagnosis || null
  });
  const assessment = buildOutcomeAssessment(completed, normalizeReview(review));
  return {
    version: PIPELINE_VERSION,
    type: "SUPER_SAGE_LEARNING_PACKET",
    decisionId: decisionRecord.id,
    immutableOriginal: decisionRecord,
    completedRecord: completed,
    assessment,
    eligibleForAutomaticProductionChange: false
  };
}

module.exports = { PIPELINE_VERSION, buildLearningCaseFromOutcome, normalizeReview };
