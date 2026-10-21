'use strict';
const assert=require('node:assert/strict');
const {buildLineupDecisionRecord}=require('../netlify/functions/_super-sage-lineup-decision');
const {toMcpLineup,toWebsiteLineup,decisionOf,toCustomerAnswer}=require('../netlify/functions/_super-sage-lineup-presenters');
let cases=0;
for(const scoring of ['standard','half','ppr'])for(const position of ['QB','RB','WR','TE','K','DEF'])for(const scenario of ['baseline','rank-reversal','out','stale-projection','unranked']){
 const row=(name,rank,points)=>({name,position,team:'XX',rank,recommendation:'START',availabilityVerified:true,projectedPoints:points,projection:{points,source:'Tank01',scoring,week:4,fresh:true}});
 const a=row('Alpha',1,8),b=row('Beta',2,20);
 if(scenario==='rank-reversal'){a.rank=2;b.rank=1;}
 if(scenario==='out')a.injuryStatus='OUT';
 if(scenario==='stale-projection')a.projection.fresh=b.projection.fresh=false;
 if(scenario==='unranked'){delete a.rank;delete b.rank;delete a.recommendation;delete b.recommendation;}
 const args={rankings:{positions:{[position]:[a,b]},metadata:{availability:{updatedAt:'2026-10-03T12:00:00Z',fresh:true}}},roster:[{name:a.name,position},{name:b.name,position}],slots:[{slotLabel:position,eligiblePositions:[position],count:1}],scoring,season:2026,week:4};
 const before=JSON.stringify(args),r=buildLineupDecisionRecord(args),s=r.slots[0];
 assert.equal(s.starter?.name||null,scenario==='unranked'?null:['rank-reversal','out'].includes(scenario)?'Beta':'Alpha',scoring+'/'+position+'/'+scenario);
 assert.deepEqual(decisionOf(toMcpLineup(r)),decisionOf(toWebsiteLineup(r)));
 assert.equal(JSON.stringify(args),before,'evidence must not be mutated');
 const reordered=buildLineupDecisionRecord({...args,roster:args.roster.slice().reverse()});assert.equal(reordered.slots[0].starter?.name,s.starter?.name);
 if(scenario==='unranked')assert.doesNotMatch(toCustomerAnswer(r).oneSecond.join(' '),/All .* slots decided/);
 cases++;
}
console.log('PASS '+cases+' lineup cases: six positions × three scoring formats × five evidence states; source-order authority, OUT exclusion, stale projections, missing ranks, input immutability, roster-order independence and website/MCP parity. No provider calls.');
