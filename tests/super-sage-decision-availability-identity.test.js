'use strict';
const assert=require('node:assert/strict');
const {buildLineupDecisionRecord}=require('../netlify/functions/_super-sage-lineup-decision');
const base={source:'cached Tank01 team rosters',available:true,updatedAt:'2026-10-23T00:00:22.703Z',fresh:true,freshnessThresholdHours:8,ageHours:4.03,playerCount:2000,exclusionsApplied:7,note:'Current cached injury data enforced.'};
function record(patch={}){
 return buildLineupDecisionRecord({season:2026,week:7,scoring:'half',slots:[{slotLabel:'QB',eligiblePositions:['QB'],count:1}],roster:[{name:'Fixture Quarterback',position:'QB'}],rankings:{metadata:{availability:{...base,...patch}},positions:{QB:[{name:'Fixture Quarterback',position:'QB',team:'BUF',rank:4,recommendation:'START',projectedPoints:20,availabilityVerified:true,projection:{source:'Tank01',fresh:true,points:20,scoring:'half',week:7,updatedAt:'2026-10-23T00:40:22.944Z'}}]}}});
}
const a=record(),b=record({ageHours:4.04,playerCount:2001,exclusionsApplied:8,note:'Diagnostic wording changed.',checkedAt:'2026-10-23T04:02:00Z'});
assert.equal(a.decisionId,b.decisionId,'Elapsed age and telemetry cannot mint a new decision for unchanged evidence');
assert.deepEqual(a,b,'No customer decision, confidence, explanation or frozen player evidence changes');
for(const patch of [
 {fresh:false}, {available:false}, {updatedAt:'2026-10-23T04:00:22.703Z'},
 {source:'Different verified source'}, {availabilityMode:'new-source-contract'},
 {freshnessThresholdHours:6}, {transactionsCheckedAt:'2026-10-23T04:00:00Z'}
])assert.notEqual(a.decisionId,record(patch).decisionId,'Actual evidence/admissibility/provenance must still change identity: '+JSON.stringify(patch));
const stale=record({fresh:false,ageHours:8.01});assert.equal(stale.slots[0].starter.baselineValidity.state,'REASSESS');assert.equal(stale.slots[0].confidence.label,'Limited');
assert.equal(record({fresh:false,ageHours:8.01}).decisionId,record({fresh:false,ageHours:8.02}).decisionId,'Stable after the freshness transition too');
console.log('PASS: stable availability identity across elapsed-age/telemetry changes; source, timestamps, freshness, source contract and admissibility still bind the decision.');
