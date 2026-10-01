"use strict";

const assert = require("assert");
const { buildSuperSageAnalysis } = require("../netlify/functions/_super-sage-analysis");

const noEvidence = buildSuperSageAnalysis({
  question: "How could motion interact with coverage?"
});
assert.strictEqual(noEvidence.status, "MORE_EVIDENCE_REQUIRED");
assert.strictEqual(noEvidence.canChangeProductionRanking, false);

const ready = buildSuperSageAnalysis({
  question: "How could motion interact with coverage?",
  now: "2026-10-01T00:00:00Z",
  currentEvidence: [{
    type: "SCHEME",
    sourceTier: "trusted-data",
    source: "Verified current scheme source",
    claim: "The current team sample contains documented motion/coverage evidence.",
    observedAt: "2026-09-30T20:00:00Z",
    season: 2026,
    week: 4,
    team: "TEST",
    sample: { dropbacks: 100 }
  }]
});
assert.strictEqual(ready.status, "READY_FOR_ANALYST_VERDICT");
assert.strictEqual(ready.skeptic.canMakeCurrentMatchupClaim, true);
assert.ok(ready.footballKnowledge.establishedKnowledge.length > 0);

const stale = buildSuperSageAnalysis({
  question: "How could motion interact with coverage?",
  now: "2026-10-20T00:00:00Z",
  currentEvidence: [{
    type: "SCHEME",
    sourceTier: "trusted-data",
    source: "Old scheme source",
    claim: "Old evidence.",
    observedAt: "2026-09-30T20:00:00Z"
  }]
});
assert.strictEqual(stale.status, "MORE_EVIDENCE_REQUIRED");
assert.strictEqual(stale.skeptic.canMakeCurrentMatchupClaim, false);

console.log("Super SAGE end-to-end analysis assertions passed.");
