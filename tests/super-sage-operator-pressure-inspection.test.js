"use strict";
const assert=require("assert");
const {RAW_CASES}=require("./fixtures/super-sage-operator-unscripted-v1");
const {inferRawCase,provisionalCall}=require("../netlify/functions/_super-sage-operator-unscripted");
const IDS=["U11","U12","U13","U14"];
for(const id of IDS){
 const raw=RAW_CASES.find(x=>x.id===id), inf=inferRawCase(raw), call=provisionalCall(raw);
 console.log("\n"+id+" "+raw.label);
 console.log(JSON.stringify({selected:call.selected,movement:inf.movement,threshold:inf.threshold,uncertaintyType:inf.uncertaintyType,evidence:inf.evidence.map(e=>({text:e.text,effect:e.effect,group:e.causalHint,material:e.materialChange})),independent:inf.independentEvidence.map(e=>({text:e.text,effect:e.effect,group:e.causalHint}))},null,2));
}
// Inspection invariants expose classifier blind spots instead of blessing calls.
const u12=inferRawCase(RAW_CASES.find(x=>x.id==="U12"));
assert.ok(u12.evidence.some(e=>/starting quarterback is out/i.test(e.text)&&e.effect==="REASSESS_PRIOR"),"U12 QB loss must be active structural evidence");
assert.ok(u12.evidence.some(e=>/Heavy wind/i.test(e.text)&&e.effect==="REASSESS_PRIOR"),"U12 weather must be active structural evidence");
const u13=inferRawCase(RAW_CASES.find(x=>x.id==="U13"));
assert.ok(u13.evidence.some(e=>/offensive linemen are out/i.test(e.text)&&e.effect==="REASSESS_PRIOR"),"U13 OL losses must be active structural evidence");
const u14=inferRawCase(RAW_CASES.find(x=>x.id==="U14"));
assert.ok(u14.evidence.some(e=>/material role increase/i.test(e.text)&&e.effect==="REASSESS_PRIOR"),"U14 fresh role increase must be active structural evidence");
assert.ok(u14.evidence.some(e=>/better matchup/i.test(e.text)&&e.effect==="CHALLENGES_PRIOR"),"U14 matchup edge must be active challenger evidence");
console.log("Pressure Ring combustion inspection: PASS");
