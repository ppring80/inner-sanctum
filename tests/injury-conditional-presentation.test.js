'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {weeklyInjuryCondition,buildWeeklyRankingExplanation} = require('../netlify/functions/sage-take');
const {buildLineupDecisionRecord} = require('../netlify/functions/_super-sage-lineup-decision');
const presenters = require('../netlify/functions/_super-sage-lineup-presenters');
const {_test} = require(process.env.INJURY_MCP_RUNTIME || '../netlify/functions/chatgpt-mcp');
const html = fs.readFileSync('weekly.html','utf8');
const browser = {getScoringFormat:()=> 'half'};
const start=html.indexOf('function weeklyInjuryCondition('),end=html.indexOf('function mapWeeklyRowToProfileModel(',start);
vm.runInNewContext(html.slice(start,end),browser);
const cases=[{}, {injuryStatus:'QUESTIONABLE'}, {injuryStatus:'Q'}, {injuryStatus:'Doubtful'},
  {availabilityVerified:false}, {injuryStatus:'QUESTIONABLE',availabilityVerified:false},
  {injuryStatus:'OUT',availabilityVerified:false}, {injuryStatus:'IR'}, {eligibleForWeeklyRanking:false},
  {injuryStatus:'LP'}, {injuryStatus:'ACTIVE',injuryDescription:'Limited practice is not a game workload restriction.'}];
const presenterSource=fs.readFileSync('netlify/functions/_super-sage-lineup-presenters.js','utf8');
const isolated={};vm.runInNewContext(presenterSource.slice(presenterSource.indexOf('function weeklyInjuryCondition('),presenterSource.indexOf('function statusLine(')),isolated);
for(const row of cases){assert.equal(isolated.weeklyInjuryCondition(row),weeklyInjuryCondition(row));const raw=JSON.stringify(row);assert.equal(browser.weeklyInjuryCondition(row),weeklyInjuryCondition(row));assert.equal(JSON.stringify(row),raw);}
assert.equal(weeklyInjuryCondition({injuryStatus:'LP'}),null,'Practice participation must not invent game restrictions');
assert.match(weeklyInjuryCondition({injuryStatus:'DOUBTFUL'}),/Do not rely/);
assert.match(weeklyInjuryCondition({injuryStatus:'QUESTIONABLE'}),/conditional.*active.*workload restrictions/);
assert.match(weeklyInjuryCondition({availabilityVerified:false}),/not verified/);
const q={name:'Fixture Questionable',playerID:'fixture-q',position:'RB',team:'BUF',rank:1,recommendation:'START',
  injuryStatus:'QUESTIONABLE',injuryDescription:'Synthetic sourced report: expected workload restriction.',availabilityVerified:true,
  projectedPoints:14.89,projection:{source:'Synthetic fixture',season:'2026',week:12,scoring:'half',fresh:true,points:14.89},
  projectionOrderMode:'complete',projectionRankStatus:'projected',sage:{score:90,confidence:.9,confidenceLabel:'High'},sageTake:'Existing sourced role evidence.'};
const healthy={...q,name:'Fixture Healthy',playerID:'fixture-h',rank:2,injuryStatus:null,injuryDescription:null,projectedPoints:13,projection:{...q.projection,points:13}};
const rankings={season:2026,week:12,positions:{RB:[q,healthy]},metadata:{availability:{available:true,fresh:true}}};
const input={rankings,roster:[{name:q.name,position:'RB'}],slots:[{slotLabel:'RB',eligiblePositions:['RB'],count:1}],season:2026,week:12,scoring:'half'};
function decision(){return buildLineupDecisionRecord(input);}
const raw=JSON.stringify(rankings),before=JSON.stringify(decision());
const record=decision();assert.equal(record.slots[0].starter.name,q.name);
const answer=presenters.toCustomerAnswer(record),starters=presenters.toMcpStartersFromRecord(record);
assert(answer.oneSecond.join(' ').includes('(conditional)'));
assert(starters[0].reason.includes('conditional'));
assert(starters[0].reason.includes(q.injuryDescription),'Sourced workload text survives without an invented numerical penalty');
assert.equal(JSON.stringify(record),before);
assert.match(buildWeeklyRankingExplanation(q,{season:2026,week:12,scoring:'half'}),/conditional/);
const row={...q,pos:'RB',positionRank:1,providerProjectedPoints:14.89,injury:'questionable',call:'start'};
assert.match(browser.weeklyDisplayExplanation(row),/conditional/);
const callStart=html.indexOf('function callTag('),callEnd=html.indexOf('// Matchup 1/3/10',callStart);
vm.runInNewContext(html.slice(callStart,callEnd),browser);
assert.match(browser.callTag('start',row),/START · CONDITIONAL/);
assert.equal(browser.callTag('start',{...row,injuryStatus:null,injury:null}),'<span class="verdict-tag start">START</span>');
assert(!browser.callTag('sit',row).includes('CONDITIONAL'));
assert(!browser.weeklyEscapeHtml('<script>conditional</script>').includes('<script>'));
(async()=>{
 const saved=global.fetch;global.fetch=async url=>Response.json(String(url).includes('weekly-sage-rankings')?rankings:{defenses:{}});
 try{
  const server=_test.buildServer(new Request('https://fixture.invalid/.netlify/functions/chatgpt-mcp'),{});
  const call=async(name,args)=>{const r=await server._registeredTools[name].handler(args);assert(!r.isError,JSON.stringify(r));return r;};
  const args={season:2026,week:12,scoring:'half'};
  const ranked=await call('get_weekly_rankings',{...args,position:'RB',limit:10});
  const displayed=ranked.structuredContent.rankings;
  assert.match(ranked.structuredContent.superSageResponse.evidenceRule,/Never present a conditional START as unconditional/);
  assert.match(displayed[0].sageTake,/conditional/);assert.equal(displayed[0].rank,1);assert.equal(displayed[0].recommendation,'START');assert.equal(displayed[0].sageConfidence,.9);
  assert(!displayed[1].sageTake.includes('conditional'),'Healthy controls stay unconditional');
  const profile=await call('get_player_profile',{...args,player:q.name});
  assert.match(profile.structuredContent.superSageResponse.evidenceRule,/initial recommendation/);
  assert(profile.structuredContent.profile.verdict.reasons.some(r=>r.includes('conditional')));
  for(const players of [[q.name,healthy.name],[healthy.name,q.name]]){
   const comparison=await call('compare_players',{...args,players,externalAnalysisRequested:false});
   assert.match(comparison.structuredContent.superSageResponse.evidenceRule,/initial recommendation/);
   assert.equal(comparison.structuredContent.comparison.preferredPlayer,q.name);
   assert.match(comparison.structuredContent.comparison.explanation,/conditional/);
  }
  assert.equal(JSON.stringify(rankings),raw,'Raw evidence and Rookie packet inputs remain byte-identical');
  assert.equal(JSON.stringify(decision()),before,'Decision ID, selection, confidence and record unchanged');
 }finally{global.fetch=saved;}
 console.log('PASS: uncertain/healthy/unavailable presentation across actual MCP tools, website and lineup presenters; raw evidence and full decisions unchanged.');
})().catch(e=>{console.error(e);process.exitCode=1;});
