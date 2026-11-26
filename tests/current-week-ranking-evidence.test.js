'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '../netlify/functions');
const {rankingEvidenceBlockers} = require('../netlify/functions/weekly-sage-rankings');
const now = new Date('2026-11-26T01:00:00Z');
const healthy = {season:'2026',targetWeek:12,seasonType:'reg',now,
  projectionCoverage:{available:true,fresh:true,matched:100},
  centralAvailability:{available:true,fresh:true}};
assert.deepEqual(rankingEvidenceBlockers(healthy), []);
for (const patch of [{available:false},{fresh:false},{matched:0}])
  assert.deepEqual(rankingEvidenceBlockers({...healthy,projectionCoverage:{...healthy.projectionCoverage,...patch}}), ['weekly_projections']);
assert.deepEqual(rankingEvidenceBlockers({...healthy,centralAvailability:{available:true,fresh:false}}), ['player_availability']);
assert.deepEqual(rankingEvidenceBlockers({...healthy,projectionCoverage:{available:false},centralAvailability:{available:false}}), ['weekly_projections','player_availability']);
assert.deepEqual(rankingEvidenceBlockers({...healthy,targetWeek:8,projectionCoverage:{available:false},centralAvailability:{available:false}}), [], 'Past evidence is not gated by current feeds');
assert.deepEqual(rankingEvidenceBlockers({...healthy,season:'2025',projectionCoverage:{available:false}}), []);
assert.deepEqual(rankingEvidenceBlockers({...healthy,seasonType:'pre',projectionCoverage:{available:false}}), []);

// Synthetic provider evidence. Run the complete public handler with no network/storage writes.
const players = Object.fromEntries(['QB','RB','WR','TE','K','DEF'].map((position,i)=>[String(i),{longName:'Fixture '+position,pos:position,team:'BUF'}]));
const rawRows = Object.entries(players).map(([playerID,p])=>({playerID,name:p.longName,position:p.pos,team:p.team,
  rank:1,recommendation:'START',sage:{score:80,confidence:.8,confidenceLabel:'High'},sageTake:'Fixture evidence.'}));
const projection = {evidenceType:'weekly-projection-cache',season:'2026',targetWeek:12,seasonType:'reg',generatedAt:now.toISOString(),scoring:'half',source:'Synthetic fixture',fresh:true,
  rows:[...rawRows,...Array.from({length:100},(_,i)=>({name:'Synthetic extra '+i,position:'RB',team:'BUF'}))].map(p=>({...p,points:{half:10,ppr:10,standard:10},projectedPoints:10}))};
class Clock extends Date {constructor(...a){super(...(a.length?a:[now.getTime()]));}static now(){return now.getTime();}}
async function run({cache=projection,availabilityFresh=true,week=12,usage='rankings'}={}) {
  const source = fs.readFileSync(process.env.WEEKLY_RANKINGS_RUNTIME || path.join(root,'weekly-sage-rankings.js'),'utf8');
  const sandbox = {exports:{},Date:Clock,Map,Set,URLSearchParams,URL,Buffer,console,process:{env:{}},setTimeout,clearTimeout,
    fetch:async url=>{assert(String(url).includes('leaderboard'), 'Only existing cache-only leaderboards may be requested');
      const pos=String(url).match(/weekly-sage-(qb|rb|wr|te|k|def)-leaderboard/)[1].toUpperCase();
      return {ok:true,json:async()=>({leaderboard:rawRows.filter(p=>p.position===pos).map(p=>structuredClone(p))})};},
    require(name){
      if(name==='@netlify/blobs')return {connectLambda(){},getStore:({name})=>({get:async key=>name==='weekly-projections'?cache:name==='player-data'?{
        updatedAt:new Date(now.getTime()-(availabilityFresh?0:24*3600000)).toISOString(),players
      }:null})};
      if(name==='./_weekly-projections.js')return {...require(path.join(root,name)),readWeeklyProjections:async()=>cache};
      return require(name.startsWith('.') ? path.join(root,name) : name);
    }};
  const before=JSON.stringify({rawRows,players,cache});
  vm.runInNewContext(source,sandbox);
  const result=await sandbox.exports.handler({httpMethod:'GET',headers:{host:'fixture.invalid'},queryStringParameters:{season:'2026',week:String(week),scoring:'half',evidenceUsage:usage}});
  assert.equal(JSON.stringify({rawRows,players,cache}),before,'Raw rows and projection evidence must not change');
  return {...result,data:JSON.parse(result.body)};
}
(async()=>{
  for(const usage of ['rankings','archive','waiver']){
    const failed=await run({cache:null,availabilityFresh:false,usage});
    assert.equal(failed.statusCode,503);
    assert.equal(failed.headers['Cache-Control'],'no-store');
    assert.equal(failed.data.errorCode,'RANKING_EVIDENCE_UNAVAILABLE');
    assert.match(failed.data.error,/Week 12/);
    assert.deepEqual(failed.data.missingEvidence,['weekly_projections','player_availability']);
    assert(!failed.data.positions,'Unsafe START/FLEX rows must not escape in an error response');
  }
  assert.equal((await run({cache:null})).statusCode,503);
  assert.equal((await run({availabilityFresh:false})).statusCode,503);
  const ready=await run();assert.equal(ready.statusCode,200);
  assert.equal(ready.data.positions.RB[0].projectedPoints,10);
  assert.equal(ready.data.positions.RB[0].recommendation,'START');
  assert.equal(ready.data.positions.RB[0].sage.confidence,.8);
  assert.equal((await run({cache:null,availabilityFresh:false,week:8})).statusCode,200);
  console.log('PASS: actual ranking handler rejects current missing/stale feeds without writes; healthy and historical results preserved.');
})().catch(e=>{console.error(e);process.exitCode=1;});
