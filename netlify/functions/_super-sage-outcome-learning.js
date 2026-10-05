"use strict";

// SUPER SAGE — TURBINE #6: OUTCOME LEARNING / DECISION ACCOUNTABILITY
//
// This module sits strictly AFTER the immutable pregame decision boundary.
// It may evaluate a completed decision, classify what happened, and propose a
// learning case. It may NEVER rewrite rankings, projections, the original
// decision, or production policy.
//
// Design rule: outcome != decision quality. Actual fantasy points are allowed
// to measure prediction error, but are never sufficient to label a decision
// good or bad.

const { reviewLearningCase } = require("./_super-sage-learning-case.js");

const VERSION = 1;
const DECISION_CLASSES = new Set(["GOOD_DECISION", "QUESTIONABLE_DECISION", "BAD_DECISION", "INSUFFICIENT_EVIDENCE"]);
const EXPLANATION_CLASSES = new Set(["GOOD", "INCOMPLETE", "BAD", "UNREVIEWED"]);
const EVIDENCE_CLASSES = new Set(["GOOD", "STALE", "MISSING", "CONFLICTED", "UNREVIEWED"]);
const VARIANCE_CLASSES = new Set(["NONE", "INJURY", "GAME_SCRIPT", "TOUCHDOWN_VARIANCE", "EFFICIENCY_VARIANCE", "ROLE_SURPRISE", "OTHER", "UNREVIEWED"]);

function finiteOrNull(v) {
  return Number.isFinite(Number(v)) ? Number(v) : null;
}

function predictionAssessment(record) {
  const actual = finiteOrNull(record?.outcome?.actualFantasyPoints);
  const projection = finiteOrNull(
    record?.evidenceSnapshot?.projection?.points ??
    record?.evidenceSnapshot?.projection ??
    record?.evidenceSnapshot?.projectedFantasyPoints
  );
  if (actual == null || projection == null) {
    return { quality: "UNREVIEWED", projection, actual, error: null, absoluteError: null };
  }
  const error = actual - projection;
  return {
    quality: Math.abs(error) <= 3 ? "ON_EXPECTATION" : error > 0 ? "OUTPERFORMED" : "UNDERPERFORMED",
    projection,
    actual,
    error: Number(error.toFixed(2)),
    absoluteError: Number(Math.abs(error).toFixed(2))
  };
}

function validate(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

function buildOutcomeAssessment(record, {
  decisionQuality = "INSUFFICIENT_EVIDENCE",
  evidenceQuality = "UNREVIEWED",
  explanationQuality = "UNREVIEWED",
  varianceClass = "UNREVIEWED",
  varianceNotes = [],
  evidenceGaps = [],
  rationale = [],
  hypothesis = null
} = {}) {
  if (!record?.immutableDecisionBoundary || !record?.outcome || record.learningStatus !== "READY_FOR_REVIEW") {
    throw new Error("Turbine #6 requires a completed immutable decision record.");
  }

  const decision = validate(decisionQuality, DECISION_CLASSES, "INSUFFICIENT_EVIDENCE");
  const evidence = validate(evidenceQuality, EVIDENCE_CLASSES, "UNREVIEWED");
  const explanation = validate(explanationQuality, EXPLANATION_CLASSES, "UNREVIEWED");
  const variance = validate(varianceClass, VARIANCE_CLASSES, "UNREVIEWED");
  const prediction = predictionAssessment(record);

  // A learning hypothesis is warranted only by a decision-process problem,
  // an evidence problem, an explanation problem, or an explicit hypothesis.
  // Mere underperformance and ordinary variance are calibration cases.
  const processFailure = decision === "BAD_DECISION" || decision === "QUESTIONABLE_DECISION";
  const evidenceFailure = evidence === "STALE" || evidence === "MISSING" || evidence === "CONFLICTED" || evidenceGaps.length > 0;
  const explanationFailure = explanation === "BAD" || explanation === "INCOMPLETE";
  const shouldInvestigate = processFailure || evidenceFailure || explanationFailure || Boolean(hypothesis);

  const learningCase = reviewLearningCase(record, {
    decisionProcess: decision,
    explanationQuality: explanation,
    varianceNotes: [variance !== "NONE" && variance !== "UNREVIEWED" ? variance : null, ...varianceNotes].filter(Boolean),
    evidenceGaps,
    hypothesis
  });

  return {
    version: VERSION,
    type: "SUPER_SAGE_OUTCOME_ASSESSMENT",
    decisionId: record.id,
    season: record.season,
    week: record.week,
    player: record.player,
    originalDecision: record.decision,
    attribution: {
      decisionQuality: decision,
      predictionQuality: prediction,
      evidenceQuality: evidence,
      explanationQuality: explanation,
      outcomeVariance: { class: variance, notes: varianceNotes.slice(0, 12) },
      rationale: rationale.slice(0, 12)
    },
    learning: {
      disposition: shouldInvestigate ? "INVESTIGATE" : "CALIBRATION_ONLY",
      learningCase,
      productionChangeAllowed: false
    },
    guardrails: {
      immutableDecisionBoundary: true,
      actualPointsCannotDetermineDecisionQuality: true,
      automaticProductionPromotion: false
    }
  };
}

module.exports = { VERSION, buildOutcomeAssessment, predictionAssessment };
