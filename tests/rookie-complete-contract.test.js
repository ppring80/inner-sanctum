'use strict';
// Exhaustive cross-field contract checks. Independent schema membership test;
// no provider, production data, network, or storage.
const assert=require('node:assert/strict');
const sp=require('../netlify/functions/_rookie-structured-pair');
const active={effectiveStatus:{status:'ACTIVE'},unavailable:false,questionable:false};
const questionable={...active,questionable:true};
const out={...active,unavailable:true};
const unknown={effectiveStatus:{status:'UNKNOWN'},unavailable:false,questionable:false};
const player=(id,points,usage,matchup,availability)=>({id,name:id,position:id==='A'?'RB':'WR',facts:[
 ['projection',{admissible:points!==null,points}],['observedOpportunity',{avgLast3:usage}],
 ['matchup',matchup],['availability',availability]
].map(([field,value])=>({field,value,factId:`${id}:${field}`}))});
function matches(value,schema){
 if(schema.anyOf)return schema.anyOf.some(branch=>matches(value,branch));
 if(schema.properties?.decision)return Object.keys(value).length===1&&Object.hasOwn(value,'decision')&&matches(value.decision,schema.properties.decision);
 if(Object.keys(value).some(k=>!schema.properties[k])||schema.required.some(k=>!Object.hasOwn(value,k)))return false;
 if(!Object.entries(schema.properties).every(([k,v])=>v.enum.includes(value[k])))return false;
 return !schema.anyOf||schema.anyOf.some(branch=>matches(value,branch));
}
let packets=0,answers=0;
for(const points of [null,8,10,12])for(const usage of [null,5,7,9])for(const matchup of [null,'Negative','Neutral','Positive'])
for(const a of [active,questionable,out,unknown])for(const b of [active,questionable,out,unknown]){
 const packet={players:[player('A',10,7,'Neutral',a),player('B',points,usage,matchup,b)],requiredDisclosures:[]};
 let schema;
 try{schema=sp.requestSchemaFor(packet);}catch(e){assert.equal(e.message,'no_supported_review_answer');}
 packets++;
 for(const selected of ['A','B','NO_CALL'])for(const decidingFactor of ['projection','recentUsage','matchup','availability','NONE'])
 for(const blocker of ['NONE','conflicting_evidence','insufficient_evidence','no_supported_factor'])
 for(const reconsider of ['pick_ruled_out','alternative_more_work_confirmed','alternative_cleared','evidence_resolves_blocker']){
  const wire={selected,confidence:'LOW',decidingFactor,blocker,reconsider};
  const valid=sp.validateV2(sp.decode(wire),packet).length===0;
  assert.equal(schema?matches({decision:wire},schema):false,valid,JSON.stringify({points,usage,matchup,a,b,wire}));answers++;
  if(valid)assert.doesNotThrow(()=>sp.render(sp.decode(wire),packet));
 }
}
console.log(`PASS: ${packets} evidence/availability combinations, ${answers} complete answers: request schema and factual validator agree, valid answers render.`);
