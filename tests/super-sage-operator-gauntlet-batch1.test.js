"use strict";
const assert=require("assert");
const {CASES}=require("./fixtures/super-sage-operator-gauntlet-v1");
const {buildDecisionTrace}=require("../netlify/functions/_super-sage-decision-grammar");
const {presentDecision}=require("../netlify/functions/_super-sage-operator-presenter");

const IDS=["G02","G06","G11","G17","G19","G22","G26","G36","G39","G43"];
const batch=IDS.map(id=>CASES.find(c=>c.id===id));
assert.ok(batch.every(Boolean));
const results=[];
for(const c of batch){
 const trace=buildDecisionTrace(c.input);
 const presentation=presentDecision(trace);
 assert.strictEqual(trace.mode,"SHADOW",c.id);
 assert.strictEqual(trace.canChangeProductionDecision,false,c.id);
 assert.strictEqual(trace.guardrails.providerCallsAllowed,false,c.id);
 assert.strictEqual(trace.guardrails.outcomeDataAllowed,false,c.id);
 assert.strictEqual(presentation.canChangeProductionDecision,false,c.id);
 assert.ok(presentation.text.startsWith("I'd start "),c.id+" missing immediate call");
 assert.ok(presentation.text.includes(trace.decision.selected),c.id+" presenter changed/omitted call");
 if(trace.losingCase.player && trace.losingCase.rationale.length) assert.ok(presentation.text.includes(trace.losingCase.player+" is a legitimate consideration."),c.id+" missing losing case");
 if(trace.flipConditions.length) assert.ok(presentation.text.includes("I'd reopen the decision if"),c.id+" missing flip condition");
 results.push({id:c.id,label:c.label,call:trace.decision.selected,movement:trace.beliefMovement,depth:presentation.depth,independent:trace.evidenceDiscipline.decisionActiveIndependent.length,causalGroups:trace.evidenceDiscipline.causalGroupsCountedOnce.length,concern:presentation.customerConcern||null});
}
const g19=results.find(x=>x.id==="G19");assert.strictEqual(g19.independent,1);assert.strictEqual(g19.causalGroups,1);
const g26=results.find(x=>x.id==="G26");assert.strictEqual(g26.concern,"I'm worried about his injury.");
const g43=results.find(x=>x.id==="G43");assert.strictEqual(g43.movement,"PRIOR_INVALIDATED");
console.log(JSON.stringify({suite:"Operator Rock Tumbler Batch 1",cases:results},null,2));
console.log("Super SAGE Operator executable gauntlet batch 1: PASS");
