'use strict';
const assert=require('node:assert/strict');
const llm=require('../netlify/functions/_super-sage-shadow-llm');
const {POST232,VERSION}=require('../netlify/functions/_super-sage-shadow-fast-review');
const realHash=llm.hash;
const packet={request:{},players:['Blake Corum','Will Shipley'].map(name=>({name,position:'RB',facts:[{field:'availability',value:{status:'UNKNOWN'}}]}))};
llm.hash=s=>s===JSON.stringify(packet)?POST232.parentEvidenceHash:realHash(s);
delete require.cache[require.resolve('../netlify/functions/_super-sage-shadow-fast-review')];
const {runFastReview}=require('../netlify/functions/_super-sage-shadow-fast-review');
const ownerHash=realHash('owned'),decisionId=POST232.decisionId;
const evidence={ownerHash,frozenEvidence:{packet,evidenceHash:POST232.parentEvidenceHash}};
const key=`llm-fast/${VERSION}/${decisionId}/${ownerHash}/fresh-role-change`;
const prior={status:'INVALID',requestId:POST232.requestId,validationErrors:['report_like_customer_language'],answer:{}};
const data=new Map([[`evidence/${decisionId}/${ownerHash}`,evidence],[key,prior],['llm-fast-budget/2026-10-10',{spent:true}]]);
const before=JSON.stringify([...data]);let calls=0;
const store={get:async k=>data.get(k),setJSON:async(k,v,o={})=>{if(o.onlyIfNew&&data.has(k))return{modified:false};data.set(k,v);return{modified:true}}};
const args={store,decisionId,ownerHash,caseId:'role-change',apiKey:'mock',now:new Date('2026-10-10T01:00:00Z'),fetchImpl:async(_url,o)=>{calls++;const req=JSON.parse(o.body);assert.equal(req.max_tokens,750);assert.equal(req.tools[0].strict,true);assert(req.system.includes('Qualitative forecasts are allowed'));assert(!o.body.includes(POST232.requestId));return{ok:true,json:async()=>({id:'post232-mock',stop_reason:'tool_use',content:[{type:'tool_use',name:'submit_decision',input:{selected:'B',confidence:'LOW',explanationSentences:[{text:'I lean toward B.',factIds:['B:availability']},{text:'Availability is unknown.',factIds:['A:availability']},{text:'New reporting could change the choice.',factIds:['B:availability']}],caveat:'Status unknown.',reconsider:'A new status report.'}}]})}}};
(async()=>{
 await Promise.all([runFastReview(args),runFastReview(args)]);assert.equal(calls,1);
 const result=await runFastReview(args);assert.equal(result.cached,true);assert.equal(result.experiment,POST232.caseId);assert.equal(calls,1);
 assert.equal(JSON.stringify([...data].slice(0,3)),before);assert(data.has(`llm-drill-budget/${VERSION}/${POST232.caseId}`));
 assert.equal((await runFastReview({...args,ownerHash:realHash('other')})).error,'owned_frozen_evidence_unavailable');
 data.set(key,{...prior,requestId:'different'});await runFastReview(args);assert.equal(calls,1);
 // Restore exact prior, remove the experiment reservation, leave its spent budget.
 data.set(key,prior);for(const k of data.keys())if(k.startsWith(`llm-drill/${VERSION}/${POST232.caseId}/`))data.delete(k);
 const blocked=await runFastReview(args);assert.equal(blocked.error,'daily_speed_benchmark_limit');assert.equal(calls,1,'spent experiment cannot retry');
 console.log('PASS post232 exact-evidence allowance: one atomic call, cached reuse, old daily budget/history preserved, ownership, no retry. Provider mocked.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{llm.hash=realHash});
