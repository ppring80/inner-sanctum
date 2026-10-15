"use strict";
const assert=require('node:assert/strict');
const {presentGeneralFacts}=require('../netlify/functions/_super-sage-shadow-fast-review');
const {hash}=require('../netlify/functions/_super-sage-shadow-llm');
const provenance={sourceUrl:'https://official.example/player',computedAt:'2026-10-14T00:00:00Z'};
const facts=[
 {field:'backfieldContext',factId:'A:backfieldContext',value:{sourceType:'PROVIDER_ROSTER_UNORDERED',roleOrderVerified:false,teammates:[{name:'Back B',providerRosterStatus:'IR',statusSourceUrl:'https://official.example/ir'}],note:'These players are teammates. Their backfield roles and workload split are not confirmed.'}},
 {field:'observedOpportunity',factId:'A:observedOpportunity',value:{avgLast3:8.67,recentGames:[{carries:10,targets:0}],provenance,interpretation:'internal narrative',observedTrendNote:'internal narrative',sampleContext:[{text:'Reported early exit',sourceUrl:'https://official.example/exit'}]}},
 {field:'observedTargets',factId:'A:observedTargets',value:{avgLast3:7.67,lastGame:6,derivedFrom:'A:observedOpportunity',provenance,interpretation:'Observed only'}},
 {field:'establishedRole',factId:'A:establishedRole',value:{status:'ESTABLISHED',level:'role-player',description:'Established role-player role',reason:'Producer sample size adequate'}},
 {field:'roleExpansion',factId:'A:roleExpansion',value:{claimed:false,validated:false,basis:[],note:'internal narrative'}},
 {field:'availability',factId:'A:availability',value:{status:'QUESTIONABLE',injuryDescription:'Official hamstring report',provenance}},
 {field:'stateChanges',factId:'A:stateChanges',value:[{type:'QB_CHANGE',note:'Named starter ruled out',sourceUrl:'https://official.example/qb'}]}
];
const original={packet:{players:[{id:'A',name:'Back A',facts}]},evidenceHash:'parent'},before=JSON.stringify(original);
const view=presentGeneralFacts(original),get=field=>view.packet.players[0].facts.find(f=>f.field===field).value;
assert.equal(JSON.stringify(original),before);
assert.ok(!JSON.stringify(view).includes('workload split'));
assert.equal(get('backfieldContext').roleOrderVerified,false);
assert.equal(get('backfieldContext').workAllocationVerified,false);
assert.deepEqual(get('backfieldContext').teammates,facts[0].value.teammates);
assert.equal(get('observedOpportunity').avgLast3,8.67);
assert.deepEqual(get('observedOpportunity').provenance,provenance);
assert.deepEqual(get('observedOpportunity').sampleContext,facts[1].value.sampleContext);
assert.equal(get('observedTargets').avgLast3,7.67);
assert.equal(get('observedTargets').derivedFrom,'A:observedOpportunity');
assert.deepEqual(get('availability'),facts[5].value);
assert.deepEqual(get('stateChanges'),facts[6].value);
assert.equal(get('establishedRole').level,'role-player');
assert.equal(view.evidenceHash,hash(JSON.stringify(view.packet)));
console.log('General model fact view: echoed commentary removed; measurements, uncertainty, events, provenance and immutable parent preserved.');
