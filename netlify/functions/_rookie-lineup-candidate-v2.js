'use strict';
// Private offline candidate. The consumed v1 qualification and customer paths
// deliberately do not import this module.
const {hash}=require('./_super-sage-shadow-llm');
const v1=require('./_rookie-lineup-candidate');
const clone=v=>JSON.parse(JSON.stringify(v));
const columns={players:['playerId','name','position','facts'],facts:['factId','field','value'],slots:['slotId','slotLabel','eligiblePositions','candidateIds']};
function row(value,keys){
 if(Object.keys(value).join('|')!==keys.join('|'))throw Error('unsupported_evidence_shape');
 return keys.map(k=>value[k]);
}
function object(values,keys){
 if(!Array.isArray(values)||values.length!==keys.length)throw Error('invalid_evidence_row');
 const result={};keys.forEach((k,i)=>Object.defineProperty(result,k,{value:values[i],enumerable:true,writable:true,configurable:true}));return result;
}
function tablePacket(packet){
 const result=clone(packet);
 result.players=result.players.map(p=>row({...p,facts:p.facts.map(f=>row(f,columns.facts))},columns.players));
 result.slots=result.slots.map(s=>row(s,columns.slots));return result;
}
function untables(packet){
 const result=clone(packet);
 result.players=result.players.map(values=>{const p=object(values,columns.players);p.facts=p.facts.map(f=>object(f,columns.facts));return p;});
 result.slots=result.slots.map(values=>object(values,columns.slots));return result;
}
function intern(value){
 const counts=new Map(),dictionary=[],ids=new Map();
 function count(v){const key=JSON.stringify(v);if(key.length>=32)counts.set(key,(counts.get(key)||0)+1);if(v&&typeof v==='object')Object.values(v).forEach(count);}
 count(value);
 function children(v){
  if(Array.isArray(v)){const a=v.map(encode);return v[0]==='@'||v[0]==='!'?['!',...a]:a;}
  if(v&&typeof v==='object'){const o={};for(const [k,x]of Object.entries(v))Object.defineProperty(o,k,{value:encode(x),enumerable:true});return o;}
  return v;
 }
 function encode(v){
  const key=JSON.stringify(v);
  if((counts.get(key)||0)>1){
   if(!ids.has(key)){const id=dictionary.length;ids.set(key,id);dictionary.push(null);dictionary[id]=children(v);}
   return ['@',ids.get(key)];
  }
  return children(v);
 }
 const evidence=encode(value);return {dictionary,evidence};
}
function expand({dictionary,evidence}){
 if(!Array.isArray(dictionary))throw Error('invalid_dictionary');
 const active=new Set(),cached=new Map();
 function decode(v,depth=0){
  if(depth>200)throw Error('evidence_depth_limit');
  if(Array.isArray(v)){
   if(v[0]==='@'){
    const id=v[1];if(v.length!==2||!Number.isInteger(id)||id<0||id>=dictionary.length||active.has(id))throw Error('invalid_evidence_reference');
    if(cached.has(id))return clone(cached.get(id));
    active.add(id);const resolved=decode(dictionary[id],depth+1);active.delete(id);cached.set(id,resolved);return clone(resolved);
   }
   return (v[0]==='!'?v.slice(1):v).map(x=>decode(x,depth+1));
  }
  if(v&&typeof v==='object'){const o={};for(const [k,x]of Object.entries(v))Object.defineProperty(o,k,{value:decode(x,depth+1),enumerable:true,writable:true,configurable:true});return o;}
  return v;
 }
 return decode(evidence);
}
function buildEvidence(frozen){
 if(hash(JSON.stringify(frozen.packet))!==frozen.evidenceHash)throw Error('evidence_integrity_failure');
 const packed=intern(tablePacket(frozen.packet));
 if(hash(JSON.stringify(untables(expand(packed))))!==frozen.evidenceHash)throw Error('lossy_compaction');
 // Original observations, caveats and provenance are all retained. Only verified
 // arithmetic components are added; no rank/projection winner is prescribed.
 const usageComponents=frozen.packet.players.flatMap(p=>{const usage=v1.measurements(p).recentUsage;return usage?.components?[{playerId:p.playerId,factId:usage.factId,...usage.components}]:[];});
 return {format:'rookie-lossless-tables-v2',parentEvidenceHash:frozen.evidenceHash,columns,...packed,usageComponents,requiredAlerts:v1.requiredAlerts(frozen.packet)};
}
const SYSTEM=v1.SYSTEM.replace('Return submit_candidate.','Return submit_candidate_v2.')+' Evidence encoding: columns names the ordered fields in player/fact/slot rows. Each ["@",n] refers to dictionary[n], recursively; ["!",...items] is a literal array with the initial ! removed. All original source records, caveats and uncertainty are retained in these tables. Usage components are arithmetic from the cited original three observed games, never expected workload. Return choices in the exact supplied slot order using p=playerId, c=L/M/H confidence and b=blocker. Explanations stay in decisions: one short sentence each for reason, caveat and reconsider; discuss only meaningful unused alternatives, do not repeat the lineup or evidence packet. Include all required alert IDs and a complete legal contingency for every selected questionable player. Finish every required field.';
function schema(packet){
 const result=v1.schema(packet);delete result.properties.lineup;
 result.required=result.required.map(k=>k==='lineup'?'choices':k);
 result.properties.choices={type:'array',items:{type:'object',additionalProperties:false,required:['p','c','b'],properties:{p:{anyOf:[{type:'string',enum:packet.players.map(p=>p.playerId)},{type:'null'}]},c:{type:'string',enum:['L','M','H']},b:{type:'string'}}}};
 return result;
}
function normalize(answer,packet){
 if(!answer||!Array.isArray(answer.choices)||answer.choices.length!==packet.slots.length)return null;
 return {lineup:answer.choices.map((c,i)=>({slotId:packet.slots[i].slotId,playerId:c?.p,confidence:{L:'LOW',M:'MEDIUM',H:'HIGH'}[c?.c],blocker:c?.b})),decisions:answer.decisions,alerts:answer.alerts,contingencies:answer.contingencies};
}
function validate(answer,packet){
 const normalized=normalize(answer,packet),errors=v1.validateCandidate(normalized,packet);
 if(normalized)for(const call of normalized.lineup){
  const player=packet.players.find(p=>p.playerId===call.playerId);
  if(player?.facts.some(f=>f.field==='availability'&&f.value?.questionable===true)&&!normalized.contingencies?.some(c=>c.outPlayerId===call.playerId))errors.push('questionable_starter_without_contingency');
 }
 return [...new Set(errors)];
}
function buildRequest(frozen,model='claude-sonnet-4-6'){
 return {model,max_tokens:3300,system:SYSTEM,messages:[{role:'user',content:JSON.stringify(buildEvidence(frozen))}],tools:[{name:'submit_candidate_v2',description:'Return the complete private lineup candidate. No external action.',input_schema:schema(frozen.packet),strict:true}],tool_choice:{type:'tool',name:'submit_candidate_v2',disable_parallel_tool_use:true}};
}
module.exports={columns,tablePacket,untables,intern,expand,buildEvidence,SYSTEM,schema,normalize,validate,buildRequest};
