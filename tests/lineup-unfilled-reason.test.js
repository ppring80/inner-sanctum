'use strict';
const assert=require('assert');
const {_test}=require('../netlify/functions/chatgpt-mcp');
(async()=>{
 const saved=global.fetch;
 global.fetch=async()=>({ok:true,status:200,json:async()=>({positions:{QB:[],RB:[],WR:[],TE:[],K:[],DEF:[]},metadata:{complete:true}})});
 try {
  const snapshot={provider:'cbs',league:{season:2026,teamCount:12},scoringFormat:'half-ppr',roster:[{name:'Fixture WR',position:'WR',team:'NYG',status:'A'}],settings:{lineupSlots:[{slot:'WR',count:2},{slot:'FLEX',count:1}]}};
  const server=_test.buildServer(new Request('https://fixture.invalid/.netlify/functions/chatgpt-mcp'),{snapshot});
  const tool=server._registeredTools.get_lineup_recommendation;
  const result=await tool.handler({season:2026,week:5});
  assert.equal(result.isError,undefined);
  const data=result.structuredContent;
  assert(data,JSON.stringify(result));
  assert.equal(data.unfilledSlots.length,3);
  for(const slot of data.unfilledSlots){assert.equal(typeof slot.reason,'string');assert(slot.reason.length);assert(Array.isArray(slot.eligiblePositions));}
  assert(!data.starters.some(s=>s.player));
  if(tool.outputSchema?.safeParse) assert(tool.outputSchema.safeParse(data).success,'public output schema must accept empty slots');
  console.log('MCP returns schema-valid reasons for empty WR/FLEX slots without inventing a starter.');
 } finally {global.fetch=saved;}
})().catch(e=>{console.error(e);process.exitCode=1;});
