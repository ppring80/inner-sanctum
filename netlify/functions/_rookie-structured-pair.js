'use strict';
// Selected-pair only: the model selects evidence, never authors customer prose.
const CONTRACT='structured-pair-v1';
const FACTORS=['projection','recentUsage','matchup','availability'];
const SYSTEM='Give an independent second opinion on this unresolved fantasy football pair. Choose A, B, or null (NO_CALL), confidence, a deciding factor favoring your pick and an opposing factor favoring the other player from decisionFactors. Use NONE for the opposing factor only if no factor favors the other player. A tie or missing fact cannot favor either player. Weigh these facts; there is no supplied preferred player. Position-relative roles are context, never comparable across positions. Do not generate prose or new facts. For a pick, choose a hypothetical reversal: pick_ruled_out, alternative_more_work_confirmed, or alternative_cleared only if the alternative currently has uncertain availability. For NO_CALL use evidence_resolves_blocker and a supported blocker. These are future conditions, never claims about current health or workload.';
const schema={type:'object',additionalProperties:false,required:['selected','confidence','decidingFactor','tradeoffFactor','blocker','reconsider'],properties:{selected:{type:['string','null'],enum:['A','B',null]},confidence:{type:'string',enum:['LOW','MEDIUM','HIGH']},decidingFactor:{type:'string',enum:[...FACTORS,'NONE']},tradeoffFactor:{type:'string',enum:[...FACTORS,'NONE']},blocker:{type:'string',enum:['NONE','conflicting_evidence','insufficient_evidence','no_supported_factor']},reconsider:{type:'string',enum:['pick_ruled_out','alternative_more_work_confirmed','alternative_cleared','evidence_resolves_blocker']}}};
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
function validate(input,packet){
 const errors=[],ps=packet.players,pick=ps.find(p=>p.id===input?.selected),other=ps.find(p=>p.id!==input?.selected),fs=factors(packet);
 if(!input||Object.keys(input).some(k=>!schema.required.includes(k))||schema.required.some(k=>!Object.hasOwn(input,k)))return ['invalid_structured_answer'];
 for(const [key,rule]of Object.entries(schema.properties))if(!rule.enum.includes(input[key]))errors.push('invalid_'+key);
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
function render(input,packet){
 const errors=validate(input,packet);if(errors.length)throw Error(errors.join(','));
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
 return {...input,answerContract:CONTRACT,explanation,caveat,reconsider,factIds:[...new Set(ids)]};
}
module.exports={CONTRACT,SYSTEM,schema,factors,validate,render};
