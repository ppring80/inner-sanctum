"use strict";
// Targeted claim checks, not a complete semantic verifier. Never rewrite output
// or substitute a recommendation. Human qualification still applies.
function validateClaims(answer, packet) {
  const errors = [];
  const text = [answer?.explanation, answer?.caveat, answer?.reconsider].filter(v => typeof v === "string").join("\n");
  const facts = (packet.players || []).flatMap(p => p.facts || []);
  const hasFloor = facts.some(f => f.field === "projection" && Number.isFinite(f.value?.floor));
  const floorClaims = [...text.matchAll(/\b(?:better|safer|higher|stronger|best|highest|(?:more\s+)?(?:dependable|reliable|consistent))\s+(?:(?:scoring|volume)\s+)?floor(?:\s+play)?\b/gi)];
  const positiveFloorClaim = floorClaims.some(m => {
    const prefix = text.slice(Math.max(0, m.index - 80), m.index);
    return !/\b(?:not|cannot|can't|doesn't|does not)\s+(?:(?:establish|prove|support|mean|imply|guarantee|demonstrate)\s+)?(?:a\s+|the\s+)?$/i.test(prefix);
  });
  if (!hasFloor && positiveFloorClaim) errors.push("unsupported_floor_comparison");
  if (!hasFloor && /\b(?:shrink|raise|lower|reduce|increase)\s+(?:his|her|their|the)\s+floor\b/i.test(text)) errors.push("unsupported_floor_change");
  if (!facts.some(f => f.field === "projection" && Number.isFinite(f.value?.ceiling)) && /\b(?:less|more|greater|higher|lower|highest|lowest|lacks?|missing)[\s\u2010-\u2015-]+(?:the\s+)?(?:upside|ceiling)\b/i.test(text)) errors.push("unsupported_ceiling_comparison");
  const cleanerProjectionClaims = [...text.matchAll(/\bcleaner\s+projection(?:\s+edge)?\b/gi)];
  if (cleanerProjectionClaims.some(m => !/\b(?:not|cannot|can't|doesn't|does not)\s+(?:(?:establish|prove|support|mean|imply|guarantee|demonstrate)\s+)?(?:a\s+|the\s+)?$/i.test(text.slice(Math.max(0, m.index - 80), m.index))) && !facts.some(f => f.field === "projectionQuality" && f.value?.verified === true)) errors.push("unsupported_projection_quality");
  // These packets do not establish how provider projections were adjusted.
  if (/\bprojection\s+(?:of\s+\d+(?:\.\d+)?\s+)?(?:assumes|reflects|accounts for|incorporates|includes|factors in)\b/i.test(text) && !facts.some(f => f.field === "projectionAdjustment" && f.value?.verified === true)) errors.push("unsupported_projection_adjustment");
  if (/\b(?:projections?|estimates?|forecasts?)\s+(?:already\s+)?(?:don't|do not|doesn't|does not)\s+account for\b/i.test(text) && !facts.some(f => f.field === "projectionAdjustment" && f.value?.verified === true)) errors.push("unsupported_projection_adjustment");
  if (/\b(?:is|fully|confirmed|clear|perfect|active and)\s+health(?:y)?\b/i.test(text) && !facts.some(f => f.field === "healthConfirmation" && f.value?.verified === true)) errors.push("availability_overstated_as_health");
  if (/\bhealthier\b/i.test(text) && !facts.some(f => f.field === "healthConfirmation" && f.value?.verified === true)) errors.push("availability_overstated_as_health");
  if (/\bclean bill of health\b/i.test(text) && !facts.some(f => f.field === "healthConfirmation" && f.value?.verified === true)) errors.push("availability_overstated_as_health");
  if (/\btrade\b/i.test(text) && !facts.some(f => /\btrade\b/i.test(JSON.stringify(f.value)))) errors.push("unsupported_trade_event");
  if (/\bboth\s+(?:players\s+)?(?:sit|are)\s+in\s+(?:the\s+)?flex\s+tier\b/i.test(text) && packet.players.some(p => p.facts?.find(f => f.field === "standing")?.value?.tier !== "FLEX")) errors.push("standing_tier_misrepresented");
  if (/\b(?:will|he'll|she'll)\s+(?:see|get|receive|have)\s+(?:more|at least\s+\d|\d)/i.test(text)) errors.push("guaranteed_future_workload");
  if (/\b(?:putting up|scoring|scores|scored|producing)\s+\d+(?:\.\d+)?\s+(?:fantasy\s+)?points\b/i.test(text) && !facts.some(f => f.field === "observedPoints")) errors.push("projection_presented_as_scored_points");
  if (text.split(/[.!?\n]/).some(s => /\bprojection(?:\s+edge)?\s+(?:narrows|improves|rises|increases|moves|shifts|falls|drops)\b/i.test(s) && !/\b(?:updated|revised|new|verified)\s+projection\b/i.test(s))) errors.push("unsupported_projection_change");
  const observedOpportunities = facts.some(f => f.field === "establishedRole" && /opportunities per game/i.test(f.value?.description || ""));
  if (observedOpportunities && /\b\d+(?:\.\d+)?\s+(?:targets|catches|carries)\s+per game\b/i.test(text) && !facts.some(f => ["observedTargets", "observedCarries", "observedReceptions"].includes(f.field))) errors.push("observed_opportunity_unit_changed");
  const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const p of packet.players || []) {
    if (p.position === "QB") continue;
    const cleaned = (p.name || "").replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV)$/i, "");
    const aliases = [cleaned, cleaned.split(/\s+/).pop()].filter(Boolean);
    if (aliases.some(n => new RegExp(`\\b${escape(n)}\\s+(?:will|would|can|should)\\s+throw\\b`, "i").test(text))) errors.push("non_qb_described_as_passer");
  }
  return [...new Set(errors)];
}
function revalidateCached(review, errors) {
  if (review.status !== "REVIEW_READY" || !errors.length) return review;
  // Reassess the returned view; preserve the original stored answer and status.
  return { ...review, storedStatus: review.status, status: "INVALID", validationErrors: [...new Set([...(review.validationErrors || []), ...errors])], revalidated: true };
}
// An invalid explanation does not by itself grade the recommendation.
// Preserve exact output and errors; materiality and choice remain human reviews.
function withClaimAssessment(review, packet) {
  if (!review?.answer) return review;
  const answer = review.answer;
  const sentences = Array.isArray(answer.explanationSentences)
    ? answer.explanationSentences.map(s => ({ text: s.text, factIds: s.factIds }))
    : String(answer.explanation || '').split(/\n+/).filter(Boolean).map(text => ({ text }));
  const segments = sentences.map((s, index) => ({ field: 'explanation', index, ...s }));
  for (const field of ['caveat', 'reconsider']) if (typeof answer[field] === 'string') segments.push({ field, text: answer[field] });
  const { validatePairVoice } = require('./_super-sage-shadow-voice.js');
  const claims = segments.map(segment => {
    const scoped = Array.isArray(segment.factIds) ? { ...packet, players: (packet.players || []).map(p => ({ ...p, facts: (p.facts || []).filter(f => segment.factIds.includes(f.factId)) })) } : packet;
    const issues = [...new Set([...validateClaims({ explanation: segment.text }, scoped), ...validatePairVoice({ explanation: segment.text })])];
    return { ...segment, issues, materiality: issues.length ? 'REQUIRES_REVIEW' : 'NOT_ESTABLISHED' };
  });
  return { ...review, claimAssessment: { recommendation: 'NOT_REVIEWED', semanticReviewRequired: true, claims, note: 'Targeted checks only. No detected issue is not proof of accuracy; an issue is not an automatic rejection of the choice.' } };
}
module.exports = { validateClaims, revalidateCached, withClaimAssessment };
