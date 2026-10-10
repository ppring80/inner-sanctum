"use strict";
// Coverage only, not proof of factual correctness or a preferred recommendation.
function validateBackfieldCoverage(answer, packet) {
  const errors = [], text = String(answer?.explanation || "");
  const cited = new Set(answer?.factIds || []);
  const mentions = name => text.toLowerCase().includes(String(name).split(/\s+/).pop().toLowerCase());
  const observed = (packet.players || []).map(player => ({ player, fact: player.facts.find(f => f.field === 'observedOpportunity') }));
  if (observed.length === 2 && observed.every(({ fact }) => Number.isFinite(fact?.value?.avgLast3)) &&
      (!observed.every(({ player, fact }) => mentions(player.name) && cited.has(fact.factId)) ||
       !/\bopportunit(?:y|ies)\b/i.test(text) || !/recent|last (?:three|3)|last[- ]three/i.test(text))) {
    errors.push('missing_observed_usage_comparison');
  }
  for (const player of packet.players || []) {
    const context = player.facts.find(f => f.field === "backfieldContext");
    const roles = context?.value?.reportedRoles;
    if (!roles) continue;
    if (!cited.has(context.factId)) errors.push("missing_backfield_citation");
    const candidate = roles.players?.find(p => p.listedRank === roles.candidateListedRank);
    if (candidate?.status === "UNKNOWN" && !text.split(/[.!?\n]/).some(s => candidateUncertainty(s, candidate.name, roles))) errors.push("missing_candidate_health_uncertainty");
    const next = roles.nextListedAlternative;
    if (next && !mentions(next.name)) errors.push("missing_next_listed_alternative");
    if (next?.status === "UNKNOWN" && !text.split(/[.!?\n]/).some(s => mentionsIn(s, next.name) && /unknown|unclear|not (?:confirmed|cleared)|health.*(?:unverified|unresolved)/i.test(s))) errors.push("missing_alternative_health_uncertainty");
    for (const back of roles.players || []) {
      if (!["IR", "OUT", "DOUBTFUL", "PUP", "NFI", "RESERVE/INJURED"].includes(back.status)) continue;
      if (!text.split(/[.!?\n]/).some(s => mentionsIn(s, back.name) && /\bIR\b|injured reserve|\bout\b|doubtful|PUP|NFI|reserve\/injured/i.test(s))) errors.push("missing_unavailable_back_context");
    }
    for (const name of roles.notListedInChart || []) if (!text.split(/[.!?\n]/).some(s => mentionsIn(s, name) && /(?:absent|missing|not (?:even )?(?:listed|on)|outside).*chart|chart.*(?:absent|missing|not (?:list|include))/i.test(s))) errors.push("missing_uncharted_alternative");
    const expansion = player.facts.find(f => f.field === "roleExpansion");
    if (expansion && !cited.has(expansion.factId)) errors.push("missing_role_expansion_citation");
    if (expansion?.value?.validated !== true && !/\b(?:work|workload|snaps|touches|carries)\b[^.!?\n]*(?:unknown|unclear|unverified|not (?:known|confirmed|verified)|don't know|do not know|no verified sign)|(?:unknown|unclear|unverified|don't know|do not know|no verified sign)[^.!?\n]*\b(?:work|workload|snaps|touches|carries)\b/i.test(text)) errors.push("missing_workload_uncertainty");
    const availability = player.facts.find(f => f.field === "availability");
    if (/QUESTIONABLE|UNKNOWN|Q/i.test(availability?.value?.status || "") && !cited.has(availability.factId)) errors.push("missing_candidate_availability_citation");
  }
  // Unverified provider roster: no sentence about this player and a listed
  // teammate may assert an order, and none may call that roster a chart.
  for (const player of packet.players || []) {
    const v = player.facts.find(f => f.field === "backfieldContext")?.value;
    if (v?.sourceType !== "PROVIDER_ROSTER_UNORDERED") continue;
    const names = (v.teammates || []).map(t => t.name);
    for (const sentence of text.split(/[.!?\n]/)) {
      if (!mentionsIn(sentence, player.name)) continue;
      const withTeammate = names.some(n => mentionsIn(sentence, n));
      // Saying the order is unknown is the honest statement, not an order claim.
      const deniesOrder = /\b(?:no|not|without|unverified|unknown|don't know|do not know)\b[^.]*\b(?:order|depth|chart|roles?|lead)\b/i.test(sentence);
      const strongOrder = /\b(?:ahead of|behind|backup|back-up|lead back|starter|starting|No\.? ?\d|top of|atop)\b/i.test(sentence);
      const weakOrder = /\b(?:first|second|third|depth)\b/i.test(sentence);
      if (withTeammate && (strongOrder || (weakOrder && !deniesOrder))) errors.push("unverified_backfield_role_order");
      if (/\bchart\b/i.test(sentence) && !/\b(?:no|not|without|isn't|is not)\b[^.]*\b(?:chart|order)\b/i.test(sentence) && !(packet.players || []).some(o => o !== player && mentionsIn(sentence, o.name))) errors.push("provider_roster_called_chart");
    }
  }
  return [...new Set(errors)];
}
function candidateUncertainty(text, name, roles) {
  const lower = text.toLowerCase(), surname = String(name).split(/\s+/).pop().toLowerCase();
  if (!surname) return false;
  let start = lower.indexOf(surname);
  while (start >= 0) {
    let end = text.length;
    for (const other of [...(roles.players || []).map(p => p.name), ...(roles.notListedInChart || [])]) {
      if (other === name) continue;
      const index = lower.indexOf(String(other).split(/\s+/).pop().toLowerCase(), start + surname.length);
      if (index >= 0) end = Math.min(end, index);
    }
    const clause = text.slice(start, end);
    if (/unknown|unclear|unverified|not (?:confirmed|cleared)|conflict/i.test(clause) && /health|status|availability|chart|ACTIVE|listed/i.test(clause)) return true;
    start = lower.indexOf(surname, start + surname.length);
  }
  return false;
}
function mentionsIn(text, name) { return text.toLowerCase().includes(String(name).split(/\s+/).pop().toLowerCase()); }
module.exports = { validateBackfieldCoverage };
