'use strict';
// Selected-pair only: the model selects evidence, never authors customer prose.
// v2 (new reviews): the model no longer selects a tradeoff; the server renders every
// verified advantage of the alternative. v1 stays byte-identical so saved v1 reviews
// can be found under their original cache keys and validated by their own rules.
const CONTRACT='structured-pair-v2',CONTRACT_V1='structured-pair-v1';
const FACTORS=['projection','recentUsage','matchup','availability'];
const SYSTEM_V1='Give an independent second opinion on this unresolved fantasy football pair. Choose A, B, or NO_CALL, confidence, a deciding factor favoring your pick and an opposing factor favoring the other player from decisionFactors. Use NONE for the opposing factor only if no factor favors the other player. A tie or missing fact cannot favor either player. Weigh these facts; there is no supplied preferred player. Position-relative roles are context, never comparable across positions. Do not generate prose or new facts. For a pick, choose a hypothetical reversal: pick_ruled_out, alternative_more_work_confirmed, or alternative_cleared only if the alternative currently has uncertain availability. For NO_CALL use evidence_resolves_blocker and a supported blocker. These are future conditions, never claims about current health or workload.';
const schema_V1={type:'object',additionalProperties:false,required:['selected','confidence','decidingFactor','tradeoffFactor','blocker','reconsider'],properties:{selected:{type:'string',enum:['A','B','NO_CALL']},confidence:{type:'string',enum:['LOW','MEDIUM','HIGH']},decidingFactor:{type:'string',enum:[...FACTORS,'NONE']},tradeoffFactor:{type:'string',enum:[...FACTORS,'NONE']},blocker:{type:'string',enum:['NONE','conflicting_evidence','insufficient_evidence','no_supported_factor']},reconsider:{type:'string',enum:['pick_ruled_out','alternative_more_work_confirmed','alternative_cleared','evidence_resolves_blocker']}}};
// Wire sentinel avoids the provider's rejected mixed-type enum. Internal and
// customer-facing NO_CALL remains null; raw provider content is preserved.
function decode(input){return input?.selected==='NO_CALL'?{...input,selected:null}:input;}
const fact=(p,k)=>p.facts.find(f=>f.field===k);
function factors(packet){
 const ps=packet.players, out={};
 const add=(key,values,fields)=>{if(values.every(Number.isFinite))out[key]={favoredId:values[0]===values[1]?null:ps[values[0]>values[1]?0:1].id,factIds:ps.flatMap(p=>fields.map(k=>fact(p,k)?.factId).filter(Boolean)),values};};
 add('projection',ps.map(p=>{const v=fact(p,'projection')?.value;return v?.admissible===true?v.points:null;}),['projection']);
 // Component targets/carries are not interchangeable across positions. Use the
 // supplied opportunities average for both; describe it as past work only.
 add('recentUsage',ps.map(p=>fact(p,'observedOpportunity')?.value?.avgLast3),['observedOpportunity']);
 add('matchup',ps.map(p=>require('./_rookie-plain-presentation').matchupRank(fact(p,'matchup')?.value)),['matchup']);
 const availability=ps.map(p=>fact(p,'availability')?.value);
 const active=v=>v&&!v.unavailable&&!v.questionable&&['ACTIVE','A'].includes(v.effectiveStatus?.status||v.status||v.rosterStatus);
 const uncertain=v=>v?.questionable===true||v?.unavailable===true;
 if(availability.every(v=>active(v)||uncertain(v)))add('availability',availability.map(v=>active(v)?1:0),['availability']);
 return out;
}
function validateV1(input,packet){
 const errors=[],ps=packet.players,pick=ps.find(p=>p.id===input?.selected),other=ps.find(p=>p.id!==input?.selected),fs=factors(packet);
 if(!input||Object.keys(input).some(k=>!schema_V1.required.includes(k))||schema_V1.required.some(k=>!Object.hasOwn(input,k)))return ['invalid_structured_answer'];
 for(const [key,rule]of Object.entries(schema_V1.properties))if(!(key==='selected'&&input[key]===null)&&!rule.enum.includes(input[key]))errors.push('invalid_'+key);
 if(input.selected!==null&&!pick)errors.push('invalid_selection');
 if(pick&&fact(pick,'availability')?.value?.unavailable)errors.push('unavailable_player_selected');
 if(pick){
  if(!fs[input.decidingFactor]||fs[input.decidingFactor].favoredId!==pick.id)errors.push('deciding_factor_not_for_pick');
  const opposing=Object.values(fs).some(f=>f.favoredId===other.id);
  if(input.tradeoffFactor==='NONE'?opposing:!fs[input.tradeoffFactor]||fs[input.tradeoffFactor].favoredId!==other.id)errors.push('tradeoff_factor_not_for_alternative');
  if(input.blocker!=='NONE')errors.push('unexpected_blocker');
  const v=fact(other,'availability')?.value;
  if(!['pick_ruled_out','alternative_more_work_confirmed','alternative_cleared'].includes(input.reconsider)||(input.reconsider==='alternative_cleared'&&!v?.questionable))errors.push('reconsider_not_reversal');
 }else if(input.selected===null){
  const winners=new Set(Object.values(fs).map(f=>f.favoredId).filter(Boolean));
  if(input.blocker==='NONE'||(input.blocker==='conflicting_evidence'&&winners.size<2)||(input.blocker==='no_supported_factor'&&winners.size!==0)||(input.blocker==='insufficient_evidence'&&FACTORS.every(k=>fs[k])))errors.push('no_call_without_supported_blocker');
  if(input.decidingFactor!=='NONE'||input.tradeoffFactor!=='NONE'||input.reconsider!=='evidence_resolves_blocker')errors.push('invalid_no_call_shape');
 }
 return [...new Set(errors)];
}
function renderV1(input,packet){
 const errors=validateV1(input,packet);if(errors.length)throw Error(errors.join(','));
 const ps=packet.players,pick=ps.find(p=>p.id===input.selected),other=ps.find(p=>p.id!==input.selected),fs=factors(packet);
 const names=id=>ps.find(p=>p.id===id).name;
 const describe=(key,id)=>{
  const f=fs[key],a=f.values[ps.findIndex(p=>p.id===id)],b=f.values[ps.findIndex(p=>p.id!==id)];
  if(key==='projection')return `${names(id)} projects higher (${a} versus ${b} points)`;
  if(key==='recentUsage')return `${names(id)} had more recent carries plus targets (${a} versus ${b} per game); that is past workload, not a forecast`;
  if(key==='matchup')return `${names(id)} has the more favorable matchup`;
  return `${names(id)} has confirmed active status while the other player's availability is uncertain`;
 };
 const blocker={conflicting_evidence:'the supplied factors favor different players',insufficient_evidence:'the supplied comparison is incomplete',no_supported_factor:'no supplied factor separates these players'};
 let explanation,caveat,reconsider,ids=[];
 if(pick){
  explanation=`Rookie leans ${pick.name} (${input.confidence.toLowerCase()} confidence): ${describe(input.decidingFactor,pick.id)}.`;
  caveat=input.tradeoffFactor==='NONE'?'No supplied comparison factor favors the alternative.':`The tradeoff: ${describe(input.tradeoffFactor,other.id)}.`;
  ids=[...fs[input.decidingFactor].factIds,...(fs[input.tradeoffFactor]?.factIds||[])];
  reconsider={pick_ruled_out:`Would switch if ${pick.name} is ruled out.`,alternative_more_work_confirmed:`Would reconsider if new evidence confirms additional work for ${other.name}.`,alternative_cleared:`Would reconsider if ${other.name}'s uncertain availability is resolved with confirmed active status.`}[input.reconsider];
 }else{explanation=`Rookie has no call: ${blocker[input.blocker]}.`;caveat='SAGE’s provisional lineup remains unchanged.';reconsider='Would reconsider if new evidence resolves this blocker.';ids=Object.values(fs).flatMap(f=>f.factIds);}
 // Disclosures are rendered from supplied facts, independent of the model's
 // factor selections. Keep all required items, including chart uncertainty.
 const disclosures=(packet.requiredDisclosures||[]).map(d=>{
  ids.push(...d.factIds);const name=names(d.playerId);
  switch(d.type){
   case 'noVerifiedOrder':return d.detail;
   case 'workloadUnknown':return `${name}: a larger workload is not confirmed.`;
   case 'statusConflict':return `${d.name}: ${d.detail}.`;
   case 'chartAhead':return `${name}: the team-published chart lists ${d.backs.map(b=>`${b.name} (${b.status})`).join(', ')} ahead; that does not establish workload shares.`;
   case 'absentFromChart':return `${name}: ${d.names.join(', ')} are absent from the supplied chart; absence does not establish their availability.`;
   case 'nextListedAlternative':return `${name}: the next listed alternative is ${d.name} (${d.status}); workload is unconfirmed.`;
   default:throw Error('unsupported_required_disclosure');
  }
 });
 const availability=ps.map(p=>{const v=fact(p,'availability')?.value;ids.push(...(fact(p,'availability')?[fact(p,'availability').factId]:[]));return v?.questionable||v?.unavailable?`${p.name}: ${v.effectiveStatus?.status|| (v.unavailable?'unavailable':'questionable')}.`:null;}).filter(Boolean);
 const roles=ps.map(p=>{const f=fact(p,'establishedRole');if(!f)return null;ids.push(f.factId);return `${p.name}: ${f.value.plain}.`;}).filter(Boolean);
 explanation=[explanation,caveat,...roles,...availability,...disclosures].join('\n');
 return {...input,answerContract:CONTRACT_V1,explanation,caveat,reconsider,factIds:[...new Set(ids)]};
}

