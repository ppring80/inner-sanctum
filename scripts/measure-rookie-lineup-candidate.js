#!/usr/bin/env node
'use strict';
// Local-only inspection. Input is an authorized saved-review response; no network.
const fs=require('node:fs');
const {hash,fullRequest}=require('../netlify/functions/_super-sage-shadow-llm');
const candidate=require('../netlify/functions/_rookie-lineup-candidate');
const file=process.argv[2];
if(!file)throw Error('Usage: node scripts/measure-rookie-lineup-candidate.js saved-review-response.json');
const input=JSON.parse(fs.readFileSync(file,'utf8'));
const saved=input.structuredContent||input;
const frozen=saved.frozenEvidence,review=saved.review;
if(!frozen?.packet||!review?.outgoing)throw Error('Saved frozen input and request fingerprints are required.');
if(hash(JSON.stringify(frozen.packet))!==frozen.evidenceHash||review.evidenceHash!==frozen.evidenceHash)throw Error('Saved evidence integrity mismatch.');
const current=fullRequest(frozen.packet,review.model),view=candidate.buildCandidate(frozen),request=candidate.buildRequest(frozen,review.model);
const checks={systemHash:hash(current.system)===review.outgoing.systemHash,evidenceHash:hash(current.messages[0].content)===review.outgoing.evidenceHash,schemaHash:hash(JSON.stringify(current.tools[0].input_schema))===review.outgoing.schemaHash,maxTokens:current.max_tokens===review.outgoing.maxTokens};
if(!Object.values(checks).every(Boolean))throw Error('Current request does not match saved outgoing fingerprints.');
const bytes=value=>Buffer.byteLength(typeof value==='string'?value:JSON.stringify(value),'utf8');
const originalBytes=bytes(current),candidateBytes=bytes(request);
const original=frozen.packet,expanded=candidate.expandEvidence(view);
const roundTrip=hash(JSON.stringify(expanded))===frozen.evidenceHash;
if(!roundTrip)throw Error('Candidate lost or changed frozen evidence.');
const result={decisionId:saved.decisionId,parentEvidenceHash:frozen.evidenceHash,savedRequestId:review.requestId,savedRequestComponentChecks:checks,
  originalRequestBytes:originalBytes,candidateRequestBytes:candidateBytes,requestByteReductionPct:Math.round((1-candidateBytes/originalBytes)*10000)/100,
  originalEvidenceBytes:bytes(original),dictionaryEvidenceBytes:bytes({evidence:view.evidence,metadata:view.metadata,literalPaths:view.literalPaths}),dictionaryEntries:Object.keys(view.metadata).length,
  candidateMeasurementBytes:bytes(view.measurements),playerCount:original.players.length,slotCount:original.slots.length,factCount:original.players.reduce((n,p)=>n+p.facts.length,0),
  requiredAlertCount:view.requiredAlerts.length,originalEvidenceRoundTripExact:roundTrip,originalMaxOutputTokens:current.max_tokens,candidateMaxOutputTokens:request.max_tokens,
  savedInputTokens:review.usage?.input_tokens,savedOutputTokens:review.usage?.output_tokens,candidateTokenCount:null,candidateLiveLatency:null,
  note:'Bytes are local measurements, not token counts or latency predictions. No model generated the candidate. Whole frozen packet, including every fact, source, date and uncertainty, round-trips exactly.'};
// Replay the literal known failures, without changing the saved model answer.
if(Array.isArray(review.answer?.slots)) {
  const alerts=candidate.requiredAlerts(original).map(a=>a.factId),lineup=review.answer.slots.map(c=>({slotId:c.slotId,playerId:c.playerId,confidence:c.confidence,blocker:''}));
  const byName=name=>original.players.find(p=>p.name===name);
  const target=byName('Malik Nabers'),mclaurin=byName('Terry McLaurin'),allen=byName('Keenan Allen');
  const checks=[];
  for(const [player,alternative,error]of [[target,byName('Tyler Higbee'),'observed_opportunity_unit_changed'],[mclaurin,allen,'matchup_equality_reversed']]) {
    const call=review.answer.slots.find(c=>c.playerId===player?.playerId);
    if(!call||!alternative)continue;
    const decision={slotId:call.slotId,alternativeId:alternative.playerId,reason:call.explanation,caveat:call.countercase,reconsider:call.reconsider.join('; '),factIds:call.factIds,comparisons:[]};
    const errors=candidate.validateCandidate({lineup,decisions:[decision],alerts,contingencies:[]},original);
    const verifiedComponents=candidate.measurements(player).recentUsage?.components;
    const claimedTargets=call.explanation.match(/\b(\d+(?:\.\d+)?)\s+targets per game\b/i)?.[1];
    const precision=Math.min(6,claimedTargets?.split('.')[1]?.length||0);
    const resolved=error==='observed_opportunity_unit_changed'&&!errors.includes(error)&&verifiedComponents?.carries===0&&claimedTargets!==undefined&&Number(verifiedComponents.targets.toFixed(precision))===Number(claimedTargets);
    checks.push({case:error,caught:errors.includes(error),...(resolved?{resolvedByVerifiedZeroCarryComponents:true}:{})});
  }
  const barkley=byName('Saquon Barkley'),corum=byName('Blake Corum'),bernard=byName('Germie Bernard');
  const rbSlot=lineup.find(c=>c.playerId===barkley?.playerId)?.slotId,flexSlot=lineup.find(c=>c.playerId===corum?.playerId)?.slotId;
  if(rbSlot&&flexSlot&&bernard&&!lineup.some(c=>c.playerId===bernard.playerId)) {
    const naive=lineup.map(c=>c.slotId===rbSlot?{...c,playerId:corum.playerId}:c);
    const complete=lineup.map(c=>c.slotId===rbSlot?{...c,playerId:corum.playerId}:c.slotId===flexSlot?{...c,playerId:bernard.playerId}:c);
    checks.push({case:'saved_replacement_already_starting',caught:candidate.validateLineup(naive,original,[barkley.playerId]).includes('invalid_ineligible_or_duplicate_player')});
    checks.push({case:'hypothetical_complete_two_slot_swap',legal:candidate.validateLineup(complete,original,[barkley.playerId]).length===0});
  }
  result.offlineFailureReplay=checks;
  result.replayNote='These are mechanical test adaptations of saved text and hypothetical substitution checks, not a new model answer or lineup recommendation.';
  if(checks.some(c=>(c.caught===false&&!c.resolvedByVerifiedZeroCarryComponents)||c.legal===false))throw Error('Offline failure replay did not pass.');
}
process.stdout.write(JSON.stringify(result,null,2)+'\n');
