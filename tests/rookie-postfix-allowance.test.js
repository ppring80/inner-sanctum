'use strict';
const assert=require('node:assert/strict');
const {POST_FIX,VERSION,runNextDrill}=require('../netlify/functions/_super-sage-rookie-drill');
const {hash}=require('../netlify/functions/_super-sage-shadow-llm');
// Use an isolated synthetic packet; patch only the hash helper before loading
// the modules to exercise the exact-evidence gate without private league data.
const ownerHash=hash('owned'),packet={request:{},players:['Blake Corum','Saquon Barkley'].map(name=>({name,position:'RB',facts:[{field:'availability',value:{status:'UNKNOWN'}}]}))};
const realHash=require('../netlify/functions/_super-sage-shadow-llm').hash;
require('../netlify/functions/_super-sage-shadow-llm').hash=s=>s===JSON.stringify(packet)?POST_FIX.parentEvidenceHash:realHash(s);
for(const p of ['../netlify/functions/_super-sage-rookie-drill','../netlify/functions/_super-sage-shadow-fast-review'])delete require.cache[require.resolve(p)];
const run=require('../netlify/functions/_super-sage-rookie-drill').runNextDrill;
const evidence={ownerHash,frozenEvidence:{packet,evidenceHash:POST_FIX.parentEvidenceHash}},prior={status:'INVALID',requestId:POST_FIX.requestId,answer:{},validationErrors:['unsupported_floor_comparison']};
const originalKey=`llm-drill/${VERSION}/role-change/${POST_FIX.decisionId}/${ownerHash}`;
const data=new Map([[`evidence/${POST_FIX.decisionId}/${ownerHash}`,evidence],[originalKey,prior],[`llm-drill-budget/${VERSION}/role-change`,{spent:true}]]);
const before=JSON.stringify(prior),frozen=JSON.stringify(evidence);let calls=0;
const store={get:async k=>data.get(k),setJSON:async(k,v,o={})=>{if(o.onlyIfNew&&data.has(k))return{modified:false};data.set(k,v);return{modified:true};}};
const args={decisionId:POST_FIX.decisionId,ownerHash,caseId:'role-change',store,apiKey:'mock',fetchImpl:async(_url,o)=>{calls++;const req=JSON.parse(o.body);assert(req.system.includes('90-120'));assert(!JSON.stringify(req).includes(POST_FIX.requestId),'prior answer is not supplied to Rookie');return{ok:true,json:async()=>({stop_reason:'tool_use',content:[{type:'tool_use',name:'submit_decision',input:{selected:'A',confidence:'LOW',explanationSentences:[{text:'A qualified lean.',factIds:['A:availability']},{text:'Both statuses are unknown.',factIds:['B:availability']},{text:'Check new availability evidence.',factIds:['A:availability']}],caveat:'Availability unknown.',reconsider:'New status reports.'}}]})};}};
(async()=>{
 await Promise.all([run(args),run(args)]);assert.equal(calls,1,'concurrent invocations cannot double spend');
 const cached=await run(args);assert.equal(cached.cached,true);assert.equal(cached.experiment,POST_FIX.caseId);assert.equal(calls,1);
 assert.equal(JSON.stringify(data.get(originalKey)),before);assert.equal(JSON.stringify(evidence),frozen);assert.deepEqual(data.get(`llm-drill-budget/${VERSION}/role-change`),{spent:true});
 assert(data.has(`llm-drill-budget/${VERSION}/${POST_FIX.caseId}`));
 const denied=await run({...args,ownerHash:hash('other')});assert.equal(denied.error,'owned_frozen_evidence_unavailable');assert.equal(calls,1);
 // A changed prior review cannot receive this allowance.
 data.set(originalKey,{...prior,requestId:'different'});await run(args);assert.equal(calls,1);
 console.log('PASS: one separate exact-evidence post-fix allowance, atomic no-double-spend, independent answer, cached reuse, original history/budget preserved. Provider mocked.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{require('../netlify/functions/_super-sage-shadow-llm').hash=realHash;});
