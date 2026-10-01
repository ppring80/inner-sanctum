'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {buildMarketFaab,decorateDecision,addDollarGuidance,resolveWaiverWeek,customerVerdict}=require('../netlify/functions/waiver-recommendations')._test;
for(const position of ['QB','RB','WR','TE','K','DEF']){
 const item={position,identity:{sageMatched:true},evidence:{sage:{positionRank:8},providerProjectedPoints:10}};
 const bid=buildMarketFaab(item,{teams:12,scoring:'half-ppr'});
 assert(bid,position);assert(bid.recommendedPct>0,position);
 assert.deepEqual(bid,buildMarketFaab({...item,verdict:'PASS',evidence:{...item.evidence,rosterImpact:{projectionDelta:-20}}},{teams:12,scoring:'half-ppr'}));
 const result=addDollarGuidance(decorateDecision({...item,decision:{action:'PASS'}},{teams:12}),200);
 assert.equal(result.verdict,customerVerdict({...item,decision:{action:'PASS'}}));assert.equal(result.faab,null);assert(result.marketFaab);assert.equal(result.marketFaab.recommendedDollars,result.marketFaab.recommendedPct*2);
}
assert.equal(buildMarketFaab({position:'WR',evidence:{}},{}),null);
assert.equal(buildMarketFaab({position:'WR',identity:{sageMatched:false},evidence:{sage:{positionRank:2}}},{}),null);
assert.equal(buildMarketFaab({position:'WR',evidence:{sage:{positionRank:200}}},{}).recommendedPct,0);
const html=fs.readFileSync('free-agents.html','utf8');
const fn=html.match(/function faabCell\(item\)\{[^\n]+/)[0];
const context={escapeHtml:String};vm.runInNewContext(fn,context);
assert.match(context.faabCell({}),/Estimate unavailable/);
assert.match(context.faabCell({marketFaab:{recommendedPct:0,valuePct:0,aggressivePct:1,recommendedDollars:0}}),/0%/);
assert.match(context.faabCell({marketFaab:{recommendedPct:3,valuePct:2,aggressivePct:5,recommendedDollars:6}}),/\$6/);
assert.equal(resolveWaiverWeek({connection:{season:2026,currentWeek:3}},new Date('2026-09-29T05:59:59Z')),3);
assert.equal(resolveWaiverWeek({connection:{season:2026,currentWeek:3}},new Date('2026-09-29T06:00:00Z')),4);
console.log('PASS: independent market estimates across all positions, unavailable versus zero, dollar conversion and Tuesday rollover');
