'use strict';
const assert=require('node:assert/strict');const llm=require('../netlify/functions/_super-sage-shadow-llm');
const {POST241,POST238_WARM,VERSION,STREAM_DIAGNOSTIC,POST246,ROLE_SYSTEM}=require('../netlify/functions/_super-sage-shadow-fast-review');const hash=llm.hash;
const packet = {request:{},players:[
 {name:'Blake Corum',position:'RB',facts:[{field:'availability',value:{effectiveStatus:{status:'ACTIVE'},unavailable:false}},{field:'backfieldContext',value:{team:'LAR',roleOrderVerified:false,players:[{name:'Kyren Williams',sourceOrder:1},{name:'Blake Corum',sourceOrder:2}]}}]},
 {name:'Will Shipley',position:'RB',facts:[{field:'availability',value:{effectiveStatus:{status:'ACTIVE'},unavailable:false}},{field:'backfieldContext',value:{team:'PHI',reportedRoles:{candidateListedRank:3,players:[{name:'Will Shipley',listedRank:3,status:'UNKNOWN'}]}}}]}
]};
assert.equal(hash(ROLE_SYSTEM), POST246.promptHash);
// Simulate the recorded historical prompt only for transport/history regression.
llm.hash = value => value === JSON.stringify(packet) ? POST241.parentEvidenceHash : hash(value);
delete require.cache[require.resolve('../netlify/functions/_super-sage-shadow-fast-review')];
const {runFastReview} = require('../netlify/functions/_super-sage-shadow-fast-review');
const ownerHash=hash('owner'),decisionId=POST241.decisionId;
const evidence={ownerHash,frozenEvidence:{packet,evidenceHash:POST241.parentEvidenceHash}};
const priorKey=`llm-drill/${VERSION}/${STREAM_DIAGNOSTIC.caseId}/${decisionId}/${ownerHash}`;
const prior={status:'INVALID',requestId:POST246.priorRequestId,parentEvidenceHash:POST241.parentEvidenceHash,promptHash:POST241.promptHash,rawText:'original'};
const initial=[[`evidence/${decisionId}/${ownerHash}`,evidence],[priorKey,prior],['llm-fast-budget/2026-10-10',{spent:true}],[`llm-drill-budget/${VERSION}/${STREAM_DIAGNOSTIC.caseId}`,{spent:true}]];
const data=new Map(initial),before=JSON.stringify(initial);
const store={get:async k=>data.get(k),setJSON:async(k,v,o={})=>{if(o.onlyIfNew&&data.has(k))return{modified:false};data.set(k,v);return{modified:true}}};

const {queueQualification:queueDiagnostic,executeQualification:executeDiagnostic,reviewKey}=require('../netlify/functions/_rookie-post246-qualification');
let queuedCalls=0,providerCalls=0;const ownerArgs={store,ownerHash,decisionId,apiKey:'mock'};
const queueArgs={...ownerArgs,fetchImpl:async(url,o)=>{queuedCalls++;assert.equal(url,'https://theinnersanctum.xyz/.netlify/functions/super-sage-rookie-review-background');assert(llm.verifyJob(o.body,o.headers['x-rookie-signature'],'mock'));assert.equal(JSON.parse(o.body).mode,POST246.caseId);return{status:202};}};
const payload={selected:'B',confidence:'MEDIUM',statusSentence:{playerId:'B',text:'Shipley has UNKNOWN chart status despite ACTIVE availability.',factIds:['B:availability','B:backfieldContext']},explanationSentences:[{text:"I'd start Shipley, but his health is unknown.",factIds:['B:availability','B:backfieldContext']},{text:'Corum has no verified Rams depth order.',factIds:['A:backfieldContext']}],caveat:'Health is not confirmed.',reconsider:'New pregame role reports.'};
const events=[{type:'message_start',message:{id:'msg_diagnostic1',model:'claude-sonnet-4-6',usage:{input_tokens:4500}}},{type:'content_block_start',index:0,content_block:{type:'tool_use',name:'submit_decision'}},{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify(payload)}},{type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:450}},{type:'message_stop'}];
const workerArgs={...ownerArgs,fetchImpl:async(_url,o)=>{providerCalls++;const body=JSON.parse(o.body);assert.equal(body.stream,true);assert.equal(hash(body.system),POST246.promptHash);assert.equal(hash(JSON.stringify(body.tools[0].input_schema)),POST241.schemaHash);assert.equal(body.max_tokens,750);let i=0;return{ok:true,status:200,headers:{get:()=> 'req_diagnostic1'},body:{getReader:()=>({read:async()=> i<events.length?{done:false,value:new TextEncoder().encode('data: '+JSON.stringify(events[i++])+'\n\n')}:{done:true}})}};}};
(async()=>{
 const queued=await Promise.all([queueDiagnostic(queueArgs),queueDiagnostic(queueArgs)]);assert.equal(queuedCalls,1);assert.equal(queued[0].status,'QUEUED');assert.equal(providerCalls,0);
 const completed=await Promise.all([executeDiagnostic(workerArgs),executeDiagnostic(workerArgs)]);assert.equal(providerCalls,1);
 const saved=data.get(reviewKey(decisionId,ownerHash));assert.equal(saved.diagnosticOnly,true);assert.equal(saved.customerEligible,false);assert.equal(saved.modelDeadlineMs,20000);assert.equal(saved.providerPhases.transport,'stream');assert(saved.requestTiming);assert(saved.completedAt);assert.equal(saved.rawText,JSON.stringify(payload));
 const cached=await queueDiagnostic(queueArgs);assert.equal(cached.cached,true);assert.equal(queuedCalls,1);
 assert.equal(JSON.stringify([...data].slice(0,initial.length)),before);
 data.delete(reviewKey(decisionId,ownerHash));await executeDiagnostic(workerArgs);assert.equal(providerCalls,1,'worker redelivery cannot retry spent allowance');
 assert.equal((await executeDiagnostic({...workerArgs,ownerHash:hash('other')})).error,'diagnostic_authorization_mismatch');
 data.set(priorKey,{...prior,promptHash:'changed'});assert.equal((await queueDiagnostic(queueArgs)).error,'diagnostic_authorization_mismatch');assert.equal(queuedCalls,1);
 console.log('Post246 qualification: signed atomic queue, exact prior/owner/evidence/prompt/schema, one provider call, 20-second private qualification result, saved read, no retry or history reset. Provider mocked.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{llm.hash=hash});
