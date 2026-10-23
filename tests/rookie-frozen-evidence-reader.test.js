'use strict';
const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {readOwnedFrozenEvidence:read}=require('../netlify/functions/_rookie-frozen-evidence-reader');
const hash=s=>createHash('sha256').update(s).digest('hex'),decisionId='a'.repeat(64),ownerHash=hash('owner-a');
const packet={version:'rookie-independent-v2',request:{season:2026,week:7,scoring:'half'},players:[{playerId:'P1',name:'Fixture Receiver',position:'WR',facts:[{field:'establishedRole',value:{postChange:{gameIDs:['20261011_IND@PIT','20261018_PIT@TB'],gamesSampled:2,sampleSize:'limited',provisional:true,confidenceCap:'Moderate',workloadGrowthValidated:false}}}]}],slots:[{slotId:'S1',eligiblePositions:['WR'],candidateIds:['P1']}]};
const frozenEvidence={packet,evidenceHash:hash(JSON.stringify(packet))};
const saved={ownerHash,capturedAt:'2026-10-23T04:12:00Z',frozenEvidence:{...frozenEvidence,unexpectedEnvelopeSecret:'never-return'},credentials:'never-return',storageKey:'never-return'};
let reads=[],writes=0,source=saved;
const store={get:async key=>{reads.push(key);return source;},setJSON:()=>{writes++;throw Error('No writes');},list:()=>{throw Error('No listing');}};
(async()=>{
 const before=JSON.stringify(saved),result=await read({store,decisionId,ownerHash});
 assert(result.available);assert.deepEqual(result.frozenEvidence,frozenEvidence);assert.equal(result.capturedAt,saved.capturedAt);assert.equal(hash(JSON.stringify(result.frozenEvidence.packet)),result.frozenEvidence.evidenceHash);
 assert.deepEqual(reads,[`evidence/${decisionId}/${ownerHash}`]);assert.equal(JSON.stringify(saved),before);assert(!JSON.stringify(result).includes(ownerHash));assert(!JSON.stringify(result).includes('never-return'));
 for(const invalid of [{decisionId:'../'+'a'.repeat(64),ownerHash},{decisionId,ownerHash:'owner-a'}]){const n=reads.length;assert.equal((await read({store,...invalid})).error,'invalid_request');assert.equal(reads.length,n);}
 for(const value of [null,{...saved,ownerHash:hash('owner-b')}]){source=value;const denied=await read({store,decisionId,ownerHash});assert.equal(denied.error,'owned_frozen_evidence_unavailable');assert(!denied.frozenEvidence);}
 source={...saved,frozenEvidence:{...frozenEvidence,packet:{...packet,request:{week:8}}}};assert.equal((await read({store,decisionId,ownerHash})).error,'evidence_integrity_failure');
 const huge={...packet,extra:'x'.repeat(90001)};source={...saved,frozenEvidence:{packet:huge,evidenceHash:hash(JSON.stringify(huge))}};assert.equal((await read({store,decisionId,ownerHash})).error,'evidence_bounds');
 assert.equal((await read({store:{get:async()=>{throw Error('sensitive store error');}},decisionId,ownerHash})).error,'frozen_evidence_read_failed');assert.equal(writes,0);
 console.log('PASS: owned exact frozen input, hash, bounds, no envelope leakage, invalid/cross-owner/missing/corrupt failure, no fallback/listing/writes.');
})().catch(e=>{console.error(e);process.exitCode=1;});
