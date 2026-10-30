'use strict';
// Synthetic Corum/Hockenson failure shape. Values are illustrative, not a
// production projection export. All storage and provider traffic are mocked.
const assert=require('node:assert/strict'),Module=require('module');
const sp=require('../netlify/functions/_rookie-structured-pair');
const {hash}=require('../netlify/functions/_super-sage-shadow-llm');
const fast=require('../netlify/functions/_super-sage-shadow-fast-review');
const active={effectiveStatus:{status:'ACTIVE'},unavailable:false,questionable:false};
const player=(id,questionable=false)=>({id,name:id,position:id==='A'?'RB':'TE',facts:[
 ['projection',{admissible:true,points:id==='A'?8:9}],['observedOpportunity',{avgLast3:id==='A'?12:6}],
 ['matchup','Positive'],['availability',{...active,questionable}]
].map(([field,value])=>({field,value,factId:`${id}:${field}`}))});
const packet={players:[player('A'),player('B')],requiredDisclosures:[]};
const failed={selected:'B',confidence:'MEDIUM',decidingFactor:'projection',blocker:'NONE',reconsider:'alternative_cleared'};
assert.equal(sp.schemaFor(packet).properties.reconsider.enum.includes('alternative_cleared'),false,
 'the production failure response must no longer be offered when neither player is questionable');
assert.ok(sp.validate(failed,packet).includes('reconsider_not_reversal'));
for(const selected of ['A','B'])for(const reconsider of ['pick_ruled_out','alternative_more_work_confirmed']){
 const answer={...failed,selected,decidingFactor:selected==='A'?'recentUsage':'projection',reconsider};
 assert.deepEqual(sp.validate(answer,packet),[]);
 assert.ok(sp.render(answer,packet).reconsider);
}
for(const q of [0,1]){
 const p={...packet,players:[player('A',q===0),player('B',q===1)]};
 assert.ok(sp.schemaFor(p).properties.reconsider.enum.includes('alternative_cleared'));
 const selected=q===0?'B':'A';
 const answer={...failed,selected,decidingFactor:selected==='A'?'recentUsage':'projection'};
 assert.deepEqual(sp.validate(answer,p),[],'clearance still allowed for a questionable alternative');
 assert.ok(sp.validate({...answer,selected:q===0?'A':'B'},p).includes('reconsider_not_reversal'),
 'clearance of an already active alternative remains invalid');
}
assert.ok(sp.schemaFor(packet,{legacyReconsider:true}).properties.reconsider.enum.includes('alternative_cleared'));

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
const rows=[{name:'Blake Corum',position:'RB',team:'LAR',rank:30,recommendation:'FLEX',projectedPoints:8},
 {name:'T.J. Hockenson',position:'TE',team:'MIN',rank:6,recommendation:'START',projectedPoints:9}];
