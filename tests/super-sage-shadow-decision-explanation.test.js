'use strict';
const assert=require('assert');
const {shadowSlot,buildAutomaticShadowRecord}=require('../netlify/functions/_super-sage-live-shadow-adapter');
const {presentShadowSlot}=require('../netlify/functions/_super-sage-shadow-presenter');
const frozen=require('./fixtures/super-sage-live-shadow-week5.json');
const before=JSON.stringify(frozen),out=buildAutomaticShadowRecord(frozen);assert.strictEqual(JSON.stringify(frozen),before);
const corum=out.slots.find(s=>s.shadow.incumbent==='Blake Corum');const p=corum.presentation;
assert.strictEqual(p.selected,'Blake Corum');assert.strictEqual(corum.confidence.label,'LOW');
assert.ok(p.explanation.includes('Courtland Sutton'));assert.ok(p.explanation.includes('9.2 vs 7.38'));
assert.ok(p.resolution.includes('one opposing signal'));assert.ok(p.resolution.includes('additional independent support'));
assert.ok(p.reconsider.includes('availability'));assert.ok(p.reconsider.includes('standing or role'));assert.ok(!p.explanation.includes('promoted'),"Rookie must explain its own rule, not borrow Production's forward gate");
assert.ok(p.explanation.split(/\s+/).length<=125,'Concise explanation must still fit the agreed reading depth');
assert.deepStrictEqual(corum.shadow.decisionBasis.reinforcingGroups,['standing']);assert.deepStrictEqual(corum.shadow.decisionBasis.challengingGroups,['projection']);
const player=(name,rank,points)=>({name,position:'RB',standing:{tier:'START',positionRank:rank},availability:{availabilityVerified:true},baselineValidity:{state:'VALID'},projection:{admissible:true,fresh:true,points},uncertainty:[],stateChanges:[]});
let cases=1;
for(const swapped of [false,true]){
 const a=player('A',1,20),b=player('B',10,10);const s=shadowSlot({slotLabel:'RB',starter:swapped?b:a,comparator:swapped?a:b});const old=JSON.stringify(s);const view=presentShadowSlot(s);assert.strictEqual(JSON.stringify(s),old);assert.strictEqual(view.selected,'A');assert.ok(view.explanation.includes('20 vs 10'));assert.ok(view.reconsider.includes('B'));assert.ok(!view.resolution.includes('projection advantage is one opposing'));cases++;
}
const eligible=shadowSlot({slotLabel:'RB',starter:{...player('A',1,20),availability:{availabilityVerified:true,unavailable:true}},comparator:player('B',2,10)});
assert.ok(eligible.presentation.resolution.includes('A is verified unavailable'));assert.ok(!eligible.presentation.resolution.includes('Multiple independent'));cases++;
const missing=shadowSlot({slotLabel:'RB',starter:player('A',1,20),comparator:{...player('B',2,10),availability:{availabilityVerified:false}}});assert.strictEqual(missing.presentation.selected,null);assert.strictEqual(missing.presentation.resolution,'');assert.strictEqual(missing.presentation.reconsider,'');assert.ok(missing.presentation.explanation.includes('B: availability is unverified'));cases++;
for(const s of out.slots){assert.deepStrictEqual(s.presentation.evidence,s.shadow.evidenceUsed);assert.strictEqual(s.presentation.authority.productionAuthority,false);assert.ok(!s.presentation.explanation.includes('Strong edge'));}
console.log(`Rookie decision explanation: ${cases} decision paths plus all ten frozen slots passed. Round 11 replay:\n${p.explanation}`);
