"use strict";
// Associate a role assertion with its named subject, rather than every player
// mentioned in the same sentence. This remains a targeted check, not a parser.
function namedClauses(sentence, player, players) {
  const surname = name => String(name || '').replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV)$/i, '').split(/\s+/).pop();
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const name = surname(player.name);
  if (!name) return [];
  const matches = [...sentence.matchAll(new RegExp(`\\b${escape(name)}\\b`, 'gi'))];
  const backfieldNames = players.flatMap(p => {
    const context = p.facts?.find(f => f.field === 'backfieldContext')?.value;
    return [...(context?.players || []), ...(context?.reportedRoles?.players || [])].map(back => back.name);
  });
  const others = [...new Set([...players.map(p => p.name), ...backfieldNames].map(surname).filter(n => n && n.toLowerCase() !== name.toLowerCase()))];
  return matches.map(match => {
    const rest = sentence.slice(match.index + match[0].length);
    const next = others.length ? rest.search(new RegExp(`\\b(?:${others.map(escape).join('|')})\\b`, 'i')) : -1;
    return sentence.slice(match.index, next < 0 ? sentence.length : match.index + match[0].length + next);
  });
}
// Targeted claim checks, not a complete semantic verifier. Never rewrite output
// or substitute a recommendation. Human qualification still applies.
function validateClaims(answer, packet) {
  const errors = [];
  const text = [answer?.explanation, answer?.caveat, answer?.reconsider].filter(v => typeof v === "string").join("\n");
  const currentText = [answer?.explanation, answer?.caveat].filter(v => typeof v === "string").join("\n");
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
  if (/\bprojection\s+(?:of\s+\d+(?:\.\d+)?\s+)?(?:already\s+)?(?:assumes|reflects|accounts for|incorporates|includes|factors in)\b/i.test(text) && !facts.some(f => f.field === "projectionAdjustment" && f.value?.verified === true)) errors.push("unsupported_projection_adjustment");
  if (/\b(?:projections?|estimates?|forecasts?)\s+(?:already\s+)?(?:don't|do not|doesn't|does not)\s+account for\b/i.test(text) && !facts.some(f => f.field === "projectionAdjustment" && f.value?.verified === true)) errors.push("unsupported_projection_adjustment");
  if (/\b(?:is|fully|confirmed|clear|perfect|active and)\s+health(?:y)?\b/i.test(currentText) && !facts.some(f => f.field === "healthConfirmation" && f.value?.verified === true)) errors.push("availability_overstated_as_health");
  if (/\bhealthier\b/i.test(currentText) && !facts.some(f => f.field === "healthConfirmation" && f.value?.verified === true)) errors.push("availability_overstated_as_health");
  if (/\bclean bill of health\b/i.test(currentText) && !facts.some(f => f.field === "healthConfirmation" && f.value?.verified === true)) errors.push("availability_overstated_as_health");
  for (const player of packet.players || []) {
    const context = player.facts?.find(f => f.field === "backfieldContext")?.value;
    const chart = context?.reportedRoles;
    const candidate = chart?.players?.find(p => p.listedRank === chart.candidateListedRank);
    const surname = String(player.name || "").split(/\s+/).pop();
    const mentionsPlayer = sentence => sentence.toLowerCase().includes(surname.toLowerCase());
    if (context?.roleOrderVerified === false && currentText.split(/[.!?\n]/).some(s => namedClauses(s, player, packet.players || []).some(clause => /(?:sits?|is|listed|ranks?)\s+(?:the\s+)?(?:first|second|third|atop)|(?:lead|starting|backup)\s+(?:back|role)|(?:first|second|third)\s+(?:on|in)\s+(?:the|a)\s+(?:depth|backfield)/i.test(clause) && !/not verified|unverified|cannot infer|can't infer|does not establish/i.test(clause)))) errors.push("unverified_backfield_role_order");
    const sourcedRoleChange = player.facts.some(f => f.field === "stateChanges" && (Array.isArray(f.value) ? f.value : [f.value]).some(change => change?.type === "ROLE_CHANGE" && change.verified === true));
    if (currentText.split(/[.!?\n]/).some(s => mentionsPlayer(s) && /\b(?:expect|project|anticipate|will|likely|could|may|might)\b[^.!?\n]*\b\d+(?:\.\d+)?\s+(?:touches|carries|targets|snaps)\b/i.test(s)) && !player.facts.some(f => f.field === "expectedOpportunity" && (Array.isArray(f.value) ? f.value : [f.value]).some(v => v?.validated === true))) errors.push("unsupported_numeric_workload_forecast");
    if (!candidate) continue;
    if (currentText.split(/[.!?\n]/).some(s => candidate.status === "UNKNOWN" && s.toLowerCase().includes(surname.toLowerCase()) && /no injury (?:issues|concerns)|healthy|health cleared/i.test(s))) errors.push("availability_overstated_as_health");
    if (currentText.split(/[.!?\n]/).some(s => mentionsPlayer(s) && /in line for more work|puts? .* (?:more work|increased workload)/i.test(s) && !/does not|doesn't|not establish/i.test(s) && !(/\b(?:I expect|I project|I anticipate|likely|could|may|might)\b/i.test(s) && sourcedRoleChange))) errors.push("unverified_workload_increase");
  }
  if (/\btrade\b/i.test(text) && !facts.some(f => /\btrade\b/i.test(JSON.stringify(f.value)))) errors.push("unsupported_trade_event");
  if (/\bboth\s+(?:players\s+)?(?:sit|are)\s+in\s+(?:the\s+)?flex\s+tier\b/i.test(text) && packet.players.some(p => p.facts?.find(f => f.field === "standing")?.value?.tier !== "FLEX")) errors.push("standing_tier_misrepresented");
  if (/\b(?:will|he'll|she'll)\s+(?:see|get|receive|have)\s+(?:more|at least\s+\d|\d)/i.test(text)) errors.push("guaranteed_future_workload");
  if (/\b(?:putting up|scoring|scores|scored|producing)\s+\d+(?:\.\d+)?\s+(?:fantasy\s+)?points\b/i.test(text) && !facts.some(f => f.field === "observedPoints")) errors.push("projection_presented_as_scored_points");
  if (text.split(/[.!?\n]/).some(s => /\bprojection(?:\s+edge)?\s+(?:narrows|improves|rises|increases|moves|shifts|falls|drops)\b/i.test(s) && !/\b(?:updated|revised|new|verified)\s+projection\b/i.test(s))) errors.push("unsupported_projection_change");
  const observedOpportunities = facts.some(f => f.field === "observedOpportunity" || (f.field === "establishedRole" && /opportunities per game/i.test(f.value?.description || "")));
  if (observedOpportunities && /\b\d+(?:\.\d+)?\s+(?:targets|catches|carries|touches)\s+per game\b/i.test(text) && !facts.some(f => ["observedTargets", "observedCarries", "observedReceptions", "observedTouches"].includes(f.field))) errors.push("observed_opportunity_unit_changed");
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
  // Requalify a cached format-only rejection under the current contract.
  // Provider, factual and other failures cannot be cleared by this path.
  if (review.status === "INVALID" && review.validationErrors?.length && review.validationErrors.every(e => e === "invalid_sentence_evidence") && !errors.length) return { ...review, storedStatus: review.status, status: "REVIEW_READY", validationErrors: [], revalidated: true };
  if (!["REVIEW_READY", "INVALID"].includes(review.status) || !errors.length) return review;
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
    const issues = [...new Set([...validateClaims({ [segment.field]: segment.text }, scoped), ...validatePairVoice({ explanation: segment.text })])];
    if (packet.requireSentenceEvidence && segment.field === 'explanation') {
      const known = new Set((packet.players || []).flatMap(p => (p.facts || []).map(f => f.factId)));
      if (!Array.isArray(segment.factIds) || !segment.factIds.length || segment.factIds.length > 6 || !segment.factIds.every(id => known.has(id) && answer.factIds?.includes(id))) issues.push('invalid_sentence_evidence');
    }
    return { ...segment, issues, materiality: issues.length ? 'REQUIRES_REVIEW' : 'NOT_ESTABLISHED' };
  });
  return { ...review, claimAssessment: { recommendation: 'NOT_REVIEWED', semanticReviewRequired: true, claims, note: 'Targeted checks only. No detected issue is not proof of accuracy; an issue is not an automatic rejection of the choice.' } };
}
module.exports = { validateClaims, revalidateCached, withClaimAssessment };
