"use strict";
// One CAS-fenced state object: no late writer can resurrect a cleaned snapshot.
const crypto=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const {cases}=require('./synthetic-fixture');
const STORE='espn-synthetic-acceptance-332',KEY='session';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const failure=category=>({ok:false,errorCategory:category});
function create({store,expected,canonical,assertions,now=()=>Date.now(),nonce=()=>crypto.randomBytes(32).toString('hex')}){
 const read=()=>store().getWithMetadata(KEY,{type:'json'});
 async function write(value,etag){const r=await store().setJSON(KEY,value,etag?{onlyIfMatch:etag}:{onlyIfNew:true});if(!r.modified)throw Error('conflict');}
 function scrubTimes(value){const x=JSON.parse(JSON.stringify(value));delete x.connectedAt;delete x.syncedAt;if(x.meta)delete x.meta.capturedAt;if(x.espnLineupSource)delete x.espnLineupSource.capturedAt;return x;}
 function valid(input,caseId){
  if(!cases.some(c=>c[0]===caseId)||!input||!expected[caseId])return false;
  // Every non-time field must exactly match the reviewed fixture, including nested fields.
  if(!isDeepStrictEqual(scrubTimes(input),scrubTimes(expected[caseId])))return false;
  for(const t of [input.connectedAt,input.syncedAt,input.meta?.capturedAt,input.espnLineupSource?.capturedAt])if(t!==null&&t!==undefined&&(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(t)||!Number.isFinite(Date.parse(t))))return false;
  if(input.meta?.capturedAt!==input.espnLineupSource?.capturedAt)return false;
  return caseId==='synthetic-b'?input.meta?.capturedAt===null:typeof input.meta?.capturedAt==='string';
 }
 return {
 async begin(){try{const r=await read();if(r&&r.data.state!=='CLEAN')return failure('CLEANUP_REQUIRED');const token=nonce();await write({state:'OPEN',tokenHash:hash(token),expiresAt:now()+600000,cases:{}},r?.etag);return{ok:true,token};}catch{return failure('STORAGE_FAILED');}},
 async upload(token,caseId,input){try{const r=await read();if(!r||r.data.state!=='OPEN'||r.data.expiresAt<=now()||r.data.tokenHash!==hash(token||''))return failure('UNAUTHORIZED');if(!valid(input,caseId))return failure('FIXTURE_MISMATCH');if(r.data.cases[caseId])return failure('REPLAY');const snapshot=canonical(input);await write({...r.data,cases:{...r.data.cases,[caseId]:{snapshot,capturedAt:input.meta.capturedAt}}},r.etag);return{ok:true};}catch{return failure('STORAGE_FAILED');}},
 async inspect(){try{const r=await read();if(!r||r.data.state!=='OPEN'||cases.some(([id])=>!r.data.cases[id]))return failure('INCOMPLETE');return{ok:true,...assertions(r.data.cases)};}catch{return failure('STORAGE_FAILED');}},
 async cleanup(){try{const r=await read();await write({state:'VERIFY_REQUIRED',cases:{}},r?.etag);for await(const page of store().list({paginate:true}))for(const b of page.blobs)if(b.key!==KEY)await store().delete(b.key);return{ok:true};}catch{return failure('CLEANUP_FAILED');}},
 async verifyAbsent(){try{const r=await read();if(!r||r.data.state!=='VERIFY_REQUIRED'||Object.keys(r.data.cases).length)return failure('CLEANUP_UNVERIFIED');let count=0;for await(const page of store().list({paginate:true}))count+=page.blobs.filter(b=>b.key!==KEY).length;if(count)return failure('UNEXPECTED_OBJECTS');await write({state:'CLEAN',cases:{}},r.etag);return{ok:true,absent:true};}catch{return failure('CLEANUP_UNVERIFIED');}}
 };
}
module.exports={create,STORE,KEY};
