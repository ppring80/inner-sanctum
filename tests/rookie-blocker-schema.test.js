'use strict';
// Synthetic reproduction of the saved Barkley/Allen failure. No private roster export.
const assert=require('node:assert/strict'),Module=require('module');
const sp=require('../netlify/functions/_rookie-structured-pair');
const {hash}=require('../netlify/functions/_super-sage-shadow-llm');
const fast=require('../netlify/functions/_super-sage-shadow-fast-review');
const failed={selected:null,confidence:'LOW',decidingFactor:'NONE',blocker:'conflicting_evidence',reconsider:'evidence_resolves_blocker'};
// Every evidence pattern: a blocker offered on the wire must pass the same
// factual rules used after generation. Include ties, missing facts and conflicts.
const active={effectiveStatus:{status:'ACTIVE'},unavailable:false,questionable:false};
const makePlayer=(id,points,usage,matchup,availability=active)=>({id,name:id,position:'RB',facts:[
 ['projection',{admissible:true,points}],['observedOpportunity',{avgLast3:usage}],
 ['matchup',matchup],['availability',availability]
].map(([field,value])=>({field,value,factId:`${id}:${field}`}))});
for(const points of [null,8,10,12])for(const usage of [null,5,7,9])for(const matchup of [null,'Negative','Neutral','Positive']){
 const packet={players:[makePlayer('A',10,7,'Neutral'),makePlayer('B',points,usage,matchup)],requiredDisclosures:[]};
 const schema=sp.schemaFor(packet),legacy=sp.schemaFor(packet,{legacyBlockers:true});
 for(const blocker of legacy.properties.blocker.enum.filter(x=>x!=='NONE')){
  const valid=sp.validateV1({...failed,tradeoffFactor:'NONE',blocker},packet).length===0;
  assert.equal(schema.properties.blocker.enum.includes(blocker),valid,JSON.stringify({points,usage,matchup,blocker}));
 }
 assert.equal(schema.properties.selected.enum.includes('NO_CALL'),schema.properties.blocker.enum.length>1);
}
const data=new Map(),stores=new Map();let writes=0,providerCalls=0,mode='valid';
function getStore({name}){
 if(!stores.has(name))stores.set(name,{get:async k=>data.get(`${name}:${k}`),setJSON:async(k,v,o={})=>{
  const full=`${name}:${k}`;if(o.onlyIfNew&&data.has(full))return {modified:false};
  writes++;data.set(full,v);return {modified:true};
 }});
 return stores.get(name);
}
const originalLoad=Module._load,oldFetch=global.fetch;
const oldGate=process.env.SUPER_SAGE_REVIEWER_PEEPHOLE,oldKey=process.env.ANTHROPIC_API_KEY;
Module._load=function(request,parent,isMain){
 if(request==='@netlify/blobs')return {getStore};
 if(request==='@modelcontextprotocol/server')return {createMcpHandler:()=>{},McpServer:class{constructor(){this.tools={};}registerTool(name,options,callback){this.tools[name]={options,callback};}}};
 return originalLoad.call(this,request,parent,isMain);
};
const rows=[{name:'Saquon Barkley',position:'RB',team:'PHI',rank:22,recommendation:'START',projectedPoints:11.35},
 {name:'Keenan Allen',position:'WR',team:'IND',rank:27,recommendation:'FLEX',projectedPoints:9.3}];
