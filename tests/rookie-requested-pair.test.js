'use strict';
const assert=require('node:assert/strict');
const {run}=require('../scripts/run-super-sage-week4-acceptance');
const {hash,buildEvidence}=require('../netlify/functions/_super-sage-shadow-llm');
const {recordKey}=require('../netlify/functions/_rookie-second-opinion-live');
const {currentKey,offer,requestPair}=require('../netlify/functions/_rookie-requested-pair');
const {toCustomerAnswer}=require('../netlify/functions/_super-sage-lineup-presenters');
// Keep the real frozen facts, explicitly mark slots decided: this is the user
// requirement that the saved-only unresolved release could not satisfy.
const record=JSON.parse(JSON.stringify(run().record));record.slots.forEach(s=>s.decisionState='DECIDED');
const before=JSON.stringify(record),customer=toCustomerAnswer(record),decisionId=record.decisionId,ownerHash=hash('explicit-pair-owner'),recordHash=hash(before),frozen=buildEvidence(record);
function fixture(){const data=new Map([[recordKey(decisionId,ownerHash),{ownerHash,record,recordHash}],[`evidence/${decisionId}/${ownerHash}`,{ownerHash,frozenEvidence:frozen,capturedAt:'2026-10-15T01:00:00Z'}],[currentKey(ownerHash),{inputSource:'linked_league',decisionId,recordHash}]]);let writes=0;return{data,get:async k=>data.get(k),setJSON:async(k,v,o={})=>{writes++;if(o.onlyIfNew&&data.has(k))return{modified:false};data.set(k,v);return{modified:true};},get writes(){return writes;}};}
let calls=0;
const fetchImpl=async(_url,args)=>{calls++;const body=JSON.parse(args.body);assert.equal(body.tools[0].input_schema.properties.selected.type,'string');assert.match(body.system,/Do not generate prose/);return new Response(JSON.stringify({id:'mock-requested-pair',stop_reason:'tool_use',content:[{type:'tool_use',name:'submit_decision',input:{selected:'B',confidence:'MEDIUM',decidingFactor:'projection',tradeoffFactor:'recentUsage',blocker:'NONE',reconsider:'pick_ruled_out'}}]}),{status:200});};
(async()=>{
 const store=fixture(),args={store,decisionId,ownerHash,players:['Blake Corum','Courtland Sutton'],consentToAnthropic:true,apiKey:'mock',fetchImpl};
 const ready=await requestPair(args);assert.equal(ready.status,'READY',JSON.stringify(ready));assert.equal(ready.opinion.lean,'Courtland Sutton');assert.equal(ready.lineupChanged,false);assert.equal(calls,1);assert.match(ready.opinion.reconsider,/Would switch if Courtland Sutton is ruled out/);assert.equal(ready.timing.cached,false);
 const writes=store.writes,cached=await requestPair(args);assert.equal(cached.status,'READY');assert.equal(cached.timing.cached,true);assert.equal(cached.timing.providerMs,0);assert.equal(calls,1);assert.equal(store.writes,writes,'duplicate request reuses saved result');
 assert.deepEqual(toCustomerAnswer(record),customer);assert.equal(JSON.stringify(record),before);
 assert.ok(offer(record).text.includes('with your permission'));assert.match(offer(record).text,/Ask “Rookie,/);assert.equal(offer({slots:[]}),null);
 const noRead={get:async()=>{throw Error('must not read before consent');}};assert.equal((await requestPair({...args,store:noRead,consentToAnthropic:false})).reason,'provider_consent_required');
 for(const changes of [{players:['Blake Corum','Blake Corum']},{players:['Blake Corum','Invented Player']},{players:['Patrick Mahomes','Courtland Sutton']},{ownerHash:hash('other-owner')}]){const result=await requestPair({...args,...changes});assert.equal(result.status,'UNAVAILABLE');}
 const stale=fixture();stale.data.set(currentKey(ownerHash),{decisionId:'f'.repeat(64),recordHash});assert.equal((await requestPair({...args,store:stale})).reason,'decision_not_current');assert.equal(stale.writes,0);
 const failed=fixture();const failure=await requestPair({...args,store:failed,fetchImpl:async()=>{const e=Error('timeout');e.name='TimeoutError';throw e;}});assert.equal(failure.status,'UNAVAILABLE');assert.equal(failure.lineupChanged,false);
 const limited=fixture();const day=new Date('2026-10-18T01:00:00Z');for(const k of require('../netlify/functions/_super-sage-shadow-fast-review').selectedBudgetKeys(day))limited.data.set(k,{existing:true});const limit=await requestPair({...args,store:limited,now:day,fetchImpl:async()=>{throw Error('must not spend beyond existing cap');}});assert.equal(limit.reason,'daily_speed_benchmark_limit');
 const output=JSON.stringify(ready);for(const hidden of [ownerHash,'rawContent','rawText','candidateIds','llm-fast/','frozenEvidence'])assert.equal(output.includes(hidden),false);
 assert.equal(calls,1);console.log('PASS: explicit pair works on DECIDED slots with unchanged SAGE; existing cache/budget, consent, current owner/record, eligibility, timeout and private output boundaries. One mocked provider call.');
})().catch(e=>{console.error(e);process.exitCode=1;});
