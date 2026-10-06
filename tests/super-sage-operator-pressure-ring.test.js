"use strict";
const assert=require("assert");
const {RAW_CASES}=require("./fixtures/super-sage-operator-unscripted-v1");
const {inferRawCase,provisionalCall}=require("../netlify/functions/_super-sage-operator-unscripted");
const IDS=["U11","U12","U13","U14"];
const rows=[];
for(const id of IDS){
 const raw=RAW_CASES.find(x=>x.id===id);
 const inf=inferRawCase(raw), call=provisionalCall(raw);
 assert.strictEqual(inf.informationState,"COMPLETE",id);
 assert.notStrictEqual(inf.threshold,"UNRESOLVED",id+" complete information may not hide behind UNRESOLVED");
 assert.notStrictEqual(inf.uncertaintyType,"MISSING_INFORMATION",id+" complete information is not missing-information uncertainty");
 assert.strictEqual(call.status,"PROVISIONAL_CALL",id+" must swing the sword");
 assert.ok(call.selected,id+" must choose");
 assert.strictEqual(call.canChangeProductionDecision,false,id);
 assert.strictEqual(call.guardrails.productionAuthority,false,id);
 rows.push({id,label:raw.label,selected:call.selected,movement:call.movement,threshold:call.threshold,uncertaintyType:call.uncertaintyType,evidenceUsed:call.evidenceUsed.length});
}
console.log(JSON.stringify({suite:"Operator Pressure Ring — Complete Information",cases:rows},null,2));
console.log("Super SAGE Operator complete-information pressure ring: PASS");
