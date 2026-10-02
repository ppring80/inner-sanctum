"use strict";

function compact(text, max = 220) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  return value.slice(0, max - 1).trimEnd() + "…";
}

function buildProgressiveDisclosure(decision = {}, direction = "ANALYSIS READY") {
  const subject = String(decision.subject || "this recommendation").trim();
  const detail = decision.advancedDetail && typeof decision.advancedDetail === "object"
    ? decision.advancedDetail
    : {};
  return {
    enabled: true,
    defaultState: "summary-only",
    prompt: `Would you like the deeper SAGE analysis on ${subject}?`,
    yesLabel: "Yes — show me the details",
    noLabel: "No — keep it simple",
    onNo: "STOP",
    onYes: {
      title: "Advanced SAGE Analysis",
      direction,
      scheme: Array.isArray(detail.scheme) ? detail.scheme.slice(0, 12) : [],
      pressure: Array.isArray(detail.pressure) ? detail.pressure.slice(0, 12) : [],
      opportunity: Array.isArray(detail.opportunity) ? detail.opportunity.slice(0, 12) : [],
      matchup: Array.isArray(detail.matchup) ? detail.matchup.slice(0, 12) : [],
      splits: Array.isArray(detail.splits) ? detail.splits.slice(0, 16) : [],
      evidence: Array.isArray(detail.evidence) ? detail.evidence.slice(0, 12) : [],
      sample: detail.sample || null,
      sources: Array.isArray(detail.sources) ? detail.sources.slice(0, 12) : [],
      caveats: Array.isArray(detail.caveats) ? detail.caveats.slice(0, 8) : []
    },
    rules: [
      "Never show advanced detail unless the customer opts in.",
      "Do not repeat the 1/3/10 summary after the customer says yes; continue with deeper evidence.",
      "Keep advanced metrics plain-language labeled and preserve sample size/source when available.",
      "If advanced evidence is unavailable, say so rather than manufacturing detail."
    ]
  };
}

function buildSuperSageVerdict(analysisPacket, decision = {}) {
  if (!analysisPacket || analysisPacket.source !== "Super SAGE") {
    throw new Error("SAGE Verdict requires a Super SAGE analysis packet.");
  }

  const ready = analysisPacket.status === "READY_FOR_ANALYST_VERDICT";
  const current = analysisPacket.currentEvidence || { evidence: [] };
  const football = analysisPacket.footballKnowledge || {
    establishedKnowledge: [],
    practitionerEvidence: [],
    researchHypotheses: [],
    limitations: []
  };
  const skeptic = analysisPacket.skeptic || { concerns: [], confidenceCeiling: "low" };

  if (!ready) {
    return {
      source: "Super SAGE Verdict",
      status: "MORE_EVIDENCE_REQUIRED",
      oneSecond: "HOLD — more evidence needed.",
      threeSecond: compact((skeptic.concerns || [])[0] || "Current evidence has not cleared SAGE Skeptic."),
      tenSecond: {
        evidence: [],
        footballReasoning: football.establishedKnowledge.slice(0, 3).map((x) => compact(x.summary)),
        uncertainty: skeptic.concerns || [],
        couldChangeVerdict: analysisPacket.currentEvidence?.stale?.length
          ? ["Refresh stale current evidence."]
          : ["Supply verified current evidence and resolve contradictions."]
      },
      confidence: "low",
      progressiveDisclosure: buildProgressiveDisclosure(decision, "HOLD"),
      canChangeProductionRanking: false
    };
  }

  const direction = String(decision.direction || "ANALYSIS READY").trim().toUpperCase();
  const primaryReason =
    decision.primaryReason ||
    current.evidence?.[0]?.claim ||
    football.establishedKnowledge?.[0]?.summary ||
    "Verified current evidence and football knowledge are available.";

  const evidence = (current.evidence || []).slice(0, 5).map((item) => ({
    claim: item.claim,
    source: item.source,
    observedAt: item.observedAt,
    sample: item.sample || null
  }));

  const footballReasoning = (football.establishedKnowledge || []).slice(0, 4).map((item) => ({
    title: item.title,
    summary: compact(item.summary, 320),
    knowledgeClass: item.knowledgeClass
  }));

  const hypotheses = (football.researchHypotheses || []).slice(0, 3).map((item) => ({
    title: item.title,
    summary: compact(item.summary, 320),
    warning: "Research hypothesis — not an observed fact or ranking input."
  }));

  const uncertainty = [
    ...(skeptic.concerns || []),
    ...(football.limitations || [])
  ].filter(Boolean).slice(0, 8);

  return {
    source: "Super SAGE Verdict",
    status: "READY",
    oneSecond: direction,
    threeSecond: compact(primaryReason),
    tenSecond: {
      evidence,
      footballReasoning,
      researchHypotheses: hypotheses,
      uncertainty,
      couldChangeVerdict: Array.isArray(decision.couldChangeVerdict)
        ? decision.couldChangeVerdict.slice(0, 5)
        : []
    },
    confidence: decision.confidence || skeptic.confidenceCeiling || "moderate",
    decisionAuthority: decision.authority || "analysis-only",
    progressiveDisclosure: buildProgressiveDisclosure(decision, direction),
    canChangeProductionRanking: false,
    boundary:
      "This verdict explains verified evidence using Super SAGE football knowledge. It does not recalculate or override Weekly SAGE rankings."
  };
}

module.exports = { buildSuperSageVerdict, buildProgressiveDisclosure };
