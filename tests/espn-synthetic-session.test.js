"use strict";
const assert=require('node:assert/strict');
const {create,KEY}=require('../acceptance/synthetic-session');
function memory(){let seq=0;const data=new Map();let failDelete=false,failWrite=false;return{data,setFailWrite:v=>failWrite=v,setFailDelete:v=>failDelete=v,getWithMetadata:async k=>data.has(k)?structuredClone(data.get(k)):null,setJSON:async(k,v,o={})=>{if(failWrite)throw Error('SYNTHETIC_SECRET');const old=data.get(k);if(o.onlyIfNew&&old||o.onlyIfMatch&&old?.etag!==o.onlyIfMatch)return{modified:false};data.set(k,{data:structuredClone(v),etag:String(++seq)});return{modified:true};},delete:async k=>{if(failDelete)throw Error('SYNTHETIC_SECRET');data.delete(k);},async *list(){yield{blobs:[...data.keys()].map(key=>({key}))};}};}
async function run(){const store=memory();const input={league:{id:'synthetic'},meta:{capturedAt:'2026-10-22T12:00:00.000Z'},espnLineupSource:{capturedAt:'2026-10-22T12:00:00.000Z'}};let time=0;const setup=()=>create({store:()=>store,expected:{'synthetic-a':input,'synthetic-b':{...input,meta:{capturedAt:null},espnLineupSource:{capturedAt:null}}},canonical:x=>x,assertions:()=>({assertions:{fixed:'PASS'}}),now:()=>time,nonce:()=> 'synthetic-only-cookie'});let s=setup();
assert.equal((await s.upload('', 'synthetic-a',input)).errorCategory,'UNAUTHORIZED');
const started=await s.begin();assert.equal(started.ok,true);
assert.equal((await s.begin()).errorCategory,'CLEANUP_REQUIRED');
for(const bad of [{...input,cookie:'secret'},{...input,league:{id:'production'}},{...input,meta:{...input.meta,authorization:'secret'}}])assert.equal((await s.upload(started.token,'synthetic-a',bad)).errorCategory,'FIXTURE_MISMATCH');
assert.equal((await s.upload(started.token,'synthetic-a',input)).ok,true);
assert.equal((await s.upload(started.token,'synthetic-a',input)).errorCategory,'REPLAY');
const stale=await store.getWithMetadata(KEY); // model a crashed/in-flight invocation
s=setup();assert.equal((await s.begin()).errorCategory,'CLEANUP_REQUIRED');
store.setFailWrite(true);assert.equal((await s.cleanup()).errorCategory,'CLEANUP_FAILED');store.setFailWrite(false);assert.equal((await s.begin()).errorCategory,'CLEANUP_REQUIRED');
assert.equal((await s.cleanup()).ok,true);
assert.equal((await store.setJSON(KEY,stale.data,{onlyIfMatch:stale.etag})).modified,false);
assert.equal((await s.begin()).errorCategory,'CLEANUP_REQUIRED');
assert.equal((await setup().verifyAbsent()).absent,true); // independent instance and fresh read
assert.equal((await s.begin()).ok,true);time=600001;assert.equal((await s.upload(started.token,'synthetic-a',input)).errorCategory,'UNAUTHORIZED');
store.data.set('unexpected',{data:{synthetic:true},etag:'x'});store.setFailDelete(true);assert.equal((await s.cleanup()).errorCategory,'CLEANUP_FAILED');assert.equal((await s.verifyAbsent()).errorCategory,'UNEXPECTED_OBJECTS');assert.equal((await s.begin()).errorCategory,'CLEANUP_REQUIRED');store.setFailDelete(false);assert.equal((await s.cleanup()).ok,true);assert.equal((await setup().verifyAbsent()).absent,true);
console.log('PASS synthetic sessions: strict fixtures, credential rejection, replay/expiry, crash fencing, failed cleanup and independent verification');}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});module.exports={memory};
