'use strict';
const assert=require('node:assert/strict');
const {applyCentralAvailability}=require('../netlify/functions/weekly-sage-rankings');
const {extractSageEvidence}=require('../netlify/functions/waiver-candidates')._test;
const {buildWaiverDecisions}=require('../netlify/functions/waiver-decision');
const {decorateDecision}=require('../netlify/functions/waiver-recommendations')._test;
const {_test}=require('../netlify/functions/chatgpt-mcp');
async function main(){
 for(const position of ['QB','RB','WR','TE','K'])for(const status of ['IR','OUT','RELEASED','PS','PRACTICE SQUAD']){
  const row={playerID:'1',name:'Fixture Player',position,team:'BUF'};
  const positions={[position]:[row]},inactive={};
  applyCentralAvailability(positions,inactive,{players:{'1':{longName:row.name,pos:position,team:'BUF',rosterStatus:status,injury:{designation:'Questionable'}}},byName:new Map(),fresh:true},2024,7);
  assert.equal(positions[position].length,0,position+' '+status);assert.equal(inactive[position][0].status,status);
 }
 for(const pos of ['qb','rb','wr','te'])assert.equal(require('../netlify/functions/weekly-sage-'+pos+'-availability').availabilityForPlayer({name:'Fixture Player',injuryStatus:'Questionable',rosterStatus:'PRACTICE SQUAD',eligible:true},2024,7).eligible,false);
 const kicker={playerID:'k',name:'Fixture Kicker',position:'K',team:'BUF'};
 for(const designation of ['', 'Out']){
  const positions={K:[kicker]},inactive={};
  applyCentralAvailability(positions,inactive,{players:{k:{longName:kicker.name,pos:'PK',team:'BUF',injury:{designation}}},byName:new Map(),fresh:true},2024,7);
  if(designation)assert.equal(positions.K.length,0,'provider PK injury must exclude K');
  else assert.equal(positions.K[0].availabilityVerified,true,'provider PK must verify normalized K');
 }
 const row={name:'Fixture Runner',position:'RB',playerID:'1',team:'BUF',rank:1,_sagePosition:'RB',_sagePositionRank:1,projectedPoints:20,sage:{score:90},sageTake:'Strong role.',injuryStatus:'QUESTIONABLE',injuryDescription:'Ankle; limited practice',availabilityVerified:false};
 const sage=extractSageEvidence(row);assert.equal(sage.injuryStatus,'QUESTIONABLE');assert.equal(sage.injuryDescription,row.injuryDescription);assert.equal(sage.availabilityVerified,false);
 const candidate={name:row.name,position:'RB',availabilityStatus:'FREE_AGENT',providerProjectedPoints:20,identity:{sageMatched:true},sage,rosterImpact:{classification:'UPGRADE',comparisonType:'same-position-fallback',weakestComparable:{name:'Fixture Bench',sage:{positionRank:50,sageScore:30}}}};
 const decisions=buildWaiverDecisions([candidate]);assert(decisions[0].decision.reasons.some(reason=>reason.includes('Ankle')));assert(decisions[0].decision.reasons.some(reason=>reason.includes('not verified')));
 const result=decorateDecision({...decisions[0],decision:{...decisions[0].decision,action:'ADD'}});assert.equal(result.verdict,'REVIEW');assert.equal(result.faab,null);assert.equal(result.customerActionable,false);assert(result.marketFaab,'market value remains separate from unsafe add advice');
 const saved=global.fetch;global.fetch=async()=>({ok:true,status:200,json:async()=>({positions:{QB:[],RB:[row],WR:[],TE:[],K:[],DEF:[]},metadata:{complete:true}})});
 try{
  const snapshot={provider:'cbs',scoringFormat:'half-ppr',league:{season:2026,teamCount:12},roster:[{name:row.name,position:'RB',status:'A'}],settings:{lineupSlots:[{slot:'RB',count:1}]}};
  const server=_test.buildServer(new Request('https://fixture.invalid/.netlify/functions/chatgpt-mcp'),{snapshot});
  const answer=await server._registeredTools.get_lineup_recommendation.handler({season:2026,week:4});assert(!answer.isError);assert.match(answer.structuredContent.starters[0].reason,/QUESTIONABLE.*Ankle/);assert.match(answer.structuredContent.starters[0].reason,/not verified/);
  row.availabilityVerified=true;
  const fresh=await server._registeredTools.get_lineup_recommendation.handler({season:2026,week:4});assert.match(fresh.structuredContent.starters[0].reason,/QUESTIONABLE/);assert(!fresh.structuredContent.starters[0].reason.includes('not verified'),'verified Questionable remains conditional without a false stale warning');
 }finally{global.fetch=saved;}
 console.log('PASS: hard eligibility across five player positions; injury context reaches real lineup and waiver handlers; unverified evidence cannot support actionable FAAB; market values preserved.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
