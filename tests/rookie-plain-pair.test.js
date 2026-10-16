'use strict';
const assert=require('node:assert/strict');
const {run}=require('../scripts/run-super-sage-week4-acceptance');
const {hash,buildEvidence}=require('../netlify/functions/_super-sage-shadow-llm');
const fast=require('../netlify/functions/_super-sage-shadow-fast-review');
const {pairComparisons}=require('../netlify/functions/_super-sage-pair-comparisons');
const {matchupRank,expansionConfirmed,plainPresentation}=require('../netlify/functions/_rookie-plain-presentation');
const {validatePairVoice}=require('../netlify/functions/_super-sage-shadow-voice');
const {validateReconsider}=require('../netlify/functions/_rookie-reconsider');
const clone=x=>JSON.parse(JSON.stringify(x));
(async()=>{
 const record=run().record,frozen=buildEvidence(record),original=JSON.stringify(frozen);
 const slots=record.slots.map((slot,i)=>({slot,i})).filter(({slot})=>slot.decisionState==='PROVISIONAL_UNRESOLVED');
 assert.deepEqual(slots.map(({slot})=>[slot.starter.name,slot.comparator.name]),[['Blake Corum','Courtland Sutton'],['Emmett Johnson','Courtland Sutton']]);
 let sample;
 for(const {slot,i}of slots){
  const selection={players:[slot.starter.name,slot.comparator.name],slotId:`S${i+1}`};
  const raw=fast.focusEvidence(frozen,selection.players,frozen.packet.slots[i]);
  const plain=await fast.prepareSelectedPair(frozen,selection);
  sample=plain.packet;
  assert.equal(plain.packet.presentation,'plain-v1');
  assert.doesNotMatch(JSON.stringify(plain),/Strong Positive|Strong Negative|moderate-volume|high-volume|role-player|"validated"|"claimed"|"level"/);
  assert.deepEqual(pairComparisons(plain.packet),pairComparisons(raw.packet));
  assert.deepEqual(fast.requiredDisclosures(plain.packet.players),fast.requiredDisclosures(raw.packet.players));
  for(const p of raw.packet.players){const next=plain.packet.players.find(x=>x.id===p.id);for(const f of p.facts)assert.ok(next.facts.some(g=>g.factId===f.factId));}
  assert.equal(JSON.stringify(frozen),original);assert.equal(hash(JSON.stringify(frozen.packet)),frozen.evidenceHash);
 }
 const labels=['Strong Negative','Negative','Neutral','Positive','Strong Positive'];
 for(const a of labels)for(const b of labels){
  const raw={players:['A','B'].map((id,i)=>({id,name:id,position:'WR',facts:[{factId:`${id}:matchup`,field:'matchup',value:[a,b][i]}]}))};
  const view=plainPresentation({packet:raw});assert.deepEqual(pairComparisons(view.packet),pairComparisons(raw));
  assert.equal(matchupRank(a),matchupRank(view.packet.players[0].facts[0].value));
 }
 for(const confirmed of [true,false])assert.equal(expansionConfirmed({validated:confirmed}),expansionConfirmed({workloadChangeConfirmed:confirmed}));
 assert.ok(validatePairVoice({explanation:'A strong positive matchup.'}).includes('report_like_customer_language'));
 assert.deepEqual(validatePairVoice({explanation:'A very favorable matchup.'}),[]);
 const packet=clone(sample);delete packet.answerContract;const pick=packet.players[1],alt=packet.players[0];
 const condition=text=>validateReconsider({selected:pick.id,reconsider:text},packet);
 assert.deepEqual(condition(`If ${pick.name} is ruled out or ${alt.name} earns more targets.`),[]);
 for(const text of ['New information before kickoff.',`If ${pick.name} earns more targets.`, `If ${alt.name} is ruled out.`, `If ${pick.name} develops a concussion.`, `If ${pick.name} is not ruled out.`, `If ${alt.name} doesn't earn more targets.`, `If ${pick.name}'s opponent allows fewer points to receivers.`, `If ${pick.name} is ruled out and ${pick.name} earns more targets.`])assert.deepEqual(condition(text),['reconsider_not_reversal'],text);
 const uncertain=clone(packet);uncertain.players[0].facts.find(f=>f.field==='availability').value.questionable=true;
 assert.deepEqual(validateReconsider({selected:pick.id,reconsider:`If ${alt.name} is confirmed active.`},uncertain),[]);
 const answer=fast.formatGroundedAnswer({selected:pick.id,confidence:'LOW',caveat:'The evidence remains close.',reconsider:`If ${alt.name} earns more targets.`,explanationSentences:[{text:`I lean ${pick.name}, despite a strong positive matchup label.`,factIds:[`${pick.id}:standing`]},{text:`${alt.name} remains the alternative.`,factIds:[`${alt.id}:standing`]}]});
 const soft=fast.assessPairAnswer(answer,packet);assert.deepEqual(soft.hard,[]);assert.deepEqual(soft.soft,['report_like_customer_language']);
 const long=clone(answer);long.explanation=('This remains a close decision. '.repeat(40)).trim()+'\n'+`${alt.name} remains the alternative.`;long.statusSentence={text:'Status remains as supplied.',factIds:[`${pick.id}:availability`]};
 assert.ok(fast.assessPairAnswer(long,{...packet,requireCandidateStatusSentence:true}).soft.includes('role_explanation_too_long'));
 const unhealthy=clone(answer);unhealthy.explanation=`${pick.name} is healthy.`;assert.ok(fast.assessPairAnswer(unhealthy,packet).hard.includes('availability_overstated_as_health'));
 const wrong=clone(answer);wrong.selected='invented';assert.ok(fast.assessPairAnswer(wrong,packet).hard.includes('invalid_selection'));
 const reversalPacket=clone(packet);reversalPacket.players[0].facts.find(f=>f.field==='projection').value.points=5;reversalPacket.players[1].facts.find(f=>f.field==='projection').value.points=10;
 const reversed=clone(answer);reversed.explanation=`${alt.name} has the higher projection.`;reversed.sentenceFactIds=[['A:projection','B:projection']];reversed.factIds=['A:projection','B:projection'];
 assert.ok(fast.assessPairAnswer(reversed,reversalPacket).hard.includes('projection_comparison_reversed'));
 const {SYSTEM,ROLE_SYSTEM,GROUNDED_SYSTEM,GROUNDED_SCHEMA}=fast;
 assert.equal(hash(SYSTEM),'afbbea9b289d6185941535d048c50c5575aa0af12810316c2dc998d7175d47e4');
 assert.equal(hash(ROLE_SYSTEM),'bd0861a60278b40c3dd9d9f04f59f3e012dc523e2565c3913e90a6c9b03705ea');
 assert.equal(hash(GROUNDED_SYSTEM),'27011204be8061be090238db5ae04183ba14a1370be4ada3b6a8882416c10780');
 assert.equal(hash(JSON.stringify(GROUNDED_SCHEMA)),'343d568dbe8688aaa54d99526098ffe5f82fa863a1394f04c31455491a925a79');
 console.log('PASS: both real Week 4 unresolved pairs; lossless parent, plain vocabulary, all matchup orderings/ties, disclosures, direction-sensitive reconsider, hard/soft assessment, pinned prompts/schema. No provider.');
})().catch(e=>{console.error(e);process.exitCode=1;});
