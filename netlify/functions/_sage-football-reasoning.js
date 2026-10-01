"use strict";

const { retrieveFootballKnowledge } = require("./_sage-football-knowledge");

const ESTABLISHED_CLASSES = new Set(["FACT", "CONCEPT", "HISTORICAL_KNOWLEDGE", "VALIDATED_INSIGHT"]);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function buildFootballReasoningPacket(question, options = {}) {
  const retrieval = retrieveFootballKnowledge(question, {
    limit: options.limit || 12,
    includeHypotheses: true
  });

  const established = retrieval.results.filter((item) =>
    ESTABLISHED_CLASSES.has(item.knowledgeClass)
  );
  const experience = retrieval.results.filter((item) =>
    item.knowledgeClass === "EXPERIENCE_NOTE"
  );
  const hypotheses = retrieval.results.filter((item) =>
    item.knowledgeClass === "HYPOTHESIS"
  );

  const limitations = unique(
    retrieval.results.flatMap((item) =>
      Array.isArray(item.limitations) ? item.limitations : []
    )
  );

  const provenance = [];
  retrieval.results.forEach((item) => {
    (item.resolvedProvenance || []).forEach((record) => {
      provenance.push({
        knowledgeId: item.id || null,
        title: item.title || null,
        knowledgeClass: item.knowledgeClass,
        record
      });
    });
  });

  return {
    question,
    source: "Super SAGE Football Knowledge Library",
    mode: "reasoning-support",
    canChangeProductionRanking: false,
    establishedKnowledge: established,
    practitionerEvidence: experience,
    researchHypotheses: hypotheses,
    limitations,
    provenance,
    reasoningRules: [
      "Use established knowledge to explain football concepts and frame analysis.",
      "Treat practitioner evidence as experience from a specific system, not universal truth.",
      "Treat HYPOTHESIS as a question to test, never as an observed fact.",
      "Do not infer a current NFL team's tendency from historical coaching lineage.",
      "Do not infer current player/team performance from a football concept alone.",
      "Current matchup claims require current, source-backed NFL evidence.",
      "If current evidence is missing or contradictory, say so rather than filling the gap.",
      "This packet cannot change Weekly SAGE ranks or scores."
    ],
    nextEvidenceNeeded: unique([
      established.length ? "Current team/player evidence to connect the retrieved concepts to the specific matchup." : "More curated football knowledge for this question.",
      hypotheses.length ? "Validation evidence before any retrieved hypothesis can influence a fantasy recommendation." : null
    ])
  };
}

function footballReasoningPacketToText(packet) {
  const lines = [
    "Super SAGE football reasoning support",
    `Question: ${packet.question}`
  ];

  if (packet.establishedKnowledge.length) {
    lines.push("Established knowledge:");
    packet.establishedKnowledge.slice(0, 5).forEach((item) => {
      lines.push(`- ${item.title}: ${item.summary}`);
    });
  } else {
    lines.push("Established knowledge: none retrieved.");
  }

  if (packet.practitionerEvidence.length) {
    lines.push("Practitioner evidence:");
    packet.practitionerEvidence.slice(0, 3).forEach((item) => {
      lines.push(`- ${item.title}: ${item.summary}`);
    });
  }

  if (packet.researchHypotheses.length) {
    lines.push("Research hypotheses (not facts):");
    packet.researchHypotheses.slice(0, 3).forEach((item) => {
      lines.push(`- ${item.title}: ${item.summary}`);
    });
  }

  if (packet.limitations.length) {
    lines.push("Limitations:");
    packet.limitations.slice(0, 5).forEach((item) => lines.push(`- ${item}`));
  }

  lines.push("Production ranking impact: NONE. Current matchup claims still require current evidence.");
  return lines.join("\n");
}

module.exports = { buildFootballReasoningPacket, footballReasoningPacketToText };
