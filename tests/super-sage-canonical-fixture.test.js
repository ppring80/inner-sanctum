"use strict";

const assert = require("assert");
const { buildSuperSageAnalysis } = require("../netlify/functions/_super-sage-analysis");
const { buildSuperSageVerdict } = require("../netlify/functions/_super-sage-verdict");

// Canonical Super SAGE fixture: a hypothetical scheme question.
// The premise is deliberately NOT stored as a fact.
const question =
  "If an offense performs well against two-high structures, how should SAGE evaluate a defense that uses those structures frequently?";

const withoutEvidence = buildSuperSageAnalysis({ question });
const hold = buildSuperSageVerdict(withoutEvidence);
assert.strictEqual(hold.status, "MORE_EVIDENCE_REQUIRED");
assert.strictEqual(hold.canChangeProductionRanking, false);

// Supply verified current evidence without asserting the hypothetical premise is true.
const withDefenseEvidence = buildSuperSageAnalysis({
  question,
  now: "2026-10-01T00:00:00Z",
  currentEvidence: [{
    type: "SCHEME",
    sourceTier: "trusted-data",
    source: "Verified current coverage dataset",
    claim: "The defense uses the specified structure frequently in the current sample.",
    observedAt: "2026-09-30T20:00:00Z",
    season: 2026,
    week: 4,
    team: "TEST",
    metric: "structure_rate",
    value: 60,
    unit: "percent",
    sample: { dropbacks: 125 }
  }]
});

assert.strictEqual(withDefenseEvidence.status, "READY_FOR_ANALYST_VERDICT");

const verdict = buildSuperSageVerdict(withDefenseEvidence, {
  direction: "Conditional matchup signal",
  primaryReason:
    "The defensive tendency is verified, but the offense-side advantage remains a condition that must be independently established.",
  confidence: "moderate",
  couldChangeVerdict: [
    "Verified offense/player splits do not show an advantage against the structure.",
    "The defense materially changes its structure for this opponent."
  ]
});

assert.strictEqual(verdict.oneSecond, "CONDITIONAL MATCHUP SIGNAL");
assert.ok(/independently established/i.test(verdict.threeSecond));
assert.strictEqual(verdict.canChangeProductionRanking, false);

console.log("Super SAGE canonical end-to-end fixture passed.");
