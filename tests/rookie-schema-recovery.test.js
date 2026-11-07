'use strict';
// Actual MCP customer path, synthetic Barkley/Allen facts, mocked stores/model.
const assert=require('node:assert/strict'),Module=require('module');
const sp=require('../netlify/functions/_rookie-structured-pair');
const fast=require('../netlify/functions/_super-sage-shadow-fast-review');
const {hash}=require('../netlify/functions/_super-sage-shadow-llm');
const data=new Map(),stores=new Map();let calls=0,writes=0,mode='valid';
const getStore=({name})=>{
 if(!stores.has(name))stores.set(name,{get:async k=>data.get(`${name}:${k}`),setJSON:async(k,v,o={})=>{
  const key=`${name}:${k}`;if(o.onlyIfNew&&data.has(key))return{modified:false};
  writes++;data.set(key,v);return{modified:true};
 }});return stores.get(name);
};
const originalLoad=Module._load,oldFetch=global.fetch;
const oldGate=process.env.SUPER_SAGE_REVIEWER_PEEPHOLE,oldApiKey=process.env.ANTHROPIC_API_KEY;
Module._load=function(name,parent,isMain){
 if(name==='@netlify/blobs')return{getStore};
 if(name==='@modelcontextprotocol/server')return{createMcpHandler:()=>{},McpServer:class{constructor(){this.tools={};}registerTool(name,options,callback){this.tools[name]={options,callback};}}};
 return originalLoad.call(this,name,parent,isMain);
};
const rows=[{name:'Saquon Barkley',position:'RB',team:'PHI',rank:22,recommendation:'START',projectedPoints:11.35},
 {name:'Keenan Allen',position:'WR',team:'IND',rank:27,recommendation:'FLEX',projectedPoints:9.3}];
