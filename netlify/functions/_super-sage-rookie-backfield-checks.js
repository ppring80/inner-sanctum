"use strict";
// Coverage only, not proof of factual correctness or a preferred recommendation.
function validateBackfieldCoverage(answer, packet) {
  const errors = [], text = String(answer?.explanation || "");
  const cited = new Set(answer?.factIds || []);
  const mentions = name => text.toLowerCase().includes(String(name).split(/\s+/).pop().toLowerCase());
  for (const player of packet.players || []) {
    const context = player.facts.find(f => f.field === "backfieldContext");
    const roles = context?.value?.reportedRoles;
    if (!roles) continue;
    if (!cited.has(context.factId)) errors.push("missing_backfield_citation");
    const next = roles.nextListedAlternative;
    if (next && !mentions(next.name)) errors.push("missing_next_listed_alternative");
    if (next?.status === "UNKNOWN" && !text.split(/[.!?\n]/).some(s => mentionsIn(s, next.name) && /unknown|unclear|not (?:confirmed|cleared)|health.*(?:unverified|unresolved)/i.test(s))) errors.push("missing_alternative_health_uncertainty");
    for (const back of roles.players || []) {
      if (back.listedRank <= roles.candidateListedRank || !["IR", "OUT", "DOUBTFUL", "PUP", "NFI", "RESERVE/INJURED"].includes(back.status)) continue;
      if (!text.split(/[.!?\n]/).some(s => mentionsIn(s, back.name) && /\bIR\b|injured reserve|\bout\b|doubtful|PUP|NFI|reserve\/injured/i.test(s))) errors.push("missing_unavailable_back_context");
    }
    for (const name of roles.notListedInChart || []) if (!text.split(/[.!?\n]/).some(s => mentionsIn(s, name) && /(?:absent|missing|not (?:listed|on)|outside).*chart|chart.*(?:absent|missing|not (?:list|include))/i.test(s))) errors.push("missing_uncharted_alternative");
    const expansion = player.facts.find(f => f.field === "roleExpansion");
    if (expansion && !cited.has(expansion.factId)) errors.push("missing_role_expansion_citation");
    if (expansion?.value?.validated !== true && !/\b(?:work|workload|snaps|touches|carries)\b[^.!?\n]*(?:unknown|unclear|unverified|not (?:known|confirmed)|don't know|do not know)|(?:unknown|unclear|unverified|don't know|do not know)[^.!?\n]*\b(?:work|workload|snaps|touches|carries)\b/i.test(text)) errors.push("missing_workload_uncertainty");
    const availability = player.facts.find(f => f.field === "availability");
    if (/QUESTIONABLE|UNKNOWN|Q/i.test(availability?.value?.status || "") && !cited.has(availability.factId)) errors.push("missing_candidate_availability_citation");
  }
  return [...new Set(errors)];
}
function mentionsIn(text, name) { return text.toLowerCase().includes(String(name).split(/\s+/).pop().toLowerCase()); }
module.exports = { validateBackfieldCoverage };
