'use strict';
const assert=require('node:assert/strict');
const candidate=require('../netlify/functions/_rookie-lineup-candidate');
const {hash,buildEvidence,fullRequest}=require('../netlify/functions/_super-sage-shadow-llm');
const clone=v=>JSON.parse(JSON.stringify(v));
const source={name:'Test source',url:'https://official.example/report',asOf:'2026-10-14T22:00:00Z',detail:'verified source record '.repeat(80)};
function player(playerId,name,position,points,avg,matchup,status='ACTIVE') {
 const values={projection:{points,source},observedOpportunity:{avgLast3:avg,provenance:source},standing:{positionRank:17,tier:'FLEX',source},matchup,availability:{status,unavailable:status==='IR',questionable:status==='QUESTIONABLE',source},stateChanges:[],uncertainty:[]};
 return {playerId,name,position,facts:Object.entries(values).map(([field,value])=>({factId:`${playerId}:${field}`,field,value}))};
}
const packet={request:{season:2026,week:6,scoring:'half'},players:[
 player('P1','Saquon Barkley','RB',8.79,8.67,'Strong Positive','QUESTIONABLE'),
 player('P2','Blake Corum','RB',6.84,8.67,'Positive'),
 player('P3','Germie Bernard','WR',8.12,4.33,'Neutral'),
 player('P4','Tyler Higbee','TE',5.43,7.67,'Strong Positive'),
 player('P5','Kendre Miller','RB',6.9,8.67,'Positive'),
 player('P6','Malik Nabers','WR',11.57,11,'Neutral'),
 player('P7','Travis Etienne','RB',null,0,'Neutral','IR')
],slots:[{slotId:'S1',slotLabel:'RB',eligiblePositions:['RB'],candidateIds:['P1','P2','P5','P7']},{slotId:'S2',slotLabel:'FLEX',eligiblePositions:['RB','WR','TE'],candidateIds:['P1','P2','P3','P4','P5','P6','P7']}]};
packet.players[0].facts.find(f=>f.field==='stateChanges').value=[{type:'INJURY',description:'Questionable hamstring',source}];
const frozen={packet,evidenceHash:hash(JSON.stringify(packet))},before=JSON.stringify(frozen),view=candidate.buildCandidate(frozen);
assert.equal(JSON.stringify(frozen),before);
assert.equal(hash(JSON.stringify(candidate.expandEvidence(view))),frozen.evidenceHash);
assert.ok(Object.keys(view.metadata).length>0);
assert.ok(JSON.stringify(view).length<JSON.stringify(frozen).length,'repeated large metadata shrinks even with labeled measurements');
assert.deepEqual(candidate.expandEvidence(view),packet);
const corrupt=clone(view);delete corrupt.metadata.M1;assert.throws(()=>candidate.expandEvidence(corrupt),/invalid_metadata_reference/);
const collision={players:[],custom:{metadataRef:'M1'},unrelated:source};assert.deepEqual(candidate.expandEvidence(candidate.compactEvidence(collision)),collision);
const unusual=JSON.parse('{"__proto__":{"provenance":'+JSON.stringify(source)+'},"a":{"provenance":'+JSON.stringify(source)+'}}');
assert.deepEqual(candidate.expandEvidence(candidate.compactEvidence(unusual)),unusual);assert.equal({}.metadataRef,undefined);
assert.throws(()=>candidate.buildCandidate({...frozen,evidenceHash:'bad'}),/integrity/);
const usage=view.measurements.find(p=>p.playerId==='P6').recentUsage;assert.equal(usage.unit,'carries_plus_targets');assert.equal(usage.components,undefined);
const components=clone(packet.players[3]);components.facts.find(f=>f.field==='observedOpportunity').value={avgLast3:7.67,recentGames:[11,6,6].map(targets=>({carries:0,targets,opportunities:targets}))};
assert.equal(candidate.measurements(components).recentUsage.components.carries,0);
assert.equal(candidate.measurements(components).recentUsage.components.targets,23/3);
components.facts.find(f=>f.field==='observedOpportunity').value.recentGames[0].opportunities=12;assert.equal(candidate.measurements(components).recentUsage.components,undefined);
assert.equal(view.measurements[0].standing.rankScope,'RB');
const alerts=candidate.requiredAlerts(packet).map(a=>a.factId);
assert.ok(alerts.includes('P1:availability'));assert.ok(alerts.includes('P1:stateChanges'));assert.ok(alerts.includes('P7:availability'));
const answer={lineup:[{slotId:'S1',playerId:'P1',confidence:'LOW',blocker:''},{slotId:'S2',playerId:'P2',confidence:'MEDIUM',blocker:''}],decisions:[{slotId:'S2',alternativeId:'P5',reason:'I lean Corum despite Miller\'s small projection lead.',caveat:'His role is unclear.',reconsider:'New role information before kickoff.',factIds:['P2:projection','P5:projection'],comparisons:[{leftId:'P2',rightId:'P5',metric:'projection',advantagedId:'P5'}]}],alerts,contingencies:[{outPlayerId:'P1',changes:[{slotId:'S1',playerId:'P2'},{slotId:'S2',playerId:'P3'}]}]};
assert.deepEqual(candidate.validateCandidate(answer,packet),[],'independent choice may oppose projection advantage; full swap remains legal');
const badSwap=clone(answer);badSwap.contingencies[0].changes.pop();assert.ok(candidate.validateCandidate(badSwap,packet).includes('contingency_invalid_ineligible_or_duplicate_player'),'actual observed contingency failure rejected');
const remains=clone(answer);remains.contingencies[0].changes=[{slotId:'S2',playerId:'P3'}];assert.ok(candidate.validateCandidate(remains,packet).includes('contingency_unavailable_player_selected'));
const wrongPosition=clone(answer);wrongPosition.contingencies[0].changes=[{slotId:'S1',playerId:'P3'}];assert.ok(candidate.validateCandidate(wrongPosition,packet).includes('contingency_invalid_ineligible_or_duplicate_player'));
const duplicateScenario=clone(answer);duplicateScenario.contingencies.push(clone(duplicateScenario.contingencies[0]));assert.ok(candidate.validateCandidate(duplicateScenario,packet).includes('invalid_contingency'));
const ir=clone(answer);ir.contingencies[0].changes=[{slotId:'S1',playerId:'P7'}];assert.ok(candidate.validateCandidate(ir,packet).includes('contingency_unavailable_player_selected'));
const omitted=clone(answer);omitted.alerts=[];assert.ok(candidate.validateCandidate(omitted,packet).includes('material_alert_omitted'));
const reversed=clone(answer);reversed.decisions[0].comparisons[0].advantagedId='P2';assert.ok(candidate.validateCandidate(reversed,packet).includes('comparison_reversed'));
const reversedProse=clone(answer);reversedProse.decisions[0].reason="Corum's projection lead decides it.";assert.ok(candidate.validateCandidate(reversedProse,packet).includes('projection_comparison_reversed'));
const equalMatchup=clone(answer);equalMatchup.decisions[0].alternativeId='P4';equalMatchup.decisions[0].reason='Higbee faces the same Neutral matchup.';equalMatchup.decisions[0].factIds=['P2:matchup','P4:matchup'];equalMatchup.decisions[0].comparisons=[];assert.ok(candidate.validateCandidate(equalMatchup,packet).includes('matchup_equality_reversed'));
const targetSource=clone(packet);targetSource.players[3]=components;targetSource.players[3].facts.find(f=>f.field==='observedOpportunity').value.recentGames[0].opportunities=11;
const derivedTargets=clone(answer);derivedTargets.decisions[0].alternativeId='P4';derivedTargets.decisions[0].reason='Higbee averaged 7.7 targets per game over his last three observed games.';derivedTargets.decisions[0].factIds=['P2:projection','P4:observedOpportunity'];derivedTargets.decisions[0].comparisons=[];assert.deepEqual(candidate.validateCandidate(derivedTargets,targetSource),[],'verified component unit can be cited through its original source fact');
const cross=clone(answer);cross.decisions[0].alternativeId='P4';cross.decisions[0].comparisons=[{leftId:'P2',rightId:'P4',metric:'positionRank',advantagedId:'P4'}];cross.decisions[0].factIds=['P2:standing','P4:standing'];assert.ok(candidate.validateCandidate(cross,packet).includes('cross_position_rank_comparison'));
const targets=clone(answer);targets.decisions[0].alternativeId='P6';targets.decisions[0].reason='Nabers averages about 11 targets per game recently.';targets.decisions[0].comparisons=[];targets.decisions[0].factIds=['P6:observedOpportunity','P2:observedOpportunity'];assert.ok(candidate.validateCandidate(targets,packet).includes('observed_opportunity_unit_changed'));
const ids=clone(answer);ids.lineup[1].playerId='P1';assert.ok(candidate.validateCandidate(ids,packet).includes('invalid_ineligible_or_duplicate_player'));
const missing=clone(answer);missing.decisions=[];assert.ok(candidate.validateCandidate(missing,packet).includes('contested_lineup_without_explanation'));
const unknown=clone(answer);unknown.decisions[0].factIds=['invented'];assert.ok(candidate.validateCandidate(unknown,packet).includes('invalid_decision_evidence'));
const tied=clone(packet);tied.players[4].facts[0].value.points=6.84;assert.ok(candidate.validateCandidate(answer,tied).includes('comparison_reversed'));
const validTie=clone(answer);validTie.decisions[0].reason='I lean Corum with equal projections.';validTie.decisions[0].comparisons[0].advantagedId=null;assert.deepEqual(candidate.validateCandidate(validTie,tied),[]);
for(const malformed of [null,{}, {lineup:null}, {...answer,lineup:[null]}, {...answer,contingencies:[null]}, {...answer,decisions:[null]}])assert.ok(candidate.validateCandidate(malformed,packet).length);
// Historical sanitized fixture, not the unrecovered live 19,085-token request.
const fixture=clone(require('./fixtures/super-sage-live-shadow-week5.json'));
for(const slot of fixture.slots)slot.eligiblePositions=slot.slotLabel==='RB-WR-TE'?['RB','WR','TE']:[slot.slotLabel==='DST'?'DEF':slot.slotLabel];
const historical=buildEvidence(fixture),historicalView=candidate.buildCandidate(historical);
assert.equal(hash(JSON.stringify(candidate.expandEvidence(historicalView))),historical.evidenceHash);
const currentBytes=Buffer.byteLength(JSON.stringify(fullRequest(historical.packet,'claude-sonnet-4-6')));
const request=candidate.buildRequest(historical);assert.equal(request.tools[0].strict,true);assert.equal(request.tool_choice.name,'submit_candidate');
const candidateBytes=Buffer.byteLength(JSON.stringify(request));
console.log(JSON.stringify({fixture:'sanitized historical Week 5; not live evidence',currentRequestBytes:currentBytes,candidatePayloadBytes:candidateBytes,metadataEntries:Object.keys(historicalView.metadata).length,losslessRoundTrip:true}));
console.log('Offline candidate: independent choice, lossless metadata, explicit units/rank scope, arithmetic identity, alerts and complete legal contingency swaps. No provider, store, budget or deployed integration.');
