"use strict";
// Targeted checks for the observed full-lineup failures. These do not grade
// the recommendation or constitute a complete natural-language verifier.
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const alias = p => String(p.name || '').replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV)$/i,'').split(/\s+/).pop();
function validateFullClaims(call, packet) {
  const errors=[];
  const text=[call.explanation,call.countercase,...(Array.isArray(call.reconsider)?call.reconsider:[])].filter(v=>typeof v==='string').join('\n');
  const sentences=text.split(/(?<!\d)[.!?]|[.!?](?!\d)|\n/);
  const namedPlayers=packet.players.filter(p=>new RegExp(`\\b${escape(alias(p))}\\b`,'i').test(text));
  for (const sentence of sentences) {
    const mentions=packet.players.map(p=>({p,re:new RegExp(`\\b${escape(alias(p))}\\b`,'gi')})).flatMap(({p,re})=>[...sentence.matchAll(re)].map(m=>({p,start:m.index,end:m.index+m[0].length}))).sort((a,b)=>a.start-b.start);
    const selected=packet.players.find(p=>p.playerId===call.playerId);
    if(!mentions.length && selected && /^\s*His\b/i.test(sentence)) mentions.push({p:selected,start:0,end:0});
    for(let i=0;i<mentions.length;i++) {
      const {p,end}=mentions[i],clause=sentence.slice(end,mentions[i+1]?.start ?? sentence.length).trimStart();
      const opportunity=p.facts.find(f=>f.field==='observedOpportunity');
      if (opportunity && /\b\d+(?:\.\d+)?\s+(?:touches|targets|carries|catches)\s+per game\b/i.test(clause)) {
        const unit=clause.match(/\b\d+(?:\.\d+)?\s+(touches|targets|carries|catches)\s+per game\b/i)[1].toLowerCase();
        const field={touches:'observedTouches',targets:'observedTargets',carries:'observedCarries',catches:'observedReceptions'}[unit];
        if(!p.facts.some(f=>f.field===field && call.factIds?.includes(f.factId))) errors.push('observed_opportunity_unit_changed');
      }
      // A direct named comparative usage claim needs both cited averages.
      // Do not infer a pronoun's subject from the nearest opponent name.
      if(!/^(?:['’]s\s+|(?:has|holds)\s+(?:the\s+|a\s+)?)/i.test(clause)) continue;
      const comparative=clause.match(/\b(?:stronger|higher|greater|lower|less)\s+(?:recent\s+)?(?:opportunity\s+(?:volume|average)|(?:carries\s+plus\s+targets)\s+average)\b/i);
      if(!comparative || /\b(?:not|isn't|is not)\s*$/i.test(clause.slice(0,comparative.index))) continue;
      const others=namedPlayers.filter(other=>other.playerId!==p.playerId);
      for(const other of [...new Set(others)]) {
        const otherFact=other.facts.find(f=>f.field==='observedOpportunity');
        const a=opportunity?.value?.avgLast3,b=otherFact?.value?.avgLast3;
        if(!Number.isFinite(a)||!Number.isFinite(b)||!call.factIds?.includes(opportunity.factId)||!call.factIds?.includes(otherFact.factId)) {errors.push('usage_comparison_evidence_missing');continue;}
        const higher=/^(?:stronger|higher|greater)\b/i.test(comparative[0]);
        if(higher?a<=b:a>=b) errors.push('usage_comparison_reversed');
      }
    }
  }
  return [...new Set(errors)];
}
module.exports={validateFullClaims};
