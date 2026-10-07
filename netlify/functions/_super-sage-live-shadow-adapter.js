"use strict";

// Shadow-only translation of the frozen production packet. Structured evidence
// supplies direction; a prose regex must never reverse which player benefits.
const { provisionalCall } = require("./_super-sage-operator-unscripted.js");
const MATCHUPS = ["Strong Negative", "Negative", "Neutral", "Positive", "Strong Positive"];
const TIERS = ["START", "FLEX", "SIT"];
const finite = v => typeof v === "number" && Number.isFinite(v);
function fact(text, source, group, effect, materialChange = false) {
  return { text, verified: true, source, causalHint: group, effect, materialChange };
}
function standingOrder(a, b) {
  const at = TIERS.indexOf(a?.standing?.tier), bt = TIERS.indexOf(b?.standing?.tier);
  if (at < 0 || bt < 0) return null;
  if (at !== bt) return at - bt;
  if (a.position && a.position === b.position && finite(a.standing.positionRank) && finite(b.standing.positionRank)) return a.standing.positionRank - b.standing.positionRank;
  if (finite(a.standing.depth) && finite(b.standing.depth)) return a.standing.depth - b.standing.depth;
  return null;
}
function matchupLabel(p) { return typeof p?.matchup === "string" ? p.matchup : p?.matchup?.label; }
function evidenceFacts(starter, challenger) {
  const facts = [];
  const order = standingOrder(starter, challenger);
  if (order !== null && order !== 0) {
    const winner = order < 0 ? starter : challenger;
    facts.push(fact(`${winner.name} has the stronger established Weekly SAGE standing.`, "frozen Weekly SAGE standing", "standing", order < 0 ? "REINFORCES_PRIOR" : "CHALLENGES_PRIOR"));
  }
  const sm = MATCHUPS.indexOf(matchupLabel(starter)), cm = MATCHUPS.indexOf(matchupLabel(challenger));
  if (sm >= 0 && cm >= 0 && sm !== cm) {
    const winner = cm > sm ? challenger : starter;
    facts.push(fact(`${winner.name} has the better opponent matchup (${matchupLabel(winner)}).`, "frozen matchup evidence", "matchup", cm > sm ? "CHALLENGES_PRIOR" : "REINFORCES_PRIOR"));
  }
  for (const [side, player] of [["incumbent", starter], ["challenger", challenger]]) {
    for (const change of player?.stateChanges || []) {
      if (change?.verified !== true) continue;
      // A verified change does not verify either its magnitude or its direction.
      facts.push(fact(`${player.name}: ${change.note || change.type || "Verified state change."}`, "frozen state change", `${side}-${change.type || "state-change"}`, "REASSESS_PRIOR", true));
    }
    if (player?.roleExpansion?.validated === true) {
      facts.push(fact(`${player.name} has a validated role increase.`, "frozen role evidence", `${side}-role`, side === "challenger" ? "CHALLENGES_PRIOR" : "REINFORCES_PRIOR", true));
    }
  }
  const sp = starter?.projection, cp = challenger?.projection;
  if (sp?.admissible === true && cp?.admissible === true && finite(sp.points) && finite(cp.points) && sp.points !== cp.points) {
    const winner = cp.points > sp.points ? challenger : starter;
    facts.push(fact(`${winner.name} has the current projection advantage (${winner.projection.points} vs ${winner === starter ? cp.points : sp.points}).`, "frozen projection", "projection", winner === challenger ? "CHALLENGES_PRIOR" : "REINFORCES_PRIOR"));
  }
  return facts;
}
function missingInformation(player) {
  const missing = (player?.uncertainty || []).map(u => `${player.name}: ${u.text || u.code}`);
  if (player?.availability?.availabilityVerified !== true) missing.push(`${player.name}: availability is unverified.`);
  if (player?.availability?.questionable || ["QUESTIONABLE", "DOUBTFUL", "UNVERIFIED"].includes(player?.availability?.effectiveStatus?.status)) missing.push(`${player.name}: availability remains uncertain.`);
  if (player?.availability?.conflict?.length) missing.push(`${player.name}: availability sources disagree.`);
  if (["REASSESS", "INVALID", "UNAVAILABLE"].includes(player?.baselineValidity?.state)) missing.push(`${player.name}: the established baseline requires reassessment.`);
  for (const change of player?.stateChanges || []) {
    if (change?.verified === true && change.magnitudeValidated !== true) missing.push(`${player.name}: ${change.note || change.type || "state change"} (impact is not validated).`);
  }
  if (player?.roleExpansion?.claimed && player.roleExpansion.validated !== true) missing.push(`${player.name}: claimed role expansion is not validated.`);
  return [...new Set(missing)];
}
function confidenceFor(slot, call) {
  const uncertain = call.status === "NO_CALL" || call.status === "CONDITIONAL" || call.uncertaintyType !== "STABLE";
  const productionLimited = ["LIMITED", "LOW"].includes(String(slot?.confidence?.label || "").toUpperCase());
  return { label: uncertain || productionLimited ? "LOW" : "MODERATE" };
}
function shadowSlot(slot) {
  const incumbent = slot?.starter || null, challenger = slot?.comparator || null;
  // Do not inherit Production's explanation or claim its validated edge.
  const { explanation, ...packet } = slot || {};
  if (!incumbent || !challenger) return { ...packet, starter: null, decisionState: "UNRESOLVED", hasValidatedEdge: false, confidence: { label: "LOW" }, decidedBy: "operator-shadow-no-comparator", shadow: { selected: null, callStatus: "NO_CALL", uncertaintyType: "MISSING_INFORMATION", rationale: "No recorded comparator is available for an independent review.", evidenceUsed: [] }, shadowSource: "FROZEN_PRODUCTION_PACKET" };
  const facts = evidenceFacts(incumbent, challenger);
  const missing = [...missingInformation(incumbent), ...missingInformation(challenger)];
  const raw = { id: "live-" + String(slot.slotLabel || "slot"), label: "Live lineup shadow", informationState: missing.length ? "OPEN" : "COMPLETE", prior: { player: incumbent.name, strength: "MODERATE" }, challenger: { player: challenger.name }, facts };
  let call = provisionalCall(raw);
  if (!facts.length || incumbent?.availability?.unavailable || challenger?.availability?.unavailable) {
    call = { ...call, selected: null, status: "NO_CALL", uncertaintyType: "MISSING_INFORMATION", rationale: !facts.length ? "No admissible comparative evidence is available." : "An unavailable player cannot receive an independent start recommendation." };
  } else if (missing.length) {
    call = { ...call, selected: null, status: "CONDITIONAL", uncertaintyType: "MISSING_INFORMATION", rationale: "Unresolved player evidence prevents a definitive independent call." };
  }
  const chosen = call.selected === challenger.name ? challenger : call.selected === incumbent.name ? incumbent : null;
  return { ...packet, starter: chosen, comparator: chosen === challenger ? incumbent : challenger, decidedBy: "operator-shadow", decisionState: chosen ? "DECIDED" : "UNRESOLVED", hasValidatedEdge: false, confidence: confidenceFor(slot, call), shadow: { selected: call.selected, incumbent: incumbent.name, challenger: challenger.name, informationState: raw.informationState, missingInformation: missing, callStatus: call.status, movement: call.movement, threshold: call.threshold, uncertaintyType: call.uncertaintyType, rationale: call.rationale, evidenceUsed: call.evidenceUsed }, shadowSource: "FROZEN_PRODUCTION_PACKET" };
}
function buildAutomaticShadowRecord(productionRecord) {
  if (!productionRecord || productionRecord.evidenceType !== "super-sage-lineup-decision") throw new Error("Frozen production lineup decision required.");
  return { schemaVersion: 2, evidenceType: "super-sage-live-shadow-lineup", decisionScope: productionRecord.decisionScope, request: productionRecord.request, productionDecisionId: productionRecord.decisionId, slots: (productionRecord.slots || []).map(shadowSlot), authority: { productionAuthority: false, providerCallsAllowed: false, outcomeDataAllowed: false, automaticPromotionAllowed: false } };
}
module.exports = { buildAutomaticShadowRecord, evidenceFacts, shadowSlot };
