'use strict';
const assert=require('assert');
const {shadowSlot,buildAutomaticShadowRecord}=require('../netlify/functions/_super-sage-live-shadow-adapter');
const {presentShadowSlot}=require('../netlify/functions/_super-sage-shadow-presenter');
const frozen=require('./fixtures/super-sage-live-shadow-week5.json');
const player=(name,rank,points)=>({name,position:'RB',standing:{tier:'START',positionRank:rank},availability:{availabilityVerified:true},projection:{admissible:true,fresh:true,points},stateChanges:[],uncertainty:[]});
let count=0;
function check(slot){
 const before=JSON.stringify(slot);const p=presentShadowSlot(slot);assert.strictEqual(JSON.stringify(slot),before);
 assert.strictEqual(p.selected,slot.shadow.selected);assert.deepStrictEqual(p.evidence,slot.shadow.evidenceUsed);
 for(const key of ['productionAuthority','providerCallsAllowed','outcomeDataAllowed','automaticPromotionAllowed','customerVisible']) assert.strictEqual(p.authority[key],false);
 assert.ok(p.oneSecond.length&&p.threeSeconds.length&&p.tenSeconds.length);
 if(!p.selected){assert.ok(p.oneSecond[0].startsWith('No independent call:'));assert.ok(p.reviewNeeds.length);assert.ok(!p.oneSecond.join('').includes("I'd start"));}
 count++;return p;
}
const before=JSON.stringify(frozen);const replay=buildAutomaticShadowRecord(frozen);assert.strictEqual(JSON.stringify(frozen),before);
for(const slot of replay.slots){const p=check(slot);assert.deepStrictEqual(slot.presentation,p);assert.ok(!JSON.stringify(p).includes('production explanation sentinel'));}
for(const swap of [false,true]){
 const a=player('A',1,20),b=player('B',10,10);
 const p=check(shadowSlot({slotLabel:'RB',starter:swap?b:a,comparator:swap?a:b,confidence:{label:'Moderate'},explanation:'production explanation sentinel'}));
 assert.strictEqual(p.selected,'A');assert.ok(p.oneSecond[0].includes('A over B'));assert.ok(p.supportingEvidence.length===2);assert.ok(!JSON.stringify(p).includes('production explanation sentinel'));
}
let p=check(shadowSlot({slotLabel:'RB',starter:player('A',1,10),comparator:player('B',2,11),confidence:{label:'Moderate'}}));
assert.strictEqual(p.selected,'A');assert.ok(p.opposingEvidence.some(e=>e.text.includes('B')&&e.group==='projection'));assert.ok(p.tenSeconds.some(t=>t.includes('close call')));
const unresolved=shadowSlot({slotLabel:'RB',starter:player('A',1,20),comparator:{...player('B',2,10),availability:{availabilityVerified:true,questionable:true}},confidence:{label:'Moderate'}});
p=check(unresolved);assert.strictEqual(p.selected,null);assert.ok(p.reviewNeeds.some(t=>t.includes('B: availability remains uncertain')));assert.ok(p.oneSecond[0].includes('A vs B'));assert.ok(p.evidence.some(e=>e.text.includes('20 vs 10')));
p=check(shadowSlot({slotLabel:'QB',starter:player('Recorded QB',1,20),comparator:null}));assert.ok(p.oneSecond[0].includes('Recorded QB'));assert.ok(p.reviewNeeds.some(t=>t.includes('No recorded comparator')));
// Translation must preserve the exact recorded identity, including display formatting.
p=check(shadowSlot({slotLabel:'RB',starter:player(' A ',1,20),comparator:player('B',10,10),confidence:{label:'Moderate'}}));assert.strictEqual(p.selected,' A ');
for(const side of ['incumbent','challenger']){
 const a=player('A',1,20),b=player('B',2,10);(side==='incumbent'?a:b).availability={availabilityVerified:true,unavailable:true};
 p=check(shadowSlot({slotLabel:'RB',starter:a,comparator:b,confidence:{label:'Moderate'}}));assert.ok(p.tenSeconds.some(t=>t.includes('verified unavailable')));assert.deepStrictEqual(p.reviewNeeds,[]);
}
assert.throws(()=>presentShadowSlot({...unresolved,shadow:{...unresolved.shadow,selected:null,callStatus:'PROVISIONAL_CALL'}}),/consistent recorded selection/);
assert.throws(()=>presentShadowSlot({shadow:{}}),/private shadow/);
assert.throws(()=>presentShadowSlot({...unresolved,shadow:{...unresolved.shadow,selected:'Unrecorded player',callStatus:'PROVISIONAL_CALL'}}),/consistent recorded selection/);
console.log(`Private Rookie presenter: ${count} frozen/synthetic slot explanations passed; selection, evidence, authority and inputs preserved.`);