// ── v2 ──────────────────────────────────────────────────────────────────
// Each player's verified advantages, as the model sees them. A tie or a factor
// that cannot be computed favors nobody and is listed separately.
function advantages(packet){
 const fs=factors(packet),out={};
 for(const p of packet.players)out[p.id]=FACTORS.filter(k=>fs[k]?.favoredId===p.id);
 out.tied=FACTORS.filter(k=>fs[k]&&fs[k].favoredId===null);
 out.notComparable=FACTORS.filter(k=>!fs[k]);
 return out;
}
const SYSTEM='Give an independent second opinion on this unresolved fantasy football pair. Choose A, B, or NO_CALL, a confidence, and the deciding factor: one of your pick\'s verified advantages listed in advantages. Factors under tied or notComparable favor nobody and cannot decide. The other player\'s advantages are shown to the customer automatically; do not select them. Weigh these facts; there is no supplied preferred player. Position-relative roles are context, never comparable across positions. Do not generate prose or new facts. For a pick, choose a hypothetical reversal: pick_ruled_out, alternative_more_work_confirmed, or alternative_cleared only if the alternative currently has uncertain availability. For NO_CALL use decidingFactor NONE, evidence_resolves_blocker and a supported blocker. These are future conditions, never claims about current health or workload.';
// Per-packet schema: only factors that verifiably favor a player can decide.
function schemaFor(packet,{legacyReconsider=false}={}){
 const fs=factors(packet),supported=FACTORS.filter(k=>fs[k]&&fs[k].favoredId!==null);
 // With neither player questionable, clearance cannot reverse either pick.
 // Keep the old wire shape available only to locate saved v2 reviews.
 const canClear=legacyReconsider||packet.players.some(p=>fact(p,'availability')?.value?.questionable===true);
 return {type:'object',additionalProperties:false,required:['selected','confidence','decidingFactor','blocker','reconsider'],properties:{
  selected:{type:'string',enum:['A','B','NO_CALL']},confidence:{type:'string',enum:['LOW','MEDIUM','HIGH']},
  decidingFactor:{type:'string',enum:[...supported,'NONE']},
  blocker:{type:'string',enum:['NONE','conflicting_evidence','insufficient_evidence','no_supported_factor']},
  reconsider:{type:'string',enum:['pick_ruled_out','alternative_more_work_confirmed',...(canClear?['alternative_cleared']:[]),'evidence_resolves_blocker']}}};
}
const isV1=input=>input&&typeof input==='object'&&Object.hasOwn(input,'tradeoffFactor');
function validateV2(input,packet){
 const errors=[],ps=packet.players,pick=ps.find(p=>p.id===input?.selected),fs=factors(packet),sch=schemaFor(packet);
 if(!input||Object.keys(input).some(k=>!sch.required.includes(k))||sch.required.some(k=>!Object.hasOwn(input,k)))return ['invalid_structured_answer'];
 for(const [key,rule]of Object.entries(sch.properties))if(!(key==='selected'&&input[key]===null)&&!rule.enum.includes(input[key]))errors.push('invalid_'+key);
 if(input.selected!==null&&!pick)errors.push('invalid_selection');
 if(pick&&fact(pick,'availability')?.value?.unavailable)errors.push('unavailable_player_selected');
 if(pick){
  const other=ps.find(p=>p.id!==pick.id);
  if(!fs[input.decidingFactor]||fs[input.decidingFactor].favoredId!==pick.id)errors.push('deciding_factor_not_for_pick');
  if(input.blocker!=='NONE')errors.push('unexpected_blocker');
  const v=fact(other,'availability')?.value;
  if(!['pick_ruled_out','alternative_more_work_confirmed','alternative_cleared'].includes(input.reconsider)||(input.reconsider==='alternative_cleared'&&!v?.questionable))errors.push('reconsider_not_reversal');
 }else if(input.selected===null){
  const winners=new Set(Object.values(fs).map(f=>f.favoredId).filter(Boolean));
  if(input.blocker==='NONE'||(input.blocker==='conflicting_evidence'&&winners.size<2)||(input.blocker==='no_supported_factor'&&winners.size!==0)||(input.blocker==='insufficient_evidence'&&FACTORS.every(k=>fs[k])))errors.push('no_call_without_supported_blocker');
  if(input.decidingFactor!=='NONE'||input.reconsider!=='evidence_resolves_blocker')errors.push('invalid_no_call_shape');
 }
 return [...new Set(errors)];
}
// The server derives the alternative's advantages from the verified factors; the
// v1 renderer is reused unchanged for the shared text, disclosures and fact IDs.
function renderV2(input,packet){
 const errors=validateV2(input,packet);if(errors.length)throw Error(errors.join(','));
 const fs=factors(packet),other=packet.players.find(p=>p.id!==input.selected);
 const opposing=input.selected===null?[]:FACTORS.filter(k=>fs[k]?.favoredId===other.id);
 const base=renderV1({...input,tradeoffFactor:input.selected===null?'NONE':(opposing[0]||'NONE')},packet);
 let caveat=base.caveat,explanation=base.explanation;
 if(input.selected!==null&&opposing.length>1){
  const ps=packet.players,names=id=>ps.find(p=>p.id===id).name;
  const describe=k=>{const f=fs[k],a=f.values[ps.findIndex(p=>p.id===other.id)],b=f.values[ps.findIndex(p=>p.id!==other.id)];
   if(k==='projection')return `${names(other.id)} projects higher (${a} versus ${b} points)`;
   if(k==='recentUsage')return `${names(other.id)} had more recent carries plus targets (${a} versus ${b} per game); that is past workload, not a forecast`;
   if(k==='matchup')return `${names(other.id)} has the more favorable matchup`;
   return `${names(other.id)} has confirmed active status while the other player's availability is uncertain`;};
  const all=`The tradeoffs: ${opposing.map(describe).join('; ')}.`;
  explanation=explanation.replace(caveat,all);caveat=all;
 }
 const ids=[...base.factIds,...opposing.flatMap(k=>fs[k].factIds)];
 const {tradeoffFactor,...rest}=base;
 return {...rest,decidingFactor:input.decidingFactor,opposingFactors:opposing,answerContract:CONTRACT,explanation,caveat,factIds:[...new Set(ids)]};
}
// Explicit contract handling: a v1 answer (it carries tradeoffFactor) is judged only
// by v1 rules; a failed v1 answer stays failed.
function validate(input,packet){return isV1(input)?validateV1(input,packet):validateV2(input,packet);}
function render(input,packet){return isV1(input)?renderV1(input,packet):renderV2(input,packet);}
const schema=schema_V1; // legacy export name (v1 wire schema)
module.exports={CONTRACT,CONTRACT_V1,SYSTEM,SYSTEM_V1,schema,schema_V1,schemaFor,advantages,isV1,decode,factors,validate,validateV1,validateV2,render,renderV1,renderV2};
