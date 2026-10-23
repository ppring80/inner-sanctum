'use strict';
const {createHash}=require('node:crypto');
const hash=value=>createHash('sha256').update(value).digest('hex');
// Read the existing owner's immutable input. No provider, budget, queue,
// history write, latest-data fallback, repair or packet reconstruction.
async function readOwnedFrozenEvidence({store,decisionId,ownerHash}){
 const base={available:false,readOnly:true,decisionId};
 if(!/^[a-f0-9]{64}$/.test(decisionId||'')||!/^[a-f0-9]{64}$/.test(ownerHash||''))return {...base,error:'invalid_request'};
 try{
  const saved=await store.get(`evidence/${decisionId}/${ownerHash}`,{type:'json'});
  if(!saved||saved.ownerHash!==ownerHash||!saved.frozenEvidence)return {...base,error:'owned_frozen_evidence_unavailable'};
  const {packet,evidenceHash}=saved.frozenEvidence;
  if(!packet||typeof packet!=='object'||Array.isArray(packet))return {...base,error:'evidence_integrity_failure'};
  const serialized=JSON.stringify(packet);
  if(typeof evidenceHash!=='string'||hash(serialized)!==evidenceHash)return {...base,error:'evidence_integrity_failure'};
  // Producer bounds; reject rather than truncate an immutable packet.
  if(serialized.length>90000||!Array.isArray(packet.players)||!packet.players.length||packet.players.length>40||!Array.isArray(packet.slots)||!packet.slots.length||packet.slots.length>20)return {...base,error:'evidence_bounds'};
  return {...base,available:true,capturedAt:typeof saved.capturedAt==='string'&&Number.isFinite(Date.parse(saved.capturedAt))?saved.capturedAt:null,
   frozenEvidence:{packet:JSON.parse(serialized),evidenceHash}};
 }catch{return {...base,error:'frozen_evidence_read_failed'};}
}
module.exports={readOwnedFrozenEvidence};
