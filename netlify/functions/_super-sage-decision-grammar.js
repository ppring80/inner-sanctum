"use strict";

// SUPER SAGE OPERATOR V1 — SHADOW DECISION GRAMMAR
//
// Purpose: make the reasoning between evidence and a decision explicit.
// This module is intentionally NON-AUTHORITATIVE. It cannot change Weekly
// SAGE rankings, lineup decisions, projections, provider state, or production
// policy. It performs no network/provider calls.
//
// Grammar:
// PRIOR -> MATERIAL CHANGE -> COMPETING CASES -> EVIDENCE DISCIPLINE ->
// BELIEF MOVEMENT -> THRESHOLD -> CALL -> CONFIDENCE -> LOSING CASE ->
// WHAT WOULD FLIP IT.
//
// Evidence is classified, not numerically weighted. Correlated facts sharing
// one causalGroup are one line of evidence, not multiple votes.

const VERSION = 1;
const EFFECTS = new Set([
  "REINFORCES_PRIOR",
  "CHALLENGES_PRIOR",
  "REASSESS_PRIOR",
  "INVALIDATES_PRIOR",
  "CONTEXT_ONLY",
  "CONFLICTED_UNKNOWN"
]);
const MATERIAL_SCOPES = new Set(["PLAYER","OFFENSE","OPPONENT_DEFENSE","GAME_ENVIRONMENT"]);
const THRESHOLDS = new Set(["NOT_CROSSED","CROSSED","UNRESOLVED"]);

const clean = v => v == null ? null : String(v).trim() || null;
const arr = v => Array.isArray(v) ? v : [];
const unique = v => [...new Set(v.filter(Boolean))];

function normalizeEvidence(item = {}, index = 0) {
  const effect = EFFECTS.has(item.effect) ? item.effect : "CONTEXT_ONLY";
  return {
    id: clean(item.id) || `evidence-${index + 1}`,
    statement: clean(item.statement),
    effect,
    scope: MATERIAL_SCOPES.has(item.scope) ? item.scope : null,
    materialChange: item.materialChange === true,
    verified: item.verified === true,
    fresh: item.fresh !== false,
    source: clean(item.source),
    causalGroup: clean(item.causalGroup) || clean(item.id) || `evidence-${index + 1}`,
    note: clean(item.note),
    customerConcern: item.customerConcern === true || item.source === "customer-stated-concern"
  };
}

function independentDecisionEvidence(evidence) {
  const seen = new Set();
  return evidence.filter(e => {
    if (e.effect === "CONTEXT_ONLY" || e.effect === "CONFLICTED_UNKNOWN") return false;
    if (!e.verified || !e.fresh) return false;
    if (seen.has(e.causalGroup)) return false;
    seen.add(e.causalGroup);
    return true;
  });
}

function buildDecisionTrace({
  question = null,
  prior = {},
  challenger = {},
  evidence = [],
  threshold = {},
  decision = {},
  flipConditions = []
} = {}) {
  const normalized = arr(evidence).map(normalizeEvidence);
  const independent = independentDecisionEvidence(normalized);
  const materialChanges = normalized.filter(e => e.materialChange);
  const invalidators = independent.filter(e => e.effect === "INVALIDATES_PRIOR");
  const reassessors = independent.filter(e => e.effect === "REASSESS_PRIOR");
  const reinforcers = independent.filter(e => e.effect === "REINFORCES_PRIOR");
  const challengers = independent.filter(e => e.effect === "CHALLENGES_PRIOR");
  const thresholdState = THRESHOLDS.has(threshold.state) ? threshold.state : "UNRESOLVED";
  const selected = clean(decision.selected);
  const incumbent = clean(prior.player);
  const challengerName = clean(challenger.player);

  // V1 records belief movement; it does not invent numeric weights or decide
  // whether a threshold SHOULD be crossed. That remains shadow/human-reviewed.
  const beliefMovement = invalidators.length
    ? "PRIOR_INVALIDATED"
    : reassessors.length
      ? "PRIOR_REQUIRES_REASSESSMENT"
      : challengers.length && reinforcers.length
        ? "COMPETING_EVIDENCE"
        : challengers.length
          ? "CHALLENGER_GAINED_GROUND"
          : reinforcers.length
            ? "PRIOR_REINFORCED"
            : "NO_DECISION_ACTIVE_MOVEMENT";

  const losing = selected && incumbent && challengerName
    ? (selected === incumbent ? challengerName : selected === challengerName ? incumbent : null)
    : null;

  return {
    version: VERSION,
    type: "SUPER_SAGE_DECISION_TRACE",
    mode: "SHADOW",
    canChangeProductionDecision: false,
    question: clean(question),
    prior: {
      player: incumbent,
      basis: arr(prior.basis).map(clean).filter(Boolean),
      confidence: clean(prior.confidence)
    },
    challenger: {
      player: challengerName,
      basis: arr(challenger.basis).map(clean).filter(Boolean)
    },
    materialChanges,
    evidence: normalized,
    evidenceDiscipline: {
      decisionActiveIndependent: independent.map(e => e.id),
      causalGroupsCountedOnce: unique(independent.map(e => e.causalGroup)),
      correlatedEvidenceDiscounted: normalized.length - independent.length
    },
    beliefMovement,
    threshold: {
      state: thresholdState,
      rationale: arr(threshold.rationale).map(clean).filter(Boolean)
    },
    decision: {
      selected,
      confidence: clean(decision.confidence),
      rationale: arr(decision.rationale).map(clean).filter(Boolean)
    },
    losingCase: {
      player: losing,
      rationale: arr(decision.losingCase).map(clean).filter(Boolean)
    },
    flipConditions: arr(flipConditions).map(clean).filter(Boolean),
    guardrails: {
      noNumericWeightsInvented: true,
      outcomeDataAllowed: false,
      providerCallsAllowed: false,
      automaticPromotionAllowed: false
    }
  };
}

module.exports = {
  VERSION, EFFECTS, MATERIAL_SCOPES, THRESHOLDS,
  normalizeEvidence, independentDecisionEvidence, buildDecisionTrace
};
