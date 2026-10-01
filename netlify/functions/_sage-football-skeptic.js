"use strict";

function buildSageSkepticReview(reasoningPacket, currentEvidence = []) {
  const concerns = [];

  if (!reasoningPacket || !Array.isArray(reasoningPacket.establishedKnowledge)) {
    return {
      passed: false,
      concerns: ["No valid Super SAGE reasoning packet was supplied."],
      confidenceCeiling: "none"
    };
  }

  if (!reasoningPacket.establishedKnowledge.length) {
    concerns.push("No established football knowledge supports this analysis yet.");
  }

  if (!Array.isArray(currentEvidence) || !currentEvidence.length) {
    concerns.push("No current NFL evidence was supplied; do not make a current team/player tendency claim.");
  }

  if (reasoningPacket.researchHypotheses.length) {
    concerns.push("Research hypotheses are present and must not be restated as facts or ranking inputs.");
  }

  if (reasoningPacket.practitionerEvidence.length) {
    concerns.push("Practitioner evidence is system-specific and requires independent corroboration before generalization.");
  }

  if (reasoningPacket.limitations.length) {
    concerns.push("Retrieved knowledge contains explicit limitations that must appear in the final reasoning when material.");
  }

  const contradictionFlags = (currentEvidence || [])
    .filter((item) => item && item.contradicts === true)
    .map((item) => item.note || item.claim || "Current evidence contradicts part of the proposed analysis.");

  concerns.push(...contradictionFlags);

  const hardBlock = !currentEvidence.length || contradictionFlags.length > 0;
  return {
    passed: !hardBlock,
    canMakeCurrentMatchupClaim: !hardBlock,
    canChangeProductionRanking: false,
    confidenceCeiling: hardBlock ? "low" : reasoningPacket.researchHypotheses.length ? "moderate" : "high",
    concerns,
    requiredChecks: [
      "Verify current injury/status information.",
      "Verify current team/player tendency data and sample window.",
      "Check opponent quality and game-state distortion.",
      "Check for contradictory evidence.",
      "Keep hypotheses separate from observed facts.",
      "Do not change production rankings from this review."
    ]
  };
}

module.exports = { buildSageSkepticReview };
