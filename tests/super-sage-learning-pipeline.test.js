"use strict";
const assert = require("assert");
const { createDecisionRecord } = require("../netlify/functions/_super-sage-decision-ledger");
const { buildLearningCaseFromOutcome } = require("../netlify/functions/_super-sage-learning-pipeline");

const original = createDecisionRecord({
  season: 2026, week: 4,
  player: { name: "River Runner", position: "WR", team: "COL" },
  decision: "START", confidence: "medium",
  createdAt: "2026-10-03T18:00:00Z",
  evidenceSnapshot: { projection: { points: 13.5 }, rank: 19 }
});
const before = JSON.stringify(original);

const packet = buildLearningCaseFromOutcome(original, {
  outcome: {
    observedAt: "2026-10-05T23:30:00Z",
    actualFantasyPoints: 3.2,
    started: true,
    outcomeEvidence: { source: "fixture", injury: "left game early" }
  },
  review: {
    decisionQuality: "GOOD_DECISION",
    evidenceQuality: "GOOD",
    explanationQuality: "GOOD",
    varianceClass: "INJURY",
    varianceNotes: ["In-game injury was not knowable before kickoff."]
  }
});

assert.strictEqual(JSON.stringify(original), before, "original decision must remain byte-for-byte unchanged");
assert.strictEqual(original.outcome, null);
assert.strictEqual(packet.completedRecord.outcome.actualFantasyPoints, 3.2);
assert.strictEqual(packet.assessment.attribution.decisionQuality, "GOOD_DECISION");
assert.strictEqual(packet.assessment.learning.disposition, "CALIBRATION_ONLY");
assert.strictEqual(packet.eligibleForAutomaticProductionChange, false);

// Explicit evidence/process failure becomes investigation, not promotion.
const original2 = createDecisionRecord({
  season: 2026, week: 4,
  player: { name: "Role Miss", position: "RB" },
  decision: "BENCH", createdAt: "2026-10-03T18:00:00Z",
  evidenceSnapshot: { projection: { points: 8 } }
});
const packet2 = buildLearningCaseFromOutcome(original2, {
  outcome: { observedAt: "2026-10-05T23:30:00Z", actualFantasyPoints: 21 },
  review: {
    decisionQuality: "BAD_DECISION",
    evidenceQuality: "MISSING",
    explanationQuality: "INCOMPLETE",
    varianceClass: "ROLE_SURPRISE",
    evidenceGaps: ["Pregame teammate absence was not incorporated."],
    hypothesis: "Re-evaluate backfield opportunity after verified teammate absence."
  }
});
assert.strictEqual(packet2.assessment.learning.disposition, "INVESTIGATE");
assert.strictEqual(packet2.assessment.learning.learningCase.canChangeProductionRanking, false);

// Refuse outcome overwrite.
assert.throws(() => buildLearningCaseFromOutcome(packet.completedRecord, { outcome: {} }), /refuses to overwrite/);

console.log("Super SAGE Turbine #6 learning-pipeline assertions passed.");
