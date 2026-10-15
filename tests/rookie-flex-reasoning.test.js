"use strict";
const assert = require('node:assert/strict');
const {GROUNDED_SYSTEM,presentComponentUsage,focusEvidence} = require('../netlify/functions/_super-sage-shadow-fast-review');
const {hash} = require('../netlify/functions/_super-sage-shadow-llm');
const {validateClaims} = require('../netlify/functions/_super-sage-rookie-claim-checks');
const games=[{week:3,gameID:'g3',carries:0,targets:11,opportunities:11},{week:4,gameID:'g4',carries:0,targets:6,opportunities:6},{week:5,gameID:'g5',carries:0,targets:6,opportunities:6}];
const packet={players:[{playerId:'p1',name:'Receiver A',position:'TE',facts:[{field:'observedOpportunity',value:{avgLast3:7.67,recentGames:games}}]},{playerId:'p2',name:'Back B',position:'RB',facts:[]}],slots:[]};
const frozen={packet,evidenceHash:hash(JSON.stringify(packet))},before=JSON.stringify(frozen);
const focused=focusEvidence(frozen,['Receiver A','Back B'],{slotId:'S1',slotLabel:'FLEX',eligiblePositions:['TE','RB'],candidateIds:['p1','p2']});
presentComponentUsage(focused);
const facts=focused.packet.players[0].facts;
assert.equal(facts.find(f=>f.field==='observedTargets').value.avgLast3,7.67);
assert.equal(facts.find(f=>f.field==='observedCarries').value.avgLast3,0);
assert.equal(facts.find(f=>f.field==='observedTargets').value.derivedFrom,'A:observedOpportunity');
assert.equal(JSON.stringify(frozen),before);
const rushingTE={packet:{players:[{id:'A',facts:[{field:'observedOpportunity',factId:'A:observedOpportunity',value:{avgLast3:8,recentGames:games.map((g,i)=>i?g:{...g,carries:1,opportunities:12})}}]}]}};
presentComponentUsage(rushingTE);
assert.equal(rushingTE.packet.players[0].facts.find(f=>f.field==='observedCarries').value.lastGame,0);
assert.equal(rushingTE.packet.players[0].facts.find(f=>f.field==='observedCarries').value.avgLast3,0.33,'a TE with observed carries keeps them');
assert.deepEqual(validateClaims({explanation:'Receiver A averaged 7.7 targets per game over his last three games.'},focused.packet),[]);
for(const value of [{avgLast3:7.67},{avgLast3:7.67,recentGames:games.slice(1)},{avgLast3:8,recentGames:games},{avgLast3:7.67,recentGames:games.map(g=>({...g,targets:undefined}))}]) {
 const f={packet:{players:[{id:'A',facts:[{field:'observedOpportunity',factId:'A:observedOpportunity',value}]}]}};
 presentComponentUsage(f);assert.equal(f.packet.players[0].facts.length,1,'incomplete or inconsistent components stay unknown');
}
assert.ok(Buffer.byteLength(GROUNDED_SYSTEM)<4000,'one concise instruction set');
for(const phrase of ['workload split','backfield role order','observed baseline','roughly 20-25']) assert.ok(!GROUNDED_SYSTEM.includes(phrase));
assert.ok(GROUNDED_SYSTEM.includes('both players'));
console.log('FLEX reasoning: complete observed components, frozen parent preserved, no invented breakdown or forecast, one concise independent prompt.');
