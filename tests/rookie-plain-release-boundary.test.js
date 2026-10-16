'use strict';
const assert=require('node:assert/strict');
const {run}=require('../scripts/run-super-sage-week4-acceptance');
const {hash,buildEvidence}=require('../netlify/functions/_super-sage-shadow-llm');
const {runSecondOpinion,recordKey}=require('../netlify/functions/_rookie-second-opinion-live');
const {toCustomerAnswer}=require('../netlify/functions/_super-sage-lineup-presenters');
const {readSavedReview}=require('../netlify/functions/_rookie-saved-review');
const record=run().record,decisionId=record.decisionId,ownerHash=hash('offline-plain-owner'),frozenEvidence=buildEvidence(record),before=JSON.stringify(record);
function store(){const data=new Map([[recordKey(decisionId,ownerHash),{ownerHash,record,recordHash:hash(before)}],[`evidence/${decisionId}/${ownerHash}`,{ownerHash,frozenEvidence}]]);return{data,get:async k=>data.get(k),setJSON:async(k,v,o={})=>{if(o.onlyIfNew&&data.has(k))return{modified:false};data.set(k,v);return{modified:true};},list:async function*({prefix}){yield {blobs:[...data.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key}))};}};}
let calls=0;
async function invoke(s,reverse=false){return runSecondOpinion({store:s,decisionId,ownerHash,apiKey:'synthetic',fetchImpl:async(url,args)=>{
 calls++;const request=JSON.parse(args.body),packet=JSON.parse(request.messages[0].content);
 assert.equal(packet.presentation,'plain-v1');assert.match(request.system,/Every clause must point toward that reversal/);
 assert.match(request.tools[0].input_schema.properties.reconsider.description,/reverse this lean/);
 assert.equal(packet.players[1].facts.find(f=>f.field==='establishedRole').value.plain,'steady recent role for his position');
 const answer={selected:'B',confidence:'MEDIUM',caveat:'The recent workload is not a forecast.',reconsider:'If Corum earns more targets.',explanationSentences:[
  {text:reverse?'Corum has the higher projection.':'Sutton has the higher projection.',factIds:['A:projection','B:projection']},
  {text:'Sutton has a moderate-volume role for his position.',factIds:['B:establishedRole']},
  {text:'Corum remains the alternative.',factIds:['A:standing']}
 ]};
 return new Response(JSON.stringify({id:'mock-plain',model:'claude-sonnet-4-6',stop_reason:'tool_use',content:[{type:'tool_use',name:'submit_decision',input:answer}]}),{status:200});
 }});}
(async()=>{
 const s=store(),ready=await invoke(s);
 assert.equal(ready.status,'REVIEW_READY');assert.equal(ready.secondOpinion.status,'READY');assert.deepEqual(ready.secondOpinion.softFlags,['report_like_customer_language']);assert.deepEqual(ready.sageAnswer,toCustomerAnswer(record));assert.equal(JSON.stringify(record),before);
 const saved=[...s.data.entries()].find(([k])=>k.includes('/selected/')&&k.includes('/request/'))[1];
 assert.equal(saved.status,'REVIEW_READY');assert.deepEqual(saved.softFlags,['report_like_customer_language']);assert.deepEqual(saved.validationErrors,[]);assert.equal(saved.requestTiming.scope,'THROUGH_VALIDATION_BEFORE_PERSIST');
 const failed=await invoke(store(),true);assert.equal(failed.status,'UNAVAILABLE');assert.ok(failed.review.validationErrors.includes('projection_comparison_reversed'));assert.deepEqual(failed.sageAnswer,toCustomerAnswer(record));
 const read=await readSavedReview({store:s,decisionId,ownerHash,kind:'selected-pairs'});
 assert.equal(read.available,true);assert.equal(read.reviews.length,1);assert.deepEqual(read.reviews[0].softFlags,['report_like_customer_language']);assert.ok(read.reviews[0].providerPhases);assert.ok(read.reviews[0].outgoing.schemaHash);assert.ok(read.reviews[0].requestTiming);
 const json=JSON.stringify(read);assert.equal(json.includes(ownerHash),false);assert.equal(json.includes('frozenEvidence'),false);assert.equal(json.includes('llm-fast/'),false);assert.equal(json.includes('candidateIds'),false);
 assert.equal(calls,2,'only mocked transport');
 console.log('PASS: style-only flag saved and opinion shown; reversed comparison withheld; SAGE unchanged; persisted timing visible through read-only selected-pair listing. Two mocked calls, no live spend.');
})().catch(e=>{console.error(e);process.exitCode=1;});
