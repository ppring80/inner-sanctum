'use strict';
const assert=require('node:assert/strict'),Module=require('module');
const original=Module._load,gate=process.env.SUPER_SAGE_REVIEWER_PEEPHOLE;let reads=0;const writes=[];const previousFetch=global.fetch;
Module._load=function(request,parent,isMain){
 if(request==='@modelcontextprotocol/server')return {createMcpHandler:()=>{},McpServer:class{constructor(){this.tools={};}registerTool(name,options,callback){this.tools[name]={options,callback};}}};
 if(request==='@netlify/blobs')return {getStore:()=>({get:async()=>{reads++;return null;},setJSON:async(k,v)=>{writes.push({key:k,value:v});return {modified:true};}})};
 return original.call(this,request,parent,isMain);
};
const {buildServer}=require('../netlify/functions/chatgpt-mcp')._test;
(async()=>{
 const args={decisionId:'a'.repeat(64),players:['Patrick Mahomes','Drake Maye'],consentToAnthropic:false};
 process.env.SUPER_SAGE_REVIEWER_PEEPHOLE='false';assert.equal((await buildServer({}, {snapshotKey:'owner'}).tools.request_rookie_second_opinion.callback(args)).isError,true);
 process.env.SUPER_SAGE_REVIEWER_PEEPHOLE='true';assert.equal((await buildServer({},null).tools.request_rookie_second_opinion.callback(args)).isError,true);
 const tool=buildServer({}, {snapshotKey:'owner'}).tools.request_rookie_second_opinion;
 assert.equal(tool.options.annotations.readOnlyHint,false);assert.equal(tool.options.annotations.openWorldHint,true);assert.match(tool.options.description,/Anthropic Claude Sonnet/);assert.match(tool.options.description,/even when SAGE has decided/);
 const consent=await tool.callback(args);assert.equal(consent.structuredContent.reason,'provider_consent_required');assert.equal(reads,0);assert.match(consent.content[0].text,/May Rookie send/);
 const missing=await tool.callback({...args,consentToAnthropic:true});assert.equal(missing.structuredContent.reason,'owned_input_unavailable');assert.equal(reads,3);assert.equal(missing.structuredContent.lineupChanged,false);
 const row={name:'Fixture QB',position:'QB',team:'AAA',rank:1,projectedPoints:20,recommendation:'START'};
 global.fetch=async()=>({ok:true,status:200,json:async()=>({positions:{QB:[row],RB:[],WR:[],TE:[],K:[],DEF:[]},metadata:{complete:true}})});
 const snapshot={provider:'cbs',scoringFormat:'half-ppr',league:{season:2026,teamCount:12},roster:[{name:row.name,position:'QB',status:'A'}],settings:{lineupSlots:[{slot:'QB',count:1}]}};
 const lineup=buildServer(new Request('https://fixture.invalid/.netlify/functions/chatgpt-mcp'),{snapshot,snapshotKey:'owner'}).tools.get_lineup_recommendation;
 const linked=await lineup.callback({season:2026,week:4});assert.equal(linked.isError,undefined);
 const pointers=()=>writes.filter(w=>w.key.startsWith('rookie-current-decision/'));assert.equal(pointers().length,1);assert.equal(pointers()[0].value.inputSource,'linked_league');
 const pasted=await lineup.callback({season:2026,week:4,roster:[{name:row.name,position:'QB',lineupSlot:'QB'}],teamCount:10,scoringFormat:'standard'});assert.equal(pasted.isError,undefined);assert.equal(pointers().length,1,'pasted roster cannot replace linked current-decision pointer');
 console.log('PASS: actual named-pair customer tool exposes honest provider/write annotations, requires linked gate and explicit Anthropic consent, stops before evidence reads without permission; missing owned input never generates.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{Module._load=original;global.fetch=previousFetch;if(gate===undefined)delete process.env.SUPER_SAGE_REVIEWER_PEEPHOLE;else process.env.SUPER_SAGE_REVIEWER_PEEPHOLE=gate;});