rows.forEach(r=>r.projection={source:'synthetic',scoring:'half',week:9,fresh:true});
const rejected={selected:null,confidence:'LOW',decidingFactor:'NONE',blocker:'conflicting_evidence',reconsider:'evidence_resolves_blocker'};
global.fetch=async(url,args)=>{
 if(!String(url).includes('anthropic'))return{ok:true,status:200,json:async()=>({positions:{QB:[],RB:[rows[0]],WR:[rows[1]],TE:[],K:[],DEF:[]},metadata:{complete:true}})};
 calls++;const body=JSON.parse(args.body),schema=body.tools[0].input_schema;
 assert.equal(body.tools[0].strict,true);assert.equal(schema.anyOf,undefined);assert.deepEqual(schema.required,['decision']);assert.ok(schema.properties.decision.anyOf.length);
 assert.ok(schema.properties.decision.anyOf.every(b=>!b.properties.blocker.enum.includes('conflicting_evidence')));
 const input=mode==='valid'?{selected:'A',confidence:'LOW',decidingFactor:'projection',blocker:'NONE',reconsider:'pick_ruled_out'}:{...rejected,selected:'NO_CALL'};
 return new Response(JSON.stringify({id:`mock-recovery-${calls}`,model:body.model,stop_reason:'tool_use',content:[{type:'tool_use',name:'submit_decision',input:{decision:input}}]}),{status:200});
};
(async()=>{
 process.env.SUPER_SAGE_REVIEWER_PEEPHOLE='true';process.env.ANTHROPIC_API_KEY='synthetic';
 const {buildServer}=require(process.argv[2]||'../netlify/functions/chatgpt-mcp')._test;
 const store=getStore({name:'super-sage-shadow-lab'});
 const snapshot={provider:'cbs',scoringFormat:'half-ppr',league:{season:2026,teamCount:12},roster:rows.map(r=>({...r,status:'A'})),settings:{lineupSlots:[{slot:'FLEX',count:1}]}};
 const server=buildServer(new Request('https://fixture.invalid/.netlify/functions/chatgpt-mcp'),{snapshot,snapshotKey:'synthetic-recovery-owner'});
 const lineup=await server.tools.get_lineup_recommendation.callback({season:2026,week:9});
 const decisionId=lineup.structuredContent.superSage.decisionId,ownerHash=hash('synthetic-recovery-owner');
 const frozen=await store.get(`evidence/${decisionId}/${ownerHash}`);
 const selection={players:rows.map(r=>r.name),slotId:frozen.frozenEvidence.packet.slots[0].slotId};
 const focused=await fast.prepareSelectedPair(frozen.frozenEvidence,selection,{capturedAt:frozen.capturedAt});
 const prefix=`llm-fast/${fast.VERSION}/${decisionId}/${ownerHash}/selected/${hash(JSON.stringify(selection))}`;
 const requestKey=schema=>`${prefix}/request/${hash(JSON.stringify({evidenceHash:focused.evidenceHash,promptHash:hash(sp.SYSTEM),schemaHash:hash(JSON.stringify(schema))}))}`;
 const legacyKey=requestKey(sp.schemaFor(focused.packet,{legacyBlockers:true}));
 const rootKey=requestKey(sp.requestSchemaFor(focused.packet,{legacyRoot:true}));
 const currentKey=requestKey(sp.requestSchemaFor(focused.packet));
 const legacy={status:'INVALID',decisionId,parentEvidenceHash:frozen.frozenEvidence.evidenceHash,evidenceHash:focused.evidenceHash,
  answer:rejected,validationErrors:['no_call_without_supported_blocker'],requestId:'original-failed-request'};
 data.set(`super-sage-shadow-lab:${legacyKey}`,legacy);
 const rootFailure={...legacy,status:'UNAVAILABLE',answer:undefined,validationErrors:undefined,
  error:'provider_http_400',providerErrorType:'invalid_request_error',
  providerErrorMessage:'tools.0.custom.input_schema: input_schema does not support oneOf, allOf, or anyOf at the top level',
  requestId:'root-rejected-request'};
 data.set(`super-sage-shadow-lab:${rootKey}`,rootFailure);
 const original=JSON.stringify(legacy),beforeFrozen=JSON.stringify(frozen);
 // An ordinary saved read cannot generate or repair; lack of consent stops first.
 const read=await fast.runFastReview({store,decisionId,ownerHash,selection,savedOnly:true});
 assert.equal(read.status,'UNAVAILABLE');assert.equal(read.error,'provider_http_400');assert.equal(calls,0);
 const review=server.tools.request_rookie_second_opinion,args={decisionId,players:selection.players,consentToAnthropic:true};
 const denied=await review.callback({...args,consentToAnthropic:false});
 assert.equal(denied.structuredContent.reason,'provider_consent_required');assert.equal(calls,0);
 const budgetDay=new Date().toISOString().slice(0,10);
 // Original paid attempt still occupies its existing slot. Recovery must use
 // another regular slot, without adding, deleting or resetting a budget key.
 data.set(`super-sage-shadow-lab:llm-fast-budget/${budgetDay}`,{existing:true});
 data.set(`super-sage-shadow-lab:llm-fast-budget/${budgetDay}/selected-slot-2`,{rootRejected:true});
 const result=await review.callback(args);
 assert.equal(result.structuredContent.status,'READY',JSON.stringify(result));
 assert.match(result.content[0].text,/Rookie leans Saquon Barkley/);
 assert.equal(result.structuredContent.lineupChanged,false);assert.equal(calls,1);
 const saved=await store.get(currentKey);assert.equal(saved.status,'REVIEW_READY');
 assert.equal(saved.recoveryOf.requestId,'root-rejected-request');
 assert.deepEqual(saved.recoveryOf.validationErrors,['root_union_not_supported']);
 assert.deepEqual(await store.get(rootKey),rootFailure);
 assert.equal(JSON.stringify(await store.get(legacyKey)),original);
 assert.equal(JSON.stringify(await store.get(`evidence/${decisionId}/${ownerHash}`)),beforeFrozen);
 const count=writes;const again=await review.callback(args);
 assert.equal(again.structuredContent.timing.cached,true);assert.equal(calls,1);assert.equal(writes,count);
 const budgetKeys=[...data.keys()].filter(k=>k.startsWith(`super-sage-shadow-lab:llm-fast-budget/${budgetDay}`));
 assert.equal(budgetKeys.length,3);assert.ok(budgetKeys.some(k=>k.endsWith('/selected-slot-3')));
 assert.deepEqual(data.get(`super-sage-shadow-lab:llm-fast-budget/${budgetDay}`),{existing:true});
 // Current-contract rejection never triggers a retry, even for explicit calls.
 data.set(`super-sage-shadow-lab:${currentKey}`,{...legacy,requestId:'current-contract-failure'});
 const invalid=await review.callback(args);assert.equal(invalid.structuredContent.reason,'invalid_review');assert.equal(calls,1);
 data.delete(`super-sage-shadow-lab:${currentKey}`);
 // Only the exact recorded API compatibility rejection can recover: a generic
 // 400, authentication error or unrelated bad request must not spend again.
 for(const changes of [{providerErrorMessage:'unrelated bad request'},
   {providerErrorType:'authentication_error'},{error:'provider_http_500'}]){
  data.set(`super-sage-shadow-lab:${rootKey}`,{...rootFailure,...changes});
  const blocked=await review.callback(args);assert.equal(blocked.structuredContent.status,'UNAVAILABLE');assert.equal(calls,1);
 }
 data.delete(`super-sage-shadow-lab:${rootKey}`);
 // Malformed / non-schema failures remain failed, and cache errors fail closed.
 for(const validationErrors of [['invalid_json'],['incomplete_model_response'],['model_deadline_exceeded']]){
  data.set(`super-sage-shadow-lab:${legacyKey}`,{...legacy,validationErrors});
  const result=await review.callback(args);assert.equal(result.structuredContent.reason,'invalid_review');assert.equal(calls,1);
 }
 data.set(`super-sage-shadow-lab:${legacyKey}`,legacy);
 for(const k of fast.selectedBudgetKeys(new Date()))data.set(`super-sage-shadow-lab:${k}`,{existing:true});
 const full=await review.callback(args);assert.equal(full.structuredContent.reason,'daily_speed_benchmark_limit');assert.equal(calls,1);
 assert.equal(await store.get(currentKey),undefined);
 // Release-test concurrency: two consenting requests can consume only one call.
 for(const k of fast.selectedBudgetKeys(new Date()))if(k.includes('selected-slot-'))data.delete(`super-sage-shadow-lab:${k}`);
 const concurrent=await Promise.all([review.callback(args),review.callback(args)]);
 assert.equal(calls,2);assert.ok(concurrent.some(r=>r.structuredContent.status==='READY'));
 assert.equal(JSON.stringify(await store.get(legacyKey)),original);
 // A recovered attempt that fails also stays failed. No retry/reset allowance.
 data.delete(`super-sage-shadow-lab:${currentKey}`);mode='invalid';
 const fails=await review.callback(args);assert.equal(fails.structuredContent.reason,'invalid_review');assert.equal(calls,3);
 await review.callback(args);assert.equal(calls,3);
 console.log('PASS: actual MCP lineup → consent → immutable failed review → bounded corrected-contract review → customer answer; saved reads, deduplication, concurrent reservation, existing budget, failed recovery and source preservation. Three mocked calls; no live data.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{
 Module._load=originalLoad;global.fetch=oldFetch;
 for(const[k,v]of [['SUPER_SAGE_REVIEWER_PEEPHOLE',oldGate],['ANTHROPIC_API_KEY',oldApiKey]])if(v===undefined)delete process.env[k];else process.env[k]=v;
});
