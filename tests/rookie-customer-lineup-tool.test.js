'use strict';
const assert=require('node:assert/strict');
const {_test}=require('../netlify/functions/chatgpt-mcp');
(async()=>{
 const originalFetch=global.fetch,gate=process.env.SUPER_SAGE_REVIEWER_PEEPHOLE;
 let calls=0;
 const row={name:'Fixture QB',position:'QB',team:'AAA',rank:1,projectedPoints:20,recommendation:'START'};
 global.fetch=async url=>{calls++;assert.ok(!String(url).includes('anthropic'));return {ok:true,status:200,json:async()=>({positions:{QB:[row],RB:[],WR:[],TE:[],K:[],DEF:[]},metadata:{complete:true}})};};
 try{
  process.env.SUPER_SAGE_REVIEWER_PEEPHOLE='false';
  const snapshot={provider:'cbs',scoringFormat:'half-ppr',league:{season:2026,teamCount:12},roster:[{name:row.name,position:'QB',status:'A'}],settings:{lineupSlots:[{slot:'QB',count:1}]}};
  const tool=_test.buildServer(new Request('https://fixture.invalid/.netlify/functions/chatgpt-mcp'),{snapshot})._registeredTools.get_lineup_recommendation;
  const base=await tool.handler({season:2026,week:4});const opted=await tool.handler({season:2026,week:4,includeRookieSecondOpinion:true});
  assert.equal(base.isError,undefined);assert.equal(opted.isError,undefined);
  const a=base.structuredContent,b=opted.structuredContent;assert.deepEqual(a.starters,b.starters);assert.deepEqual(a.bench,b.bench);assert.deepEqual(a.superSage.customerAnswer,b.superSage.customerAnswer);assert.equal(a.superSage.rookieSecondOpinion,undefined);assert.equal(b.superSage.rookieSecondOpinion.status,'UNAVAILABLE');assert.match(opted.content[0].text,/Rookie second opinion unavailable/);assert.ok(opted.content[0].text.startsWith(base.content[0].text.split('\n\n')[0]));
  const omitted=await tool.handler({season:2026,week:4,includeRookieSecondOpinion:false});assert.deepEqual(omitted,base);assert.equal(calls,3,'existing one Weekly SAGE request per lineup, no provider request');
  console.log('PASS: actual lineup tool default/false response parity, opt-in additive note, unchanged SAGE record and starters, closed pilot safe, no provider call.');
 }finally{global.fetch=originalFetch;if(gate===undefined)delete process.env.SUPER_SAGE_REVIEWER_PEEPHOLE;else process.env.SUPER_SAGE_REVIEWER_PEEPHOLE=gate;}
})().catch(e=>{console.error(e);process.exitCode=1;});
