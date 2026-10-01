"use strict";

const assert = require("assert");
const { buildSuperSageAnalysis } = require("../netlify/functions/_super-sage-analysis");
const { buildSuperSageVerdict } = require("../netlify/functions/_super-sage-verdict");

const holdPacket = buildSuperSageAnalysis({
  question: "How does motion interact with coverage?"
});
const hold = buildSuperSageVerdict(holdPacket);
assert.strictEqual(hold.status, "MORE_EVIDENCE_REQUIRED");
assert.ok(/^HOLD/.test(hold.oneSecond));
assert.strictEqual(hold.canChangeProductionRanking, false);

const readyPacket = buildSuperSageAnalysis({
  question: "How does motion interact with coverage?",
  now: "2026-10-01T00:00:00Z",
  currentEvidence: [{
    type: "SCHEME",
    sourceTier: "trusted-data",
    source: "Verified current scheme source",
    claim: "Current evidence shows meaningful motion/coverage interaction in the supplied sample.",
    observedAt: "2026-09-30T20:00:00Z",
    season: 2026,
    week: 4,
    team: "TEST",
    sample: { dropbacks: 100 }
  }]
});
const verdict = buildSuperSageVerdict(readyPacket, {
  direction: "Scheme interaction worth monitoring",
  primaryReason: "Verified current evidence aligns with established motion/coverage concepts.",
  confidence: "moderate",
  couldChangeVerdict: ["A larger sample shows the tendency is opponent-specific."]
});
assert.strictEqual(verdict.status, "READY");
assert.strictEqual(verdict.oneSecond, "SCHEME INTERACTION WORTH MONITORING");
assert.strictEqual(verdict.confidence, "moderate");
assert.ok(verdict.tenSecond.evidence.length > 0);
assert.ok(verdict.tenSecond.footballReasoning.length > 0);
assert.ok(verdict.tenSecond.researchHypotheses.every((h) => /not an observed fact/i.test(h.warning)));
assert.strictEqual(verdict.canChangeProductionRanking, false);

console.log("Super SAGE verdict assertions passed.");
