"use strict";
const assert=require("assert");
const {RAW_CASES}=require("./fixtures/super-sage-operator-unscripted-v1");
const {inferRawCase}=require("../netlify/functions/_super-sage-operator-unscripted");
const get=id=>inferRawCase(RAW_CASES.find(x=>x.id===id));

// U08: unresolved player availability is missing information, not a coin flip.
const u08=get("U08");
assert.strictEqual(u08.threshold,"UNRESOLVED");
assert.strictEqual(u08.uncertaintyType,"MISSING_INFORMATION");

// U10: all important state is known; evidence is simply close.
const u10=get("U10");
assert.strictEqual(u10.threshold,"NOT_CROSSED");
assert.strictEqual(u10.movement,"COMPETING_EVIDENCE");
assert.strictEqual(u10.uncertaintyType,"CLOSE_CALL");

// U09: verified structural invalidation is not uncertainty.
const u09=get("U09");
assert.strictEqual(u09.threshold,"CROSSED");
assert.strictEqual(u09.uncertaintyType,"STABLE");

// Safety remains absolute.
for(const r of [u08,u10,u09]){
 assert.strictEqual(r.canChangeProductionDecision,false);
 assert.strictEqual(r.guardrails.finalPlayerCallAllowed,false);
 assert.strictEqual(r.guardrails.providerCallsAllowed,false);
}
console.log(JSON.stringify({suite:"Operator Uncertainty Facet",cases:[u08,u10,u09].map(x=>({id:x.id,movement:x.movement,threshold:x.threshold,uncertaintyType:x.uncertaintyType}))},null,2));
console.log("Super SAGE Operator uncertainty taxonomy: PASS");
