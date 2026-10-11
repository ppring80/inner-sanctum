'use strict';
const assert = require('assert');
const {usageContext} = require('../netlify/functions/_super-sage-usage-context');
const {fromSnapshot,observedEvidenceFor} = require('../netlify/functions/_super-sage-opportunity-evidence');
const {buildEvidencePacket} = require('../netlify/functions/_super-sage-lineup-decision');
const {buildEvidence} = require('../netlify/functions/_super-sage-shadow-llm');
const {focusEvidence} = require('../netlify/functions/_super-sage-shadow-fast-review');
const games = [
  {week:1,gameID:'20260913_DAL@NYG',carries:0,targets:9,opportunities:9},
  {week:2,gameID:'20260921_NYG@LAR',carries:0,targets:4,opportunities:4},
  {week:3,gameID:'20260927_TEN@NYG',carries:0,targets:6,opportunities:6},
  {week:4,gameID:'20261004_ARI@NYG',carries:0,targets:7,opportunities:7}
];
const args={name:'Malik Nabers',team:'NYG',position:'WR',season:2026,week:5,games,cutoff:'2026-10-07T00:10:52Z'};
assert.equal(usageContext(args).length,3);
for(const change of [{team:'MIA'},{season:2027},{games:games.slice(3)},{cutoff:'2026-09-20T00:00:00Z'},{cutoff:'invalid'}]) assert.deepEqual(usageContext({...args,...change}),[]);
assert.equal(usageContext({...args,name:'Other Receiver'}).length,2); // injury stays player-bound
assert.equal(usageContext({...args,week:3}).length,2); // no Week 3 weather knowledge
const record={_rawGames:games,opportunities:{lastGame:7,avgLast3:5.67},persistence:{gamesSampled:4},signals:[{type:'sampleSize',value:'adequate'},{type:'volumeTier',value:'moderate-volume'}]};
const snapshot={season:2026,computedAt:args.cutoff,records:{'malik nabers|WR':record}};
const original=JSON.stringify(snapshot);
const opportunity=fromSnapshot(snapshot,{season:2026,week:5});
const evidence=observedEvidenceFor(opportunity,args);
assert.deepEqual(evidence.observedOpportunity.recentGames.map(g=>g.targets),[4,6,7]);
assert.equal(evidence.observedOpportunity.avgLast3,5.67);
assert.equal(evidence.observedOpportunity.sampleRepresentativeness,'REASSESS');
assert.equal(evidence.roleExpansion.claimed,false);
assert.equal(JSON.stringify(snapshot),original);
const packet=buildEvidencePacket({name:args.name,position:'WR',team:'NYG',row:{name:args.name,team:'NYG',position:'WR'}},{season:2026,week:5,opportunity,registry:{}});
assert.equal(packet.observedOpportunity.sampleContext.length,3);
const other={...packet,name:'Malik Washington',team:'MIA',observedOpportunity:{avgLast3:8.33}};
const frozen=buildEvidence({decisionId:'a'.repeat(64),request:{season:2026,week:5},slots:[{slotLabel:'WR',eligiblePositions:['WR'],candidates:[packet,other]}]});
const before=JSON.stringify(frozen);
const focused=focusEvidence(frozen,['Malik Washington','Malik Nabers']);
assert.equal(focused.packet.players.find(p=>p.name===args.name).facts.find(f=>f.field==='observedOpportunity').value.sampleContext.length,3);
assert.equal(JSON.stringify(frozen),before);
const leak=fromSnapshot({...snapshot,records:{'malik nabers|WR':{...record,_rawGames:[...games,{week:5,gameID:'20261011_NYG@WSH'}]}}},{season:2026,week:5});
assert.equal(leak.status,'REJECTED');
assert.equal(observedEvidenceFor(leak,args).observedOpportunity,null);
console.log('rookie-usage-context: temporal, identity, immutable packet propagation and no forecast adjustment passed');
