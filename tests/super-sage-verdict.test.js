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
assert.strictEqual(hold.progressiveDisclosure.enabled, true);
assert.strictEqual(hold.progressiveDisclosure.defaultState, "summary-only");

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
  subject: "Example QB",
  couldChangeVerdict: ["A larger sample shows the tendency is opponent-specific."],
  advancedDetail: {
    scheme: [{ label: "Cover 3", value: "37.8%" }],
    pressure: [{ label: "Blitz EPA", value: "+0.17" }],
    splits: [{ label: "CPOE", value: "+3.8" }],
    sample: "186 relevant dropbacks",
    sources: ["Verified current scheme source"]
  }
});
assert.strictEqual(verdict.status, "READY");
assert.strictEqual(verdict.oneSecond, "SCHEME INTERACTION WORTH MONITORING");
assert.strictEqual(verdict.confidence, "moderate");
assert.ok(verdict.tenSecond.evidence.length > 0);
assert.ok(verdict.tenSecond.footballReasoning.length > 0);
assert.ok(verdict.tenSecond.researchHypotheses.every((h) => /not an observed fact/i.test(h.warning)));
assert.strictEqual(verdict.canChangeProductionRanking, false);
assert.strictEqual(verdict.progressiveDisclosure.prompt, "Would you like the deeper SAGE analysis on Example QB?");
assert.strictEqual(verdict.progressiveDisclosure.onNo, "STOP");
assert.strictEqual(verdict.progressiveDisclosure.onYes.scheme[0].label, "Cover 3");
assert.strictEqual(verdict.progressiveDisclosure.onYes.pressure[0].value, "+0.17");
assert.strictEqual(verdict.progressiveDisclosure.onYes.sample, "186 relevant dropbacks");

console.log("Super SAGE verdict assertions passed.");
