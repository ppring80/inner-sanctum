'use strict';
const assert=require('node:assert/strict');
const {buildLineupDecisionRecord}=require('../netlify/functions/_super-sage-lineup-decision');
const {toCustomerAnswer,toMcpLineup,toWebsiteLineup,decisionOf}=require('../netlify/functions/_super-sage-lineup-presenters');
const {fromSnapshot}=require('../netlify/functions/_super-sage-opportunity-evidence');
const {withRawGames}=require('./helpers/opportunity-snapshot');
const clone=x=>JSON.parse(JSON.stringify(x));
const row=(name,position,rank,points,extra={})=>({name,position,team:'XX',rank,recommendation:'FLEX',projectedPoints:points,projection:{points,source:'Tank01',week:4,scoring:'half',fresh:true},availabilityVerified:true,matchup:'Positive',...extra});
const incumbent=row('Incumbent TE','TE',17,7.52,{environmentContext:{type:'QB_AVAILABILITY_CHANGE',status:'REASSESS',note:'Verified quarterback change; impact unquantified.'}});
const challenger=row('Challenger WR','WR',41,10.3);
function run({a=clone(incumbent),b=clone(challenger),aw=5.33,bw=8,roles=true,reverse=false,fixed=false,count=1,extra=[]}={}){
 const positions={TE:[],WR:[]};
 for(let rank=1;rank<=60;rank++)for(const pos of ['TE','WR'])positions[pos].push(row(pos+' filler '+rank,pos,rank,rank<=12?14:rank<=48?8:3,{recommendation:rank<=12?'START':rank<=48?'FLEX':'SIT'}));
 for(const r of [a,b,...extra])positions[r.position][r.rank-1]=r;
 const players=reverse?[b,a,...extra]:[a,b,...extra];
 const opportunity=roles?fromSnapshot(withRawGames({weeks:[1,2,3],computedAt:'2026-10-03T12:00:00Z',records:{'incumbent te|TE':{opportunities:{avgLast3:aw,lastGame:aw,avgLast5:aw},persistence:{gamesSampled:3},signals:[{type:'sampleSize',value:'adequate'},{type:'volumeTier',value:'moderate-volume'}]},'challenger wr|WR':{opportunities:{avgLast3:bw,lastGame:bw,avgLast5:bw},persistence:{gamesSampled:3},signals:[{type:'sampleSize',value:'adequate'},{type:'volumeTier',value:'high-volume'}]}}}),{season:2026,week:4}):null;
 return buildLineupDecisionRecord({rankings:{metadata:{availability:{fresh:true,updatedAt:'2026-10-03T12:00:00Z'}},positions},roster:players.map(p=>({name:p.name,position:p.position})),slots:[{slotLabel:fixed?'TE':'FLEX',eligiblePositions:fixed?['TE']:['RB','WR','TE'],count}],scoring:'half',season:2026,week:4,opportunity});
}
let passed=0;const test=(name,f)=>{f();passed++;console.log('PASS '+name);};
test('reassessed FLEX incumbent yields to a valid same-tier alternative with coherent evidence',()=>{
 const r=run(),s=r.slots[0];assert.equal(s.starter.name,'Challenger WR');assert.equal(s.comparator.name,'Incumbent TE');assert.equal(s.decidedBy,'FLEX_BASELINE_REASSESSED');assert.equal(s.hasValidatedEdge,true);assert.equal(s.comparator.baseline.positionRank,17);assert.equal(s.starter.baseline.positionRank,41);
 assert.match(s.explanation.why.join(' '),/ranking needs reassessment/);assert.doesNotMatch(s.explanation.why.join(' '),/Every displacement condition passed|promoted signal/);
 assert.equal(run({reverse:true}).slots[0].starter.name,s.starter.name);
 assert.deepEqual(decisionOf(toMcpLineup(r)),decisionOf(toWebsiteLineup(r)));
 const text=toCustomerAnswer(r);assert.match(text.oneSecond.join(' '),/Challenger WR/);assert.match(text.threeSeconds.join(' '),/Challenger WR starts over Incumbent TE/);
});
test('valid incumbent retains the existing forward-evidence burden',()=>{const a=clone(incumbent);delete a.environmentContext;const s=run({a}).slots[0];assert.equal(s.starter.name,a.name);assert.notEqual(s.decidedBy,'FLEX_BASELINE_REASSESSED');});
test('different source, stale, wrong scoring/week, missing projection and tie cannot activate reassessment',()=>{
 for(const patch of [{source:'Other'},{fresh:false},{scoring:'ppr'},{week:5},{points:7.52}]){const b=clone(challenger);Object.assign(b.projection,patch);if(patch.points!=null)b.projectedPoints=patch.points;assert.notEqual(run({b}).slots[0].decidedBy,'FLEX_BASELINE_REASSESSED',JSON.stringify(patch));}
 const b=clone(challenger);delete b.projection;assert.notEqual(run({b}).slots[0].decidedBy,'FLEX_BASELINE_REASSESSED');
});
test('questionable, unverified and weaker-tier alternatives cannot take over',()=>{
 for(const patch of [{injuryStatus:'QUESTIONABLE'},{availabilityVerified:false},{recommendation:'SIT'}]){const b={...clone(challenger),...patch};assert.notEqual(run({b}).slots[0].decidedBy,'FLEX_BASELINE_REASSESSED',JSON.stringify(patch));}
 const b={...clone(challenger),injuryStatus:'OUT'};assert.equal(run({b}).slots[0].starter.name,'Incumbent TE');
});
test('missing established roles, conflicting past workload or worse matchup block the new rule',()=>{
 assert.notEqual(run({roles:false}).slots[0].decidedBy,'FLEX_BASELINE_REASSESSED');assert.notEqual(run({bw:4}).slots[0].decidedBy,'FLEX_BASELINE_REASSESSED');
 for(const matchup of ['Negative',null]){const b={...clone(challenger),matchup};assert.notEqual(run({b}).slots[0].decidedBy,'FLEX_BASELINE_REASSESSED');}
});
test('blocked reassessed hold is provisional in the first customer answer, without false projection claims',()=>{
 const r=run({bw:4}),s=r.slots[0],answer=toCustomerAnswer(r);assert.equal(s.starter.name,'Incumbent TE');assert.equal(s.decisionState,'PROVISIONAL_UNRESOLVED');assert.equal(s.hasValidatedEdge,false);assert.match(answer.oneSecond.join(' '),/provisional/);assert.doesNotMatch(answer.oneSecond.join(' '),/All .* slots decided/);assert.match(answer.threeSeconds.join(' '),/ranking needs reassessment/);assert.doesNotMatch(answer.threeSeconds.join(' '),/projects higher|normal projection error/);
});
test('fixed-position choices remain unchanged and the input evidence is immutable',()=>{const a=clone(incumbent),b=clone(challenger),before=JSON.stringify({a,b});assert.equal(run({a,b,fixed:true}).slots[0].starter.name,'Incumbent TE');assert.equal(JSON.stringify({a,b}),before);});
test('a lower-ranked rival cannot bypass its own position leader',()=>{
 const extra=row('Earlier WR','WR',35,7.6);
 const s=run({extra:[extra]}).slots[0];
 assert.notEqual(s.starter.name,'Challenger WR');
 assert.notEqual(s.decidedBy,'FLEX_BASELINE_REASSESSED');
});
test('multiple FLEX slots do not duplicate or lose a player',()=>{
 const r=run({count:2});assert.equal(r.slots.length,2);
 assert.deepEqual(r.slots.map(s=>s.starter.name),['Challenger WR','Incumbent TE']);
 assert.equal(new Set(r.slots.map(s=>s.starter.name)).size,2);assert.equal(r.bench.length,0);
});
console.log(passed+' reassessed FLEX tests passed');
