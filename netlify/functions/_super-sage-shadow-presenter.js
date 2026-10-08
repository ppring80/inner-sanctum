'use strict';
// Private translation only: explain an already-decided frozen shadow slot.
// No rankings, player selection, provider access, or production authority.
const sentence = text => /[.!?]$/.test(text) ? text : text + '.';
const clean = value => typeof value === 'string' ? value.trim() : '';
function resolutionFor(trace, selected, opponent) {
  if (!selected) return '';
  const basis=trace.decisionBasis;
  if(basis?.kind==='ELIGIBILITY') return clean(trace.rationale);
  if(basis?.kind==='STRUCTURAL_INVALIDATION') return `Verified evidence invalidated ${clean(trace.incumbent)}'s established case, so I moved to ${clean(selected)}.`;
  if(basis?.kind==='MATERIAL_REASSESSMENT') return `The recorded state change required a fresh comparison; the verified evidence ${trace.threshold==='CROSSED'?'supported moving to '+clean(selected):'did not provide enough support to replace '+clean(selected)}.`;
  if(basis?.kind==='INDEPENDENT_SUPPORT' && trace.threshold==='NOT_CROSSED') {
    const opposing=basis.challengingGroups||[];
    if(opposing.length===1&&opposing[0]==='projection'&&(basis.reinforcingGroups||[]).includes('standing')) return `${opponent}'s projection advantage is one opposing signal against ${clean(selected)}'s stronger standing. It lacks the additional independent support needed to change this close call.`;
    return (basis.challengingGroups||[]).length ? `The evidence favoring ${opponent} does not have enough independent support to overturn ${clean(selected)}'s established case.` : `The recorded comparative evidence favors ${clean(selected)}; it supplies no independent advantage for ${opponent}.`;
  }
  if(basis?.kind==='INDEPENDENT_SUPPORT' && trace.threshold==='CROSSED') return `Multiple independent advantages support ${clean(selected)}, enough to overturn ${opponent}'s established case.`;
  return clean(trace.rationale);
}
function presentShadowSlot(slot) {
  if (slot?.shadowSource !== 'FROZEN_PRODUCTION_PACKET' || slot.hasValidatedEdge !== false || !slot.shadow) throw new Error('Frozen private shadow slot required.');
  const trace = slot.shadow;
  const selected = typeof trace.selected === 'string' && clean(trace.selected) ? trace.selected : null;
  const incumbent = clean(trace.incumbent), challenger = clean(trace.challenger);
  const isCall = trace.callStatus === 'PROVISIONAL_CALL' && selected !== null;
  if ((trace.callStatus === 'PROVISIONAL_CALL' && !selected) || (selected && (!isCall || ![trace.incumbent, trace.challenger].includes(selected)))) throw new Error('Shadow presentation requires a consistent recorded selection.');
  const evidence = (trace.evidenceUsed || []).filter(e => clean(e.text)).map(e => ({text:e.text,effect:e.effect,group:e.group}));
  const confidenceWarnings = [...new Set((trace.confidenceWarnings || []).map(clean).filter(Boolean))];
  const missing = [...new Set((trace.missingInformation || []).map(clean).filter(Boolean))];
  const pair = challenger && incumbent ? `${incumbent} vs ${challenger}` : incumbent || challenger || slot.slotLabel || 'this slot';
  const favorable = selected === trace.challenger ? ['CHALLENGES_PRIOR','INVALIDATES_PRIOR'] : ['REINFORCES_PRIOR'];
  const adverse = selected === trace.challenger ? ['REINFORCES_PRIOR'] : ['CHALLENGES_PRIOR'];
  const supporting = isCall ? evidence.filter(e => favorable.includes(e.effect)) : [];
  const opposing = isCall ? evidence.filter(e => adverse.includes(e.effect)) : [];
  const reviewNeeds = missing.length ? missing : isCall ? [] : [clean(trace.rationale) || 'A recorded comparison with verified player evidence is required.'];
  // Keep the 1/3/10 view brief; exact evidence and review needs remain below it.
  const briefNeeds = reviewNeeds.filter(text=>text.length<=160);
  const perPlayerNeeds = [incumbent,challenger].filter(Boolean).map(name=>briefNeeds.find(text=>text.startsWith(name+':'))).filter(Boolean);
  const needsSummary = [...new Set([...perPlayerNeeds,...briefNeeds])].slice(0,3);
  if (!needsSummary.length && reviewNeeds.length) needsSummary.push('The recorded comparison or state-change evidence needs verification; see reviewNeeds.');
  const opponent=selected===trace.incumbent?challenger:incumbent;
  const resolution=resolutionFor(trace,selected,opponent);
  const reconsider=isCall ? (trace.decisionBasis?.kind==='ELIGIBILITY' ? `I'd reassess if verified availability changes for ${incumbent} or ${challenger}.` : `I'd reassess if ${clean(selected)}'s availability changes, or new verified standing or role evidence strengthens ${opponent}'s case.`) : '';
  const oneSecond = [isCall ? `I'd start ${clean(selected)} over ${selected === trace.incumbent ? challenger : incumbent}.` : sentence(`No independent call: ${pair}`)];
  const threeSeconds = isCall
    ? [supporting.length ? supporting.slice(0,3).map(e=>e.text).join(' ') : clean(trace.rationale), ...(opposing.length ? [`The case against that pick: ${opposing[0].text}`] : [])]
    : [`Needs verification: ${needsSummary.slice(0,2).map(sentence).join(' ')}`];
  const tenSeconds = [
    ...evidence.filter(e=>e.text.length<=160).slice(0,2).map(e=>e.text),
    ...needsSummary.map(text=>`Needs verification: ${sentence(text)}`),
    ...(isCall ? [resolution,reconsider] : []),
    ...confidenceWarnings.slice(0,1).map(text=>`Confidence warning: ${sentence(text)}`),
    `Confidence: ${String(slot.confidence?.label || 'LOW').toLowerCase()}.`,
  ];
  const explanation = [oneSecond[0],...threeSeconds,...(isCall?[resolution]:[]),...(confidenceWarnings.length?confidenceWarnings.map(sentence):[]),`Confidence: ${String(slot.confidence?.label || 'LOW').toLowerCase()}.`,...(isCall?[reconsider]:[])].filter(Boolean).join('\n\n');
  return {version:2,type:'SUPER_SAGE_PRIVATE_SHADOW_PRESENTATION',selected:isCall?selected:null,callStatus:trace.callStatus,oneSecond,threeSeconds,tenSeconds,explanation,resolution,reconsider,supportingEvidence:supporting,opposingEvidence:opposing,reviewNeeds,confidenceWarnings,evidence,authority:{customerVisible:false,productionAuthority:false,decisionImmutable:true,providerCallsAllowed:false,outcomeDataAllowed:false,automaticPromotionAllowed:false}};
}
module.exports = {presentShadowSlot};
