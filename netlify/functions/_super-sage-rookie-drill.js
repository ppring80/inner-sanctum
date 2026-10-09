"use strict";
const { hash } = require("./_super-sage-shadow-llm.js");
const { runFastReview, focusEvidence, validate } = require("./_super-sage-shadow-fast-review.js");
const { revalidateCached } = require("./_super-sage-rookie-claim-checks.js");
const VERSION = "rookie-sonnet-drill-v11-focused-citations";
const CASES = [
  { id: "injury", label: "Questionable receiver versus listed-active alternative", targets: ["Terry McLaurin", "Courtland Sutton"] },
  { id: "close-call", label: "Close call and quarterback change", targets: ["Chris Godwin Jr.", "Jakobi Meyers"] },
  { id: "role-change", label: "Established role versus possible role expansion", targets: ["Blake Corum", "Saquon Barkley"] },
  { id: "missing-evidence", label: "Synthetic essential-evidence removal", targets: ["Chris Godwin Jr.", "Jakobi Meyers"], ablation: true }
];
function buildCase(frozen, c) {
  const focused = focusEvidence(frozen, c.targets);
  focused.packet.requireSentenceEvidence = true;
  focused.packet.evidenceMeaning = {
    projection: "Forecast point estimate, not scored points, floor or ceiling; adjustment for state changes is unknown unless explicitly supplied.",
    establishedRole: "Observed recent usage; retain the original opportunity unit, not a guaranteed future workload.",
    standing: "Rank within position, not rank among bench players.",
    stateChanges: "Distinguish verified event from unverified effect or redistribution. Reconsider using new evidence, not assumed revised projections."
  };
  if (c.ablation) {
    // Explicit experimental removal, never fabricated real-world player facts.
    focused.packet.scope = "SYNTHETIC_EVIDENCE_ABLATION";
    focused.packet.request = { task: "Choose one starter if essential evidence permits; otherwise explain the concrete blocker.", experimentalNote: "Original football evidence intentionally withheld for this missing-evidence test." };
    focused.packet.players = focused.packet.players.map(p => ({ id: p.id, name: `Test receiver ${p.id}`, position: p.position, facts: [{ factId: `${p.id}:uncertainty`, field: "uncertainty", value: { availability: "UNKNOWN", standing: "MISSING", projection: "MISSING", establishedRole: "MISSING", matchup: "MISSING" } }] }));
  }
  return { packet: focused.packet, evidenceHash: hash(JSON.stringify(focused.packet)) };
}
async function runNextDrill(args) {
  if (!/^[a-f0-9]{64}$/.test(args.decisionId || "") || !/^[a-f0-9]{64}$/.test(args.ownerHash || "")) return { status: "UNAVAILABLE", error: "invalid_request" };
  const original = await args.store.get(`evidence/${args.decisionId}/${args.ownerHash}`, { type: "json" });
  if (!original || original.ownerHash !== args.ownerHash || !original.frozenEvidence) return { status: "UNAVAILABLE", error: "owned_frozen_evidence_unavailable" };
  if (hash(JSON.stringify(original.frozenEvidence.packet)) !== original.frozenEvidence.evidenceHash) return { status: "UNAVAILABLE", error: "evidence_integrity_failure" };
  const completed = [];
  for (const c of CASES) {
    const key = `llm-drill/${VERSION}/${c.id}/${args.decisionId}/${args.ownerHash}`;
    const cached = await args.store.get(key, { type: "json" });
    if (cached) {
      if (cached.status === "PENDING") return { ...cached, cached: true };
      completed.push(revalidateCached(cached, cached.status === "REVIEW_READY" ? validate(cached.answer, buildCase(original.frozenEvidence, c).packet) : [])); continue;
    }
    const result = await runFastReview({ ...args, drill: { version: VERSION, caseId: c.id, build: frozen => buildCase(frozen, c) } });
    return { ...result, caseLabel: c.label, caseNumber: completed.length + 1, caseCount: CASES.length };
  }
  return { status: "DRILL_COMPLETE", version: VERSION, cached: true, cases: completed, semanticReviewRequired: true };
}
module.exports = { VERSION, CASES, buildCase, runNextDrill };
