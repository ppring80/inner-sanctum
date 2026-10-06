"use strict";
const assert=require("assert");
const {RAW_CASES}=require("./fixtures/super-sage-operator-unscripted-v1");
const {inferRawCase,provisionalCall}=require("../netlify/functions/_super-sage-operator-unscripted");
const get=id=>RAW_CASES.find(x=>x.id===id);

const u14i=inferRawCase(get("U14")),u14=provisionalCall(get("U14"));
assert.ok(u14i.evidence.some(e=>/material role increase/i.test(e.text)&&e.evidenceStrength==="MATERIAL"),"fresh role change must carry material strength");
assert.strictEqual(u14i.evidenceStrength.materialReassess,1);
assert.strictEqual(u14.selected,"Fresh Role Player","material fresh role + independent matchup should overcome stale ranking prior");
assert.strictEqual(u14.threshold,"CROSSED");

const u05i=inferRawCase(get("U05")),u05=provisionalCall(get("U05"));
assert.strictEqual(u05.selected,"Established Flex","one repeated coach quote must not become strong through repetition");
assert.strictEqual(u05i.independentEvidence.length,1);

const u10=provisionalCall(get("U10"));
assert.strictEqual(u10.selected,"Player A","supporting close-call evidence must not be inflated into a crossing");
assert.strictEqual(u10.uncertaintyType,"CLOSE_CALL");

const u09=provisionalCall(get("U09"));
assert.strictEqual(u09.selected,"Emerging Player","structural prior invalidation must remain decisive");

console.log(JSON.stringify({suite:"Operator Evidence Strength Facet",cases:[
{id:"U14",selected:u14.selected,threshold:u14.threshold,strength:u14i.evidenceStrength},
{id:"U05",selected:u05.selected,independent:u05i.independentEvidence.length},
{id:"U10",selected:u10.selected,uncertaintyType:u10.uncertaintyType},
{id:"U09",selected:u09.selected,movement:u09.movement}
]},null,2));
console.log("Super SAGE Operator evidence-strength facet: PASS");
