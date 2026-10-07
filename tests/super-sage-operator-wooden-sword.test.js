"use strict";
const assert=require("assert");
const {RAW_CASES}=require("./fixtures/super-sage-operator-unscripted-v1");
const {provisionalCall}=require("../netlify/functions/_super-sage-operator-unscripted");
const calls=RAW_CASES.map(x=>({id:x.id,...provisionalCall(x)}));

for(const c of calls){
 assert.strictEqual(c.mode,"TUMBLER_ONLY",c.id);
 assert.strictEqual(c.canChangeProductionDecision,false,c.id);
 assert.strictEqual(c.guardrails.productionAuthority,false,c.id);
 assert.strictEqual(c.guardrails.providerCallsAllowed,false,c.id);
 assert.strictEqual(c.guardrails.outcomeDataAllowed,false,c.id);
 if(c.threshold==="UNRESOLVED"){
   assert.strictEqual(c.status,"CONDITIONAL",c.id);
   assert.strictEqual(c.selected,null,c.id+" must not fake a definitive call");
 }
 if(c.threshold==="NOT_CROSSED"){
   assert.strictEqual(c.status,"PROVISIONAL_CALL",c.id);
   assert.ok(c.selected,c.id+" must make the narrow/stable incumbent call");
 }
 if(c.threshold==="CROSSED"){
   assert.strictEqual(c.status,"PROVISIONAL_CALL",c.id);
   assert.ok(c.selected,c.id+" must select the challenger after crossing");
 }
 assert.ok(c.rationale,c.id+" must explain why a call is/isn't available");
}

// These are structural expectations, not NFL outcome labels.
assert.strictEqual(calls.find(x=>x.id==="U07").selected,"Urgency Player");
assert.strictEqual(calls.find(x=>x.id==="U09").selected,"Emerging Player");
assert.strictEqual(calls.find(x=>x.id==="U10").selected,"Player A");
assert.strictEqual(calls.find(x=>x.id==="U10").uncertaintyType,"CLOSE_CALL");
assert.strictEqual(calls.find(x=>x.id==="U08").selected,null);
assert.strictEqual(calls.find(x=>x.id==="U08").uncertaintyType,"MISSING_INFORMATION");

console.log(JSON.stringify({suite:"Operator Wooden Sword V1",calls:calls.map(c=>({id:c.id,status:c.status,selected:c.selected,movement:c.movement,threshold:c.threshold,uncertaintyType:c.uncertaintyType,evidenceUsed:c.evidenceUsed.length}))},null,2));
console.log("Super SAGE Operator wooden sword provisional calls: PASS");
