'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module');
const h=require('../netlify/functions/_injury-transactions');
const {applyCentralAvailability}=require('../netlify/functions/weekly-sage-rankings');
const {extractSageEvidence}=require('../netlify/functions/waiver-candidates')._test;
const {decorateDecision}=require('../netlify/functions/waiver-recommendations')._test;
const {_test}=require('../netlify/functions/chatgpt-mcp');
const html=fs.readFileSync(__dirname+'/fixtures/nfl-reserve-2026-10.html','utf8');
async function main(){
 const parsed=h.parseTransactions(html,2026,10,'reserve-list','https://www.nfl.com/transactions/league/reserve-list/2026/10');
 assert.equal(parsed.length,1);assert.equal(parsed[0].name,'Travis Etienne');assert.equal(parsed[0].status,'IR');assert.equal(parsed[0].team,'NO');
 assert.throws(()=>h.parseTransactions('<html>Sign in</html>',2026,10,'reserve-list','url'),/contract changed/);
 assert.throws(()=>h.parseTransactions(html.replace('10/01','09/01'),2026,10,'reserve-list','url'),/date incomplete/);
 assert.deepEqual(h.parseTransactions('<a href="/transactions/league/other/2026/10"></a><section class="nfl-o-no-results">No Transactions Available</section>',2026,10,'other','url'),[]);
 const merged=h.mergeTransactions(null,parsed);assert.equal(merged.records[0].position,'RB','preserve verified position when source has blank position');
 const runner={name:'Travis Etienne Jr.',team:'NO',position:'RB',playerID:'4239996'};
 assert.equal(h.matchingTransaction(runner,2026,3,merged.records),null,'do not leak Week 4 injury into Week 3');
 assert.equal(h.matchingTransaction({...runner,team:'JAX'},2026,4,merged.records),null,'wrong team cannot inherit transaction');
 const positions={RB:[runner]},inactive={};
 applyCentralAvailability(positions,inactive,{players:{},byName:new Map(),fresh:true,transactions:merged.records},2026,4);
 assert.equal(positions.RB.length,0);assert.equal(inactive.RB[0].status,'IR');assert.match(inactive.RB[0].sourceUrl,/nfl.com/);
 const miller={name:'Kendre Miller',team:'NO',position:'RB',rank:54,recommendation:'SIT',playerID:'4599739',sageTake:'Prior role.',availabilityVerified:true,_sagePosition:'RB',_sagePositionRank:54};
 const context=h.roleContext(miller,{},merged.records,2026,4,new Date().toISOString());
 assert.match(context.note,/Etienne.*IR/);assert.equal(context.rankRecalculated,false);assert.match(context.note,/share is not verified/);
 assert.equal(h.roleContext({...miller,team:'DEN'},{},merged.records,2026,4),null);
 assert.equal(h.roleContext(miller,{},merged.records,2026,3),null);
 assert.equal(h.roleContext(miller,{},merged.records,2026,5),null,'historical reserve evidence must not indefinitely block drops after next weekly rebuild');
 miller.roleContext=context;const evidence=extractSageEvidence(miller);assert.deepEqual(evidence.roleContext,context);
 const candidate={name:'Fixture Add',position:'RB',decision:{action:'ADD',reasons:[]},evidence:{sage:{position:'RB',positionRank:10,availabilityVerified:true},opportunity:{lastGameOpportunities:15},rosterImpact:{classification:'UPGRADE',comparisonType:'same-position-fallback',weakestComparable:{name:miller.name,position:'RB',team:'NO',sage:evidence}}}};
 const guarded=decorateDecision(candidate,{teams:12});assert.equal(guarded.verdict,'REVIEW');assert.equal(guarded.swapFor,null);assert.equal(guarded.faab,null);assert(guarded.marketFaab);assert.equal(guarded.decision.reasonCode,'TEAMMATE_ROLE_CHANGED');
 const activated=h.mergeTransactions(merged,[{...parsed[0],status:'ACTIVE',reportedAt:'2026-10-10'}]);
 assert.equal(h.roleContext(miller,{},activated.records,2026,6),null,'explicit activation clears role warning');
 assert.equal(h.mergeTransactions(activated,parsed).records[0].status,'ACTIVE','old reserve report cannot undo newer activation');
 assert.equal(h.mergeTransactions(merged,[{...parsed[0],status:'ACTIVE'}]).records[0].status,'IR','ambiguous same-day activation cannot clear reserve');
 const active={RB:[runner]},inactive2={};applyCentralAvailability(active,inactive2,{players:{[runner.playerID]:{longName:runner.name,team:'NO',pos:'RB',injury:{designation:'IR'}}},byName:new Map(),fresh:true,transactions:activated.records},2026,6);assert.equal(active.RB.length,1,'explicit later activation supersedes retained old IR');
 assert(!fs.readFileSync(__dirname+'/../.github/workflows/injury-evidence-health.yml','utf8').includes('REFRESH_SECRET'),'read-only health checks must not depend on a missing refresh secret');
 const oldFetch=global.fetch;global.fetch=async()=>({ok:true,status:200,json:async()=>({positions:{RB:[miller]},metadata:{complete:true}})});
 try{const server=_test.buildServer(new Request('https://fixture.invalid/.netlify/functions/chatgpt-mcp'),{snapshot:{provider:'cbs',scoringFormat:'half-ppr',league:{season:2026,teamCount:12},roster:[{name:miller.name,position:'RB',status:'RS'}],settings:{lineupSlots:[{slot:'RB',count:1}]}}});
  const lineup=await server._registeredTools.get_lineup_recommendation.handler({week:4});assert.match(lineup.structuredContent.starters[0].reason,/Etienne.*IR/);
  const profile=await server._registeredTools.get_player_profile.handler({player:miller.name,scoring:'half',week:4});assert.match(profile.structuredContent.profile.insight,/Etienne.*IR/);
  global.fetch=async()=>({ok:true,status:200,json:async()=>({positions:{DEF:[{name:'NE',position:'DEF',team:'NE',rank:5,recommendation:'START'}]},inactive:{RB:[{...runner,status:'IR',rank:27,sage:{label:'Above Average'},reason:'Official transaction: IR — Etienne unavailable.'}]},metadata:{complete:true}})});
  const injured=await server._registeredTools.get_player_profile.handler({player:'Travis Etienne',scoring:'half',week:4});assert.equal(injured.structuredContent.profile.identity.name,runner.name);assert.equal(injured.structuredContent.profile.verdict.action,'INELIGIBLE');assert.equal(injured.structuredContent.profile.rankProjection,null,'inactive player has no actionable rank');assert.match(injured.structuredContent.profile.insight,/IR/);
  const unknown=await server._registeredTools.get_player_profile.handler({player:'Unknown Etienne',scoring:'half',week:4});assert.equal(unknown.structuredContent.found,false,'word fragment cannot resolve to NE defense');
  const defense=await server._registeredTools.get_player_profile.handler({player:'NE',scoring:'half',week:4});assert.equal(defense.structuredContent.profile.identity.name,'NE','exact defense lookup preserved');
  global.fetch=async()=>({ok:true,status:200,json:async()=>({positions:{RB:[miller]},metadata:{complete:true}})});
  const compare=await server._registeredTools.compare_players.handler({players:[miller.name,'Unknown'],scoring:'half',week:4});assert.match(compare.structuredContent.players[0].profile.insight,/Etienne.*IR/);
 }finally{global.fetch=oldFetch;}
 const originalLoad=Module._load;let injuryRecoveries=0;
 Module._load=function(name,...args){if(name==='@netlify/blobs')return {connectLambda(){},getStore(){}};if(name==='./_weekly-refresh-recovery.js')return {inspectJobs:async()=>[],resolveCurrentNFLWeek:()=>4};if(name==='./refresh-injury-transactions')return {handler:async()=>{injuryRecoveries++;return {statusCode:502,body:'{}'};}};return originalLoad.call(this,name,...args);};
 try{delete require.cache[require.resolve('../netlify/functions/recover-weekly-sage')];const recovery=require('../netlify/functions/recover-weekly-sage');const allowed=await recovery.handler({});assert.equal(allowed.statusCode,200,'injury-source failure cannot break independent weekly recovery');assert.equal(injuryRecoveries,1,'authorized scheduler attempts injury recovery');const denied=await recovery.handler({httpMethod:'GET'});assert([401,503].includes(denied.statusCode));assert.equal(injuryRecoveries,1,'unauthorized requests cannot initiate collection');}finally{Module._load=originalLoad;}
 const stores=new Map();const getStore=({name})=>{if(!stores.has(name)){const records=new Map();stores.set(name,{get:async k=>records.get(k)?.data||null,getWithMetadata:async k=>records.get(k)||null,setJSON:async(k,data,o={})=>{const old=records.get(k);if(o.onlyIfNew&&old||o.onlyIfMatch&&o.onlyIfMatch!==old?.etag)return {modified:false};records.set(k,{data:structuredClone(data),etag:String(Number(old?.etag||0)+1)});return {modified:true};}});}return stores.get(name);};
 const oldLoad=Module._load;Module._load=function(name,...args){return name==='@netlify/blobs'?{connectLambda(){},getStore}:oldLoad.call(this,name,...args);};
 let refresh;try{delete require.cache[require.resolve('../netlify/functions/refresh-injury-transactions')];refresh=require('../netlify/functions/refresh-injury-transactions');}finally{Module._load=oldLoad;}
 let requests=0;global.fetch=async url=>{requests++;assert.match(url,/^https:\/\/www.nfl.com\/transactions\//,'no Tank01/customer request');return {ok:true,text:async()=>url.includes('/reserve-list/')&&url.endsWith('/10')?html:`<a href="${new URL(url).pathname}"></a><section class="nfl-o-no-results">No Transactions Available</section>`};};
 try{await Promise.all(Array.from({length:5},()=>refresh.handler({})));assert.equal(requests,6,'duplicate refreshes collect only once');const stored=await getStore({name:h.STORE}).get('latest');assert(stored.checkedAt);await refresh.handler({});assert.equal(requests,6,'fresh cache skips source calls');
  await getStore({name:h.STORE}).setJSON('latest',{...stored,checkedAt:'2000-01-01'});await getStore({name:h.STORE}).setJSON('refresh-lease',{until:0});
  requests=0;global.fetch=async url=>{requests++;const path=new URL(url).pathname;if(path.includes('/reserve-list/')&&path.endsWith('/10'))return {ok:true,text:async()=>html+(url.includes('?after=')?'':'<a href="'+path+'?after=test" class="nfl-o-table-pagination__next">Next Page</a>')};return {ok:true,text:async()=>'<a href="'+path+'"></a><section class="nfl-o-no-results">No Transactions Available</section>'};};
  const paginated=await refresh.handler({});assert.equal(paginated.statusCode,200);assert.equal(requests,7,'collect next page once');assert.equal(JSON.parse(paginated.body).sourceRequests,7);
  await getStore({name:h.STORE}).setJSON('latest',{...stored,checkedAt:'2000-01-01'});await getStore({name:h.STORE}).setJSON('refresh-lease',{until:0});
  global.fetch=async url=>{const path=new URL(url).pathname;const source=path.includes('/reserve-list/')&&path.endsWith('/10')?html:'<a href="'+path+'"></a><section class="nfl-o-no-results">No Transactions Available</section>';return {ok:true,text:async()=>source+(path.includes('/reserve-list/')&&path.endsWith('/09')?'<a href="'+path+'?after=repeat" class="nfl-o-table-pagination__next">Next Page</a>':'')};};
  const historical=await refresh.handler({});assert.equal(historical.statusCode,200);assert.equal(JSON.parse(historical.body).historicalWarnings.length,1,'historical loop disclosed without hiding current month evidence');
  await getStore({name:h.STORE}).setJSON('latest',{...stored,checkedAt:'2000-01-01'});await getStore({name:h.STORE}).setJSON('refresh-lease',{until:0});global.fetch=async()=>({ok:false,status:503});const failed=await refresh.handler({});assert.equal(failed.statusCode,502);assert.deepEqual((await getStore({name:h.STORE}).get('latest')).records,stored.records,'failed collection preserves all transactions');assert((await getStore({name:h.STORE}).get('health')).error);
 }finally{global.fetch=oldFetch;}
 console.log('PASS: real official transaction shape, safe activation, missing-roster IR, teammate context across MCP, guarded drops, atomic six-source collection, zero Tank01, failure preservation.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
