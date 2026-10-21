'use strict';
// Explicit named-pair requests only. Reuses the qualified schema and existing
// atomic selected-pair cache/budget. Never assigns or changes a lineup.
const {hash,buildEvidence}=require('./_super-sage-shadow-llm');
const {recordKey}=require('./_rookie-second-opinion-live');
const {prepareSelectedPair,runFastReview}=require('./_super-sage-shadow-fast-review');
const structured=require('./_rookie-structured-pair');
const currentKey=owner=>`rookie-current-decision/${owner}`;
const key=name=>String(name||'').trim().toLowerCase().replace(/\s+/g,' ');
function offer(record){
 const pairs=[];
 for(const slot of record?.slots||[]){
  if(!slot.starter||!slot.comparator||key(slot.starter.name)===key(slot.comparator.name))continue;
  if(!pairs.some(p=>p.every(n=>[slot.starter.name,slot.comparator.name].includes(n))))pairs.push([slot.starter.name,slot.comparator.name]);
 }
 if(!pairs.length)return null;
 return {status:'CHOOSE_PAIR',label:'Want a second opinion?',examplePlayers:pairs[0],text:`Want another take? Ask “Rookie, ${pairs[0][0]} or ${pairs[0][1]}?” Rookie compares two players using Anthropic’s AI service, with your permission. Its opinion does not change your lineup.`};
}
async function requestPair({store,decisionId,ownerHash,players,consentToAnthropic,apiKey,fetchImpl,loadUsageSnapshot,now}){
 const fail=(reason,message)=>({status:'UNAVAILABLE',reason,message,lineupChanged:false});
 if(!/^[a-f0-9]{64}$/.test(decisionId||'')||!/^[a-f0-9]{64}$/.test(ownerHash||'')||!Array.isArray(players)||players.length!==2||players.some(p=>typeof p!=='string'||!p.trim()||p.length>120)||key(players[0])===key(players[1]))return fail('invalid_pair_request','Name two different players from your linked roster.');
 if(consentToAnthropic!==true)return fail('provider_consent_required','May Rookie send these two players’ football evidence—names, projections, recent usage, matchup, role and availability—to Anthropic for this second opinion? Your lineup will not change.');
 try{
  const [saved,evidence,current]=await Promise.all([store.get(recordKey(decisionId,ownerHash),{type:'json'}),store.get(`evidence/${decisionId}/${ownerHash}`,{type:'json'}),store.get(currentKey(ownerHash),{type:'json'})]);
  if(saved?.ownerHash!==ownerHash||evidence?.ownerHash!==ownerHash||!saved.record||!evidence.frozenEvidence)return fail('owned_input_unavailable','Ask SAGE for your linked lineup first, then name the two players you want Rookie to compare.');
  const record=saved.record,frozen=evidence.frozenEvidence;
  if(current?.inputSource!=='linked_league'||current?.decisionId!==decisionId||current.recordHash!==saved.recordHash)return fail('decision_not_current','Get your SAGE lineup again so Rookie uses the latest decision, then ask for the pair.');
  if(record.decisionId!==decisionId||hash(JSON.stringify(record))!==saved.recordHash||hash(JSON.stringify(frozen.packet))!==frozen.evidenceHash||buildEvidence(record).evidenceHash!==frozen.evidenceHash)return fail('evidence_integrity_failure','Rookie could not verify the saved evidence. SAGE’s lineup is unchanged.');
  const matches=players.map(name=>frozen.packet.players.filter(p=>key(p.name)===key(name)));
  if(matches.some(p=>p.length!==1))return fail('pair_not_in_roster','Both names must match players in this saved linked lineup.');
  const candidates=matches.map(p=>p[0]);
  const legal=frozen.packet.slots.filter(s=>candidates.every(p=>s.candidateIds.includes(p.playerId)));
  if(!legal.length)return fail('pair_not_slot_eligible','Those players cannot fill the same lineup slot in your league.');
  const paired=legal.find(s=>{const slot=record.slots[Number(s.slotId.slice(1))-1];return slot?.starter&&slot?.comparator&&[slot.starter.name,slot.comparator.name].every(n=>candidates.some(p=>p.name===n));});
  const selection={players:candidates.map(p=>p.name),slotId:(paired||legal[0]).slotId};
  // No unresolved-state restriction here: explicit customer judgment is allowed
  // even when SAGE already decided. Evidence and player legality still apply.
  const focused=await prepareSelectedPair(frozen,selection,{capturedAt:evidence.capturedAt,loadUsageSnapshot});
  const review=await runFastReview({store,decisionId,ownerHash,selection,apiKey,fetchImpl,loadUsageSnapshot,now});
  if(review.status!=='REVIEW_READY')return fail(review.error||'invalid_review',review.error==='daily_speed_benchmark_limit'?'Rookie’s current review limit has been reached. SAGE’s lineup is unchanged.':'Rookie could not return a validated opinion. SAGE’s lineup is unchanged.');
  // A saved v1 review is judged against the v1 packet rebuilt here from the same
  // frozen evidence and matched by hash; it is never re-scored under v2 rules.
  const contractFocused=review.legacyContract===structured.CONTRACT_V1?await prepareSelectedPair(frozen,selection,{capturedAt:evidence.capturedAt,loadUsageSnapshot,contract:'v1'}):focused;
  if(review.parentEvidenceHash!==frozen.evidenceHash||review.evidenceHash!==contractFocused.evidenceHash||structured.validate(review.answer,contractFocused.packet).length)return fail('invalid_review','Rookie could not return a validated opinion. SAGE’s lineup is unchanged.');
  const answer=structured.render(review.answer,contractFocused.packet),lean=contractFocused.packet.players.find(p=>p.id===answer.selected)?.name||null;
  return {status:'READY',decisionId,lineupChanged:false,context:{...frozen.packet.request,evidenceCapturedAt:evidence.capturedAt||null},opinion:{label:lean?`Rookie leans ${lean}`:'Rookie has no call',players:selection.players,slotId:selection.slotId,lean,confidence:answer.confidence,explanation:answer.explanation,reconsider:answer.reconsider,detail:'Separate second opinion. Confidence is Rookie’s assessment, not a guarantee. Your lineup is unchanged.'},timing:{cached:review.cached===true,providerMs:review.cached?0:review.providerMs,currentReviewMs:review.requestTiming?.totalMs??null}};
 }catch{return fail('review_unavailable','Rookie could not complete this review. SAGE’s lineup is unchanged.');}
}
module.exports={currentKey,offer,requestPair};
