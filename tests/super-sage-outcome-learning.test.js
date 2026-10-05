"use strict";
const assert = require("assert");
const { createDecisionRecord, appendOutcome } = require("../netlify/functions/_super-sage-decision-ledger");
const { buildOutcomeAssessment, predictionAssessment } = require("../netlify/functions/_super-sage-outcome-learning");

function completed(actual, projection = 15) {
  const pre = createDecisionRecord({
    season: 2026,
    week: 4,
    player: { name: "Test RB", position: "RB", team: "TST" },
    decision: "START",
    confidence: "high",
    createdAt: "2026-10-02T20:00:00Z",
    evidenceSnapshot: { projection: { points: projection }, rank: 8 }
  });
  return appendOutcome(pre, { observedAt: "2026-10-05T23:00:00Z", actualFantasyPoints: actual, started: true });
}

// Catastrophic outcome alone must never become a bad-decision label.
const injury = buildOutcomeAssessment(completed(0.7), {
  decisionQuality: "GOOD_DECISION",
  evidenceQuality: "GOOD",
  explanationQuality: "GOOD",
  varianceClass: "INJURY",
  varianceNotes: ["Player exited on the opening drive."]
});
assert.strictEqual(injury.attribution.decisionQuality, "GOOD_DECISION");
assert.strictEqual(injury.attribution.predictionQuality.quality, "UNDERPERFORMED");
assert.strictEqual(injury.learning.disposition, "CALIBRATION_ONLY");
assert.strictEqual(injury.learning.productionChangeAllowed, false);
assert.strictEqual(injury.guardrails.actualPointsCannotDetermineDecisionQuality, true);

// A real pregame reasoning/evidence miss is an investigation candidate.
const miss = buildOutcomeAssessment(completed(5.1), {
  decisionQuality: "BAD_DECISION",
  evidenceQuality: "MISSING",
  explanationQuality: "INCOMPLETE",
  varianceClass: "ROLE_SURPRISE",
  evidenceGaps: ["Verified teammate absence was available before kickoff but not incorporated."],
  hypothesis: "Availability changes should trigger role-redistribution review before kickoff."
});
assert.strictEqual(miss.learning.disposition, "INVESTIGATE");
assert.strictEqual(miss.learning.learningCase.learning.createHypothesis, true);
assert.strictEqual(miss.learning.learningCase.canChangeProductionRanking, false);

// A huge positive result does not prove the decision was good either.
const lucky = buildOutcomeAssessment(completed(29.0), {
  decisionQuality: "QUESTIONABLE_DECISION",
  evidenceQuality: "GOOD",
  explanationQuality: "GOOD",
  varianceClass: "TOUCHDOWN_VARIANCE"
});
assert.strictEqual(lucky.attribution.decisionQuality, "QUESTIONABLE_DECISION");
assert.strictEqual(lucky.attribution.predictionQuality.quality, "OUTPERFORMED");
assert.strictEqual(lucky.learning.disposition, "INVESTIGATE");

// Missing projection remains explicit; no fabricated prediction judgment.
const noProjection = completed(11.0, null);
noProjection.evidenceSnapshot = { rank: 8 };
assert.strictEqual(predictionAssessment(noProjection).quality, "UNREVIEWED");

// Turbine #6 refuses records that have not crossed the immutable outcome boundary.
assert.throws(() => buildOutcomeAssessment({ immutableDecisionBoundary: true }), /completed immutable decision record/);

console.log("Super SAGE Turbine #6 outcome-learning assertions passed.");
