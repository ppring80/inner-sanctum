"use strict";
const assert=require("assert");
const {RAW_CASES}=require("./fixtures/super-sage-operator-unscripted-v1");
const {inferRawCase}=require("../netlify/functions/_super-sage-operator-unscripted");
const get=id=>inferRawCase(RAW_CASES.find(x=>x.id===id));

const u07=get("U07");
console.log("U07",JSON.stringify(u07.evidence.map(e=>({text:e.text,effect:e.effect,group:e.causalHint})),null,2));
const urgency=u07.evidence.find(e=>/must-win situation/i.test(e.text));
assert.strictEqual(urgency.effect,"CONTEXT_ONLY","must-win words alone must not become decision-active");
assert.ok(!u07.independentEvidence.some(e=>e.causalHint==="competitive-state"),"competitive-state narrative must not be counted");
assert.ok(u07.independentEvidence.some(e=>e.causalHint==="coaching-behavior"),"documented coaching behavior must remain independent");
assert.ok(u07.independentEvidence.some(e=>e.causalHint==="current-plan"),"current usage intent must remain independent");
assert.strictEqual(u07.threshold,"CROSSED");

const u08=get("U08");
console.log("U08",JSON.stringify(u08.evidence.map(e=>({text:e.text,effect:e.effect,group:e.causalHint})),null,2));
assert.ok(u08.evidence.some(e=>e.causalHint==="late-option"&&e.verified),"viable late replacement must survive the raw packet");
assert.strictEqual(u08.threshold,"UNRESOLVED","availability remains unresolved before status is known");
assert.strictEqual(u08.guardrails.finalPlayerCallAllowed,false);

const u04=get("U04");
console.log("U04",JSON.stringify(u04.evidence.map(e=>({text:e.text,effect:e.effect,group:e.causalHint})),null,2));
assert.strictEqual(u04.customerConcern,"Their defense sucks.");
assert.ok(!u04.independentEvidence.some(e=>e.source==="customer"),"customer claim cannot become verified evidence");
assert.strictEqual(u04.threshold,"NOT_CROSSED");

const u03=get("U03");
console.log("U03",JSON.stringify(u03.evidence.map(e=>({text:e.text,effect:e.effect,group:e.causalHint})),null,2));
assert.ok(u03.causalGroups.includes("matchup"),"challenger matchup advantage must survive");
assert.ok(u03.causalGroups.includes("rushing"),"independent rushing path must survive");
assert.ok(u03.causalGroups.includes("offense-losses"),"challenger offensive losses must survive as one causal group");
assert.strictEqual(u03.causalGroups.filter(g=>g==="offense-losses").length,1,"LT + WR1 losses sharing one causal lineage count once");
assert.strictEqual(u03.threshold,"UNRESOLVED");

console.log("U03/U04/U07/U08 facet inspection: PASS");