rows.forEach(r=>{r.projection={source:'synthetic',scoring:'half',week:9,fresh:true};});
global.fetch=async(url,args)=>{
 if(!String(url).includes('anthropic'))return {ok:true,status:200,json:async()=>({positions:{QB:[],RB:[rows[0]],WR:[rows[1]],TE:[],K:[],DEF:[]},metadata:{complete:true}})};
 providerCalls++;const body=JSON.parse(args.body),schema=body.tools[0].input_schema;
 assert.equal(schema.properties.reconsider.enum.includes('alternative_cleared'),false,'actual outgoing strict schema excludes the failure');
 assert.equal(body.tools[0].strict,true);
 assert.equal(schema.properties.blocker.enum.includes('conflicting_evidence'),false,'outgoing schema cannot request the observed unsupported conflict');
 const input=mode==='invalid'?{...failed,selected:'NO_CALL'}:{selected:'A',confidence:'LOW',decidingFactor:'projection',blocker:'NONE',reconsider:'pick_ruled_out'};
 // Injecting a forbidden response simulates a misbehaving provider, not success.
 return new Response(JSON.stringify({id:'mock-reconsider',model:'claude-sonnet-4-6',stop_reason:'tool_use',content:[{type:'tool_use',name:'submit_decision',input}]}),{status:200});
};
(async()=>{
 process.env.SUPER_SAGE_REVIEWER_PEEPHOLE='true';process.env.ANTHROPIC_API_KEY='synthetic-test-key';
 // Optional absolute path exercises the extracted Netlify function package.
 const {buildServer}=require(process.argv[2]||'../netlify/functions/chatgpt-mcp')._test;
 const snapshot={provider:'cbs',scoringFormat:'half-ppr',league:{season:2026,teamCount:12},roster:rows.map(r=>({...r,status:'A'})),settings:{lineupSlots:[{slot:'FLEX',count:1}]}};
 const server=buildServer(new Request('https://fixture.invalid/.netlify/functions/chatgpt-mcp'),{snapshot,snapshotKey:'synthetic-blocker-owner'});
 const lineup=await server.tools.get_lineup_recommendation.callback({season:2026,week:9});
 assert.notEqual(lineup.isError,true,JSON.stringify(lineup));
 const decisionId=lineup.structuredContent.superSage.decisionId;
 const before=JSON.stringify([...data].filter(([k])=>k.includes('evidence/')||k.includes('rookie-decision/')));
 const args={decisionId,players:rows.map(r=>r.name),consentToAnthropic:false};
 const review=server.tools.request_rookie_second_opinion;
 const denied=await review.callback(args);assert.equal(denied.structuredContent.reason,'provider_consent_required');assert.equal(providerCalls,0);
 const result=await review.callback({...args,consentToAnthropic:true});
 assert.equal(result.structuredContent.status,'READY',JSON.stringify(result));
 assert.match(result.content[0].text,/Rookie leans Saquon Barkley/);
 assert.match(result.content[0].text,/Would switch if Saquon Barkley is ruled out/);
 assert.equal(result.structuredContent.lineupChanged,false);assert.equal(providerCalls,1);
 const countWrites=writes;const repeated=await review.callback({...args,consentToAnthropic:true});
 assert.equal(repeated.structuredContent.timing.cached,true);assert.equal(providerCalls,1);assert.equal(writes,countWrites);
 assert.equal(JSON.stringify([...data].filter(([k])=>k.includes('evidence/')||k.includes('rookie-decision/'))),before);

 // Reproduce the previous v2 cache key; accepted history remains available and
 // rejected history stays rejected without another reservation/provider call.
 const entry=[...data].find(([k])=>k.includes('llm-fast/')&&k.includes('/request/'));
 assert.ok(entry);const [newKey,saved]=entry;
 const selection={players:args.players,slotId:result.structuredContent.opinion.slotId};
 const owner=hash('synthetic-blocker-owner');
 const original=await getStore({name:'super-sage-shadow-lab'}).get(`evidence/${decisionId}/${owner}`);
 const focused=await fast.prepareSelectedPair(original.frozenEvidence,selection,{capturedAt:original.capturedAt});
 const fingerprint=hash(JSON.stringify({evidenceHash:focused.evidenceHash,promptHash:hash(sp.SYSTEM),schemaHash:hash(JSON.stringify(sp.schemaFor(focused.packet,{legacyReconsider:true,legacyBlockers:true})))}));
 const legacyKey=newKey.slice(0,newKey.lastIndexOf('/request/'))+`/request/${fingerprint}`;
 data.delete(newKey);data.set(legacyKey,saved);
 const legacy=await review.callback({...args,consentToAnthropic:true});
 assert.equal(legacy.structuredContent.status,'READY',JSON.stringify(legacy));assert.equal(providerCalls,1);assert.equal(writes,countWrites);
 const invalidSaved={...saved,status:'INVALID',answer:failed,validationErrors:['no_call_without_supported_blocker']};
 data.set(legacyKey,invalidSaved);
 const rejectedRaw=await fast.runFastReview({store:getStore({name:'super-sage-shadow-lab'}),decisionId,ownerHash:owner,selection,savedOnly:true});
 const rejected={structuredContent:{reason:rejectedRaw.status==='INVALID'?'invalid_review':rejectedRaw.error}};
 assert.equal(rejected.structuredContent.reason,'invalid_review');assert.equal(providerCalls,1);assert.equal(writes,countWrites);assert.deepEqual(data.get(legacyKey),invalidSaved);
 const formatFailure={...saved,status:'INVALID',validationErrors:['invalid_sentence_evidence']};
 data.set(legacyKey,formatFailure);
 const stillFailed=await review.callback({...args,consentToAnthropic:true});
 assert.equal(stillFailed.structuredContent.reason,'invalid_review');assert.equal(providerCalls,1);assert.equal(writes,countWrites);assert.deepEqual(data.get(legacyKey),formatFailure);
 const store=getStore({name:'super-sage-shadow-lab'}),read=store.get;
 store.get=async k=>{if(`super-sage-shadow-lab:${k}`===legacyKey)throw Error('synthetic cache read failure');return read(k);};
 const readFailure=await review.callback({...args,consentToAnthropic:true});
 assert.equal(readFailure.structuredContent.reason,'legacy_review_read_failed');assert.equal(providerCalls,1);assert.equal(writes,countWrites);
 store.get=read;
 data.delete(legacyKey);mode='invalid';
 const invalid=await review.callback({...args,consentToAnthropic:true});
 assert.equal(invalid.structuredContent.reason,'invalid_review');assert.equal(invalid.isError,true);assert.equal(providerCalls,2);
 assert.doesNotMatch(invalid.content[0].text,/Rookie leans/,'invalid opinion is never promoted');
 console.log('PASS: synthetic Barkley/Allen actual lineup → consent → strict provider schema → validated customer answer; invalid response rejection, deduplication, preserved v2 history and unchanged evidence. Two mocked provider calls; no live data.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{
 Module._load=originalLoad;global.fetch=oldFetch;
 for(const [key,value]of [['SUPER_SAGE_REVIEWER_PEEPHOLE',oldGate],['ANTHROPIC_API_KEY',oldKey]])if(value===undefined)delete process.env[key];else process.env[key]=value;
});
