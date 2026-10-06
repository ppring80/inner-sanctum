"use strict";
const assert=require("assert");
const {RAW_CASES}=require("./fixtures/super-sage-operator-unscripted-v1");
const {inferRawCase}=require("../netlify/functions/_super-sage-operator-unscripted");
const IDS=["U01","U02","U03","U04","U05","U06","U07","U08","U09","U10"];
const out=IDS.map(id=>inferRawCase(RAW_CASES.find(x=>x.id===id)));
for(const r of out){
 assert.strictEqual(r.mode,"SHADOW");
 assert.strictEqual(r.canChangeProductionDecision,false);
 assert.strictEqual(r.guardrails.finalPlayerCallAllowed,false);
 assert.strictEqual(r.guardrails.providerCallsAllowed,false);
 assert.strictEqual(r.guardrails.outcomeDataAllowed,false);
}
// Tests properties, not hidden player answers.
assert.strictEqual(out.find(x=>x.id==="U04").customerConcern,"Their defense sucks.");
assert.strictEqual(out.find(x=>x.id==="U05").causalGroups.filter(x=>x==="coach-quote-1").length,1);
assert.ok(out.find(x=>x.id==="U05").independentEvidence.length < out.find(x=>x.id==="U05").evidence.length);
assert.strictEqual(out.find(x=>x.id==="U09").movement,"PRIOR_INVALIDATED");
assert.strictEqual(out.find(x=>x.id==="U09").threshold,"CROSSED");
assert.strictEqual(out.find(x=>x.id==="U10").threshold,"NOT_CROSSED");
console.log(JSON.stringify({suite:"Operator Unscripted Tumbler Batch 3",cases:out.map(r=>({id:r.id,label:r.label,movement:r.movement,threshold:r.threshold,independent:r.independentEvidence.length,groups:r.causalGroups.length,concern:r.customerConcern}))},null,2));
console.log("Super SAGE Operator unscripted batch 3: PASS");