rows.forEach(r=>{r.projection={source:'synthetic',scoring:'half',week:8,fresh:true};});
global.fetch=async(url,args)=>{
 if(!String(url).includes('anthropic'))return {ok:true,status:200,json:async()=>({positions:{QB:[],RB:[rows[0]],WR:[],TE:[rows[1]],K:[],DEF:[]},metadata:{complete:true}})};
 providerCalls++;const body=JSON.parse(args.body),schema=body.tools[0].input_schema;
 assert.equal(schema.properties.reconsider.enum.includes('alternative_cleared'),false,'actual outgoing strict schema excludes the failure');
 assert.equal(body.tools[0].strict,true);
 const input={...failed,reconsider:mode==='invalid'?'alternative_cleared':'pick_ruled_out'};
 // Injecting a forbidden response simulates a misbehaving provider, not success.
 return new Response(JSON.stringify({id:'mock-reconsider',model:'claude-sonnet-4-6',stop_reason:'tool_use',content:[{type:'tool_use',name:'submit_decision',input}]}),{status:200});
};
(async()=>{
 process.env.SUPER_SAGE_REVIEWER_PEEPHOLE='true';process.env.ANTHROPIC_API_KEY='synthetic-test-key';
 // Optional absolute path exercises the extracted Netlify function package.
 const {buildServer}=require(process.argv[2]||'../netlify/functions/chatgpt-mcp')._test;
 const snapshot={provider:'cbs',scoringFormat:'half-ppr',league:{season:2026,teamCount:12},roster:rows.map(r=>({...r,status:'A'})),settings:{lineupSlots:[{slot:'FLEX',count:1}]}};
 const server=buildServer(new Request('https://fixture.invalid/.netlify/functions/chatgpt-mcp'),{snapshot,snapshotKey:'synthetic-reconsider-owner'});
 const lineup=await server.tools.get_lineup_recommendation.callback({season:2026,week:8});
 assert.notEqual(lineup.isError,true,JSON.stringify(lineup));
 const decisionId=lineup.structuredContent.superSage.decisionId;
 const before=JSON.stringify([...data].filter(([k])=>k.includes('evidence/')||k.includes('rookie-decision/')));
 const args={decisionId,players:rows.map(r=>r.name),consentToAnthropic:false};
 const review=server.tools.request_rookie_second_opinion;
 const denied=await review.callback(args);assert.equal(denied.structuredContent.reason,'provider_consent_required');assert.equal(providerCalls,0);
 const result=await review.callback({...args,consentToAnthropic:true});
 assert.equal(result.structuredContent.status,'READY',JSON.stringify(result));
 assert.match(result.content[0].text,/Rookie leans T.J. Hockenson/);
 assert.match(result.content[0].text,/Would switch if T.J. Hockenson is ruled out/);
 assert.equal(result.structuredContent.lineupChanged,false);assert.equal(providerCalls,1);
 const countWrites=writes;const repeated=await review.callback({...args,consentToAnthropic:true});
 assert.equal(repeated.structuredContent.timing.cached,true);assert.equal(providerCalls,1);assert.equal(writes,countWrites);
 assert.equal(JSON.stringify([...data].filter(([k])=>k.includes('evidence/')||k.includes('rookie-decision/'))),before);

 // Reproduce the previous v2 cache key; accepted history remains available and
 // rejected history stays rejected without another reservation/provider call.
 const entry=[...data].find(([k])=>k.includes('llm-fast/')&&k.includes('/request/'));
 assert.ok(entry);const [newKey,saved]=entry;
 const selection={players:args.players,slotId:result.structuredContent.opinion.slotId};
 const owner=hash('synthetic-reconsider-owner');
 const original=await getStore({name:'super-sage-shadow-lab'}).get(`evidence/${decisionId}/${owner}`);
 const focused=await fast.prepareSelectedPair(original.frozenEvidence,selection,{capturedAt:original.capturedAt});
 const fingerprint=hash(JSON.stringify({evidenceHash:focused.evidenceHash,promptHash:hash(sp.SYSTEM),schemaHash:hash(JSON.stringify(sp.schemaFor(focused.packet,{legacyReconsider:true})))}));
 const legacyKey=newKey.slice(0,newKey.lastIndexOf('/request/'))+`/request/${fingerprint}`;
 data.delete(newKey);data.set(legacyKey,saved);
 const legacy=await review.callback({...args,consentToAnthropic:true});
 assert.equal(legacy.structuredContent.status,'READY',JSON.stringify(legacy));assert.equal(providerCalls,1);assert.equal(writes,countWrites);
 const invalidSaved={...saved,status:'INVALID',answer:failed,validationErrors:['reconsider_not_reversal']};
 data.set(legacyKey,invalidSaved);
 const rejected=await review.callback({...args,consentToAnthropic:true});
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
 console.log('PASS: synthetic Corum/Hockenson actual lineup → consent → strict provider schema → validated customer answer; invalid response rejection, deduplication, preserved v2 history and unchanged evidence. Two mocked provider calls; no live data.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{
 Module._load=originalLoad;global.fetch=oldFetch;
 for(const [key,value]of [['SUPER_SAGE_REVIEWER_PEEPHOLE',oldGate],['ANTHROPIC_API_KEY',oldKey]])if(value===undefined)delete process.env[key];else process.env[key]=value;
});
