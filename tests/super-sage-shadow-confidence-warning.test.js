'use strict';
const assert=require('assert');
const {shadowSlot,buildAutomaticShadowRecord}=require('../netlify/functions/_super-sage-live-shadow-adapter');
const frozen=require('./fixtures/super-sage-live-shadow-week5.json');
const player=(name,rank,points)=>({name,position:'RB',standing:{tier:'START',positionRank:rank},availability:{availabilityVerified:true},baselineValidity:{state:'VALID'},projection:{admissible:true,fresh:true,points},stateChanges:[],uncertainty:[]});
const warning={code:'LIMITED_SAGE_CONFIDENCE',text:'limited Weekly SAGE confidence'};
let cases=0;
for(const swap of [false,true])for(const side of ['incumbent','challenger']){
 const a=player('A',1,20),b=player('B',10,10);(side==='incumbent'?a:b).uncertainty=[warning];
 const slot={slotLabel:'RB',starter:swap?b:a,comparator:swap?a:b,confidence:{label:'Moderate'}};const before=JSON.stringify(slot);const out=shadowSlot(slot);
 assert.strictEqual(JSON.stringify(slot),before);assert.strictEqual(out.shadow.selected,'A');assert.strictEqual(out.shadow.callStatus,'PROVISIONAL_CALL');assert.strictEqual(out.confidence.label,'LOW');assert.deepStrictEqual(out.shadow.missingInformation,[]);assert.strictEqual(out.shadow.confidenceWarnings.length,1);assert.strictEqual(out.presentation.selected,'A');assert.ok(out.presentation.tenSeconds.some(t=>t.includes('Confidence warning')));cases++;
}
// A known confidence warning cannot erase a simultaneous unresolved fact.
for(const unresolved of [{code:'UNVERIFIED_REDISTRIBUTION',text:'unverified workload share'},{code:'UNKNOWN_NEW_CODE',text:'unclassified evidence gap'},{text:'limited Weekly SAGE confidence'}]){
 const a=player('A',1,20),b=player('B',2,10);b.uncertainty=[warning,unresolved];const out=shadowSlot({slotLabel:'RB',starter:a,comparator:b});assert.strictEqual(out.shadow.selected,null);assert.strictEqual(out.shadow.callStatus,'CONDITIONAL');assert.strictEqual(out.shadow.missingInformation.length,1);cases++;
}
for(const availability of [{availabilityVerified:false},{availabilityVerified:true,questionable:true},{availabilityVerified:true,conflict:[{status:'ACTIVE'},{status:'QUESTIONABLE'}]}]){
 const a=player('A',1,20),b=player('B',2,10);b.uncertainty=[warning];b.availability=availability;const out=shadowSlot({slotLabel:'RB',starter:a,comparator:b});assert.strictEqual(out.shadow.selected,null);cases++;
}
const before=JSON.stringify(frozen),replay=buildAutomaticShadowRecord(frozen);assert.strictEqual(JSON.stringify(frozen),before);
const call=replay.slots.find(s=>s.shadow.incumbent==='Jakobi Meyers');assert.strictEqual(call.shadow.selected,'Jakobi Meyers');assert.strictEqual(call.confidence.label,'LOW');assert.ok(call.presentation.oneSecond[0].includes('Jakobi Meyers'));assert.ok(call.shadow.confidenceWarnings.some(t=>t.includes('Kendre Miller')));
for(const name of ['Saquon Barkley','Malik Nabers','Terry McLaurin'])assert.strictEqual(replay.slots.find(s=>s.shadow.incumbent===name).shadow.selected,null);
console.log(`Rookie confidence-warning exam: ${cases} synthetic cases plus frozen Meyers/Miller replay passed. ${call.presentation.oneSecond[0]} Confidence LOW; warning preserved.`);
