'use strict';
const assert=require('node:assert/strict');
const {_test,handler}=require('../netlify/functions/tank01-reserve-audit');
const NOW=Date.parse('2026-10-19T03:00:00Z');
function memory(){const m=new Map();return {get:async k=>m.get(k)||null,setJSON:async(k,v,o={})=>{if(o.onlyIfNew&&m.has(k))return{modified:false};m.set(k,v);return{modified:true};}};}
(async()=>{
 assert.equal((await handler({httpMethod:'POST',headers:{}})).statusCode,401);
 const store=memory();let reservations=0,calls=0;
 const opts={store,now:NOW,apiKey:'fixture-key',reserve:async()=>{reservations++;return{allowed:true};},fetchImpl:async url=>{calls++;const endpoint=new URL(url).pathname;return{ok:true,json:async()=>({statusCode:200,body:endpoint.endsWith('getNFLTeams')?Array.from({length:32},(_,i)=>({teamAbv:String(i),Roster:{}})):{longName:new URL(url).searchParams.get('playerName'),team:'WRONG',injury:{designation:'IR',description:'fixture-key'},secret:'excluded'}})};}};
 const results=await Promise.all([_test.audit(opts),_test.audit(opts)]);
 const saved=await _test.audit({...opts,now:NOW+86400000});
 assert.equal(reservations,1);assert.equal(calls,5);assert.equal(saved.callsUsed,5);assert.equal(saved.status,'COMPLETE');assert.equal(saved.players.at(-1).error,'CALL_LIMIT');assert(saved.players[0].identityMatches.every(x=>!x));assert(!JSON.stringify(saved).includes('fixture-key'));assert(!JSON.stringify(saved).includes('excluded'));
 const blocked=await _test.audit({...opts,store:memory(),reserve:async()=>({allowed:false,reason:'kill-switch'}),fetchImpl:()=>{throw Error('must not call');}});assert.equal(blocked.status,'BUDGET_BLOCKED');assert.equal(blocked.callsUsed,0);
 const failedStore=memory();let failures=0;const failedOpts={...opts,store:failedStore,fetchImpl:async()=>{failures++;throw Error('fixture-key');}};const failed=await _test.audit(failedOpts);assert.equal(failed.status,'FAILED');await _test.audit({...failedOpts,now:NOW+86400000});assert.equal(failures,1,'provider failures never create retries or a next-day allowance');assert(!JSON.stringify(failed).includes('fixture-key'));
 assert.equal((await _test.audit({...opts,store:memory(),now:Date.parse('2026-10-22')})).status,'EXPIRED');
 assert.equal((await _test.audit({...opts,store:memory(),apiKey:undefined})).status,'UNAVAILABLE');
 console.log('PASS: authenticated, fixed-input, globally single-use five-call audit; budget denial, expiry, redaction, identity diagnostics and no retries.');
})().catch(e=>{console.error(e);process.exitCode=1;});
