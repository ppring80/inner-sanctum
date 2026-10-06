"use strict";
const assert=require("assert");
const {CASES}=require("./fixtures/super-sage-operator-gauntlet-v1");
const {buildDecisionTrace}=require("../netlify/functions/_super-sage-decision-grammar");
const {presentDecision}=require("../netlify/functions/_super-sage-operator-presenter");
const IDS=["G27","G31","G34","G35","G37","G41","G42","G44","G45","G49"];
const selected=IDS.map(id=>CASES.find(c=>c.id===id));
assert.ok(selected.every(Boolean));
const results=[];
for(const c of selected){
 const trace=buildDecisionTrace(c.input), p=presentDecision(trace);
 assert.strictEqual(trace.canChangeProductionDecision,false,c.id);
 assert.strictEqual(trace.guardrails.providerCallsAllowed,false,c.id);
 assert.strictEqual(trace.guardrails.outcomeDataAllowed,false,c.id);
 assert.strictEqual(p.call,trace.decision.selected,c.id);
 assert.ok(p.text.startsWith("I'd start "),c.id);
 assert.ok(p.text.includes(trace.losingCase.player+" is a legitimate consideration."),c.id);
 assert.ok(p.text.includes("I'd reopen the decision if"),c.id);
 results.push({id:c.id,label:c.label,call:p.call,movement:trace.beliefMovement,depth:p.depth,confidence:p.confidence,independent:trace.evidenceDiscipline.decisionActiveIndependent.length,groups:trace.evidenceDiscipline.causalGroupsCountedOnce.length,concern:p.customerConcern||null});
}
assert.strictEqual(results.find(x=>x.id==="G27").concern,"This game will be a shootout.");
assert.strictEqual(results.find(x=>x.id==="G35").confidence,"LOW");
assert.strictEqual(results.find(x=>x.id==="G42").call,"Dual-Path Challenger");
assert.strictEqual(results.find(x=>x.id==="G44").movement,"PRIOR_REQUIRES_REASSESSMENT");
assert.strictEqual(results.find(x=>x.id==="G49").movement,"PRIOR_INVALIDATED");
console.log(JSON.stringify({suite:"Operator Rock Tumbler Batch 2",cases:results},null,2));
console.log("Super SAGE Operator executable gauntlet batch 2: PASS");
