'use strict';
const assert = require('assert');
const {connectLambda,getStore}=require('@netlify/blobs');
const {reserveTank01Calls}=require('../netlify/functions/_tank01-daily-budget');

async function main(){
  connectLambda({blobs:Buffer.from(JSON.stringify({url:'https://blobs.example.test',token:'test-only-token'})).toString('base64'),headers:{'x-nf-site-id':'test-site','x-nf-deploy-id':'test-deploy'}});
  let ledger=null,version=0,requests=0;
  const store=getStore({name:'tank01-lambda-test',fetch:async(url,options={})=>{
    requests++;
    const method=(options.method||'GET').toUpperCase();
    if(method==='GET')return ledger?new Response(JSON.stringify(ledger),{status:200,headers:{etag:'"'+version+'"'}}):new Response(null,{status:404});
    const headers=new Headers(options.headers);
    if((headers.get('if-none-match')==='*'&&ledger)||(headers.get('if-match')&&headers.get('if-match')!=='"'+version+'"'))return new Response(null,{status:412});
    ledger=JSON.parse(options.body);version++;
    return new Response(null,{status:200,headers:{etag:'"'+version+'"'}});
  }});
  await assert.rejects(()=>store.getWithMetadata('test',{type:'json',consistency:'strong'}),error=>error.name==='BlobsConsistencyError','the actual Lambda adapter cannot perform strong reads');
  assert.equal(requests,0,'strong reads fail before contacting storage');
  const result=await reserveTank01Calls({}, {job:'runtime-test',calls:101},{store,limit:200,normalLimit:200,now:new Date('2026-09-30T05:00:00Z')});
  assert.equal(result.allowed,true,'budget must work with the real Lambda SDK adapter');
  assert.equal(ledger.reserved,101);
  const over=await reserveTank01Calls({}, {job:'over-budget',calls:129},{store,limit:200,normalLimit:200,now:new Date('2026-09-30T05:00:01Z')});
  assert.equal(over.allowed,false);assert.equal(ledger.reserved,101);
  // A permanently stale edge read cannot reserve against a newer server ETag.
  const stale={getWithMetadata:async()=>({data:{reserved:0,normalReserved:0},etag:'old'}),setJSON:async()=>({modified:false})};
  const blocked=await reserveTank01Calls({}, {job:'stale',calls:101},{store:stale,limit:200,normalLimit:200,now:new Date('2026-09-30T05:00:02Z')});
  assert.equal(blocked.allowed,false);assert.equal(blocked.reason,'reservation-contention');
  console.log('Actual Netlify Lambda SDK budget integration and stale-read CAS protection passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1});
