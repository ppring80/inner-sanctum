'use strict';
// Private translation only: explain an already-decided frozen shadow slot.
// No rankings, player selection, provider access, or production authority.
const sentence = text => /[.!?]$/.test(text) ? text : text + '.';
const clean = value => typeof value === 'string' ? value.trim() : '';
function presentShadowSlot(slot) {
  if (slot?.shadowSource !== 'FROZEN_PRODUCTION_PACKET' || slot.hasValidatedEdge !== false || !slot.shadow) throw new Error('Frozen private shadow slot required.');
  const trace = slot.shadow;
  const selected = typeof trace.selected === 'string' && clean(trace.selected) ? trace.selected : null;
  const incumbent = clean(trace.incumbent), challenger = clean(trace.challenger);
  const isCall = trace.callStatus === 'PROVISIONAL_CALL' && selected !== null;
  if ((trace.callStatus === 'PROVISIONAL_CALL' && !selected) || (selected && (!isCall || ![trace.incumbent, trace.challenger].includes(selected)))) throw new Error('Shadow presentation requires a consistent recorded selection.');
  const evidence = (trace.evidenceUsed || []).filter(e => clean(e.text)).map(e => ({text:e.text,effect:e.effect,group:e.group}));
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
  const oneSecond = [isCall ? `I'd start ${clean(selected)} over ${selected === trace.incumbent ? challenger : incumbent}.` : sentence(`No independent call: ${pair}`)];
  const threeSeconds = isCall
    ? [supporting.length ? supporting.slice(0,2).map(e=>e.text).join(' ') : clean(trace.rationale), ...(opposing.length ? [`The case against that pick: ${opposing[0].text}`] : [])]
    : [`Needs verification: ${needsSummary.slice(0,2).map(sentence).join(' ')}`];
  const tenSeconds = [
    ...evidence.filter(e=>e.text.length<=160).slice(0,2).map(e=>e.text),
    ...needsSummary.map(text=>`Needs verification: ${sentence(text)}`),
    ...(isCall && trace.uncertaintyType === 'CLOSE_CALL' ? ['This is a close call; the recorded evidence did not justify overturning the established choice.'] : []),
    `Confidence: ${String(slot.confidence?.label || 'LOW').toLowerCase()}.`,
  ];
  return {version:1,type:'SUPER_SAGE_PRIVATE_SHADOW_PRESENTATION',selected:isCall?selected:null,callStatus:trace.callStatus,oneSecond,threeSeconds,tenSeconds,supportingEvidence:supporting,opposingEvidence:opposing,reviewNeeds,evidence,authority:{customerVisible:false,productionAuthority:false,decisionImmutable:true,providerCallsAllowed:false,outcomeDataAllowed:false,automaticPromotionAllowed:false}};
}
module.exports = {presentShadowSlot};
