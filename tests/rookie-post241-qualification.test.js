'use strict';
const assert = require('node:assert/strict');
const llm = require('../netlify/functions/_super-sage-shadow-llm');
const { POST241, POST238_WARM, ROLE_SYSTEM, VERSION } = require('../netlify/functions/_super-sage-shadow-fast-review');
const hash = llm.hash;
assert.equal(hash(ROLE_SYSTEM), POST241.promptHash);
const packet = {request:{},players:[
 {name:'Blake Corum',position:'RB',facts:[{field:'availability',value:{status:'ACTIVE'}},{field:'backfieldContext',value:{team:'LAR',roleOrderVerified:false,players:[{name:'Kyren Williams',sourceOrder:1},{name:'Blake Corum',sourceOrder:2}]}}]},
 {name:'Will Shipley',position:'RB',facts:[{field:'availability',value:{status:'ACTIVE'}},{field:'backfieldContext',value:{team:'PHI',reportedRoles:{candidateListedRank:3,players:[{name:'Will Shipley',listedRank:3,status:'UNKNOWN'}]}}}]}
]};
llm.hash = value => value === JSON.stringify(packet) ? POST241.parentEvidenceHash : hash(value);
delete require.cache[require.resolve('../netlify/functions/_super-sage-shadow-fast-review')];
const {runFastReview} = require('../netlify/functions/_super-sage-shadow-fast-review');
const ownerHash=hash('owner'),decisionId=POST241.decisionId;
const evidence={ownerHash,frozenEvidence:{packet,evidenceHash:POST241.parentEvidenceHash}};
const priorKey=`llm-drill/${VERSION}/${POST238_WARM.caseId}/${decisionId}/${ownerHash}`;
const prior={status:'INVALID',requestId:POST241.requestId,parentEvidenceHash:POST241.parentEvidenceHash,promptHash:POST238_WARM.promptHash,rawText:'original'};
const initial=[[`evidence/${decisionId}/${ownerHash}`,evidence],[priorKey,prior],['llm-fast-budget/2026-10-10',{spent:true}],[`llm-drill-budget/${VERSION}/${POST238_WARM.caseId}`,{spent:true}]];
const data=new Map(initial),before=JSON.stringify(initial);
const store={get:async k=>data.get(k),setJSON:async(k,v,o={})=>{if(o.onlyIfNew&&data.has(k))return{modified:false};data.set(k,v);return{modified:true}}};
let calls=0;
const args={store,ownerHash,decisionId,caseId:'role-change',apiKey:'mock',fetchImpl:async(_url,o)=>{
 calls++;const req=JSON.parse(o.body),focused=JSON.parse(req.messages[0].content);
 assert.equal(hash(req.system),POST241.promptHash);assert.equal(hash(JSON.stringify(req.tools[0].input_schema)),POST241.schemaHash);assert.equal(req.model,'claude-sonnet-4-6');assert.equal(req.max_tokens,750);
 assert.deepEqual(req.tools[0].input_schema.properties.statusSentence.properties.playerId.enum,['B']);
 assert.equal(focused.players[0].facts.find(f=>f.field==='backfieldContext').value.sourceType,'PROVIDER_ROSTER_UNORDERED');
 assert.equal(focused.requiredDisclosures.find(d=>d.type==='statusConflict').name,'Will Shipley');
 assert.ok(!o.body.includes(POST241.requestId));
 return{ok:true,json:async()=>({id:'post241-result',stop_reason:'tool_use',content:[{type:'tool_use',name:'submit_decision',input:{selected:'B',confidence:'MEDIUM',statusSentence:{playerId:'B',text:'Shipley has UNKNOWN chart status despite ACTIVE availability.',factIds:['B:availability','B:backfieldContext']},explanationSentences:[{text:"I'd start Shipley, but his health is unknown.",factIds:['B:availability','B:backfieldContext']},{text:'Corum has no verified Rams depth order.',factIds:['A:backfieldContext']}],caveat:'Health is not confirmed.',reconsider:'Confirmed new pregame role reports.'}}]})};
}};
(async()=>{
 await Promise.all([runFastReview(args),runFastReview(args)]);assert.equal(calls,1);
 const saved=await runFastReview(args);assert.equal(saved.cached,true);assert.equal(saved.requestId,'post241-result');assert.equal(calls,1);
 assert.equal(JSON.stringify([...data].slice(0,initial.length)),before);
 assert.equal((await runFastReview({...args,ownerHash:hash('other')})).error,'owned_frozen_evidence_unavailable');
 data.delete(`llm-drill/${VERSION}/${POST241.caseId}/${decisionId}/${ownerHash}`);
 const spent=await runFastReview(args);assert.equal(spent.error,'daily_speed_benchmark_limit');assert.equal(calls,1);
 data.delete(`llm-drill/${VERSION}/${POST241.caseId}/${decisionId}/${ownerHash}`);
 data.set(priorKey,{...prior,requestId:'different'});
 await runFastReview(args);assert.equal(calls,1,'wrong prior cannot spend allowance');
 console.log('Post241: exact evidence/owner/prior/prompt, repaired request, atomic one-call, saved reuse, no retry, no old evidence/history/budget mutation. Provider mocked.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{llm.hash=hash});
