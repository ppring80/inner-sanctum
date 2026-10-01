"use strict";

const { buildFootballReasoningPacket } = require("./_sage-football-reasoning");
const { buildCurrentEvidencePacket } = require("./_sage-current-evidence");
const { buildSageSkepticReview } = require("./_sage-football-skeptic");

function buildSuperSageAnalysis({ question, currentEvidence = [], now } = {}) {
  if (!question || !String(question).trim()) {
    throw new Error("Super SAGE analysis requires a question.");
  }

  const football = buildFootballReasoningPacket(String(question).trim());
  const current = buildCurrentEvidencePacket(currentEvidence, now ? { now } : {});

  const skepticInput = current.evidence
    .filter((item) => item.freshness.fresh)
    .map((item) => ({
      source: item.source,
      claim: item.claim,
      contradicts: item.contradicts,
      note: item.note
    }));

  const skeptic = buildSageSkepticReview(football, skepticInput);

  // Stale evidence is itself a hard reason not to clear a current claim.
  if (current.stale.length) {
    skeptic.passed = false;
    skeptic.canMakeCurrentMatchupClaim = false;
    skeptic.confidenceCeiling = "low";
    skeptic.concerns.push("One or more current-evidence items are stale.");
  }

  if (current.contradictions.length) {
    skeptic.passed = false;
    skeptic.canMakeCurrentMatchupClaim = false;
    skeptic.confidenceCeiling = "low";
  }

  return {
    source: "Super SAGE",
    question: String(question).trim(),
    footballKnowledge: football,
    currentEvidence: current,
    skeptic,
    status:
      skeptic.canMakeCurrentMatchupClaim && current.readyForReasoning
        ? "READY_FOR_ANALYST_VERDICT"
        : "MORE_EVIDENCE_REQUIRED",
    canChangeProductionRanking: false,
    productionBoundary:
      "This analysis packet supports a SAGE explanation/verdict only. It does not recalculate, override, or mutate Weekly SAGE rankings."
  };
}

module.exports = { buildSuperSageAnalysis };
