"use strict";
const assert=require("assert");
const {buildAutomaticShadowRecord}=require("../netlify/functions/_super-sage-live-shadow-adapter");
const prod={evidenceType:"super-sage-lineup-decision",decisionId:"prod-1",decisionScope:"START_SIT",request:{season:2026,week:5,scoring:"half"},slots:[
 {slotLabel:"FLEX1",starter:{name:"Veteran",standing:{tier:"START"},matchup:{label:"Neutral"},stateChanges:[],projection:{admissible:true,points:10}},comparator:{name:"Challenger",standing:{tier:"FLEX"},matchup:{label:"Positive"},stateChanges:[],roleExpansion:{verified:true},projection:{admissible:true,points:11}},decisionState:"DECIDED",confidence:{label:"HIGH"}},
 {slotLabel:"QB",starter:{name:"QB A",standing:{tier:"START"},matchup:{label:"Neutral"},stateChanges:[]},comparator:null,decisionState:"DECIDED",confidence:{label:"HIGH"}}
]};
const shadow=buildAutomaticShadowRecord(prod);
assert.strictEqual(shadow.authority.productionAuthority,false);
assert.strictEqual(shadow.authority.providerCallsAllowed,false);
assert.strictEqual(shadow.authority.outcomeDataAllowed,false);
assert.strictEqual(shadow.productionDecisionId,"prod-1");
assert.strictEqual(shadow.slots.length,2);
assert.strictEqual(shadow.slots[0].decidedBy,"operator-shadow");
assert.ok(shadow.slots[0].shadow);
assert.strictEqual(shadow.slots[1].starter.name,"QB A");
assert.strictEqual(shadow.slots[1].decidedBy,"operator-shadow-no-comparator");
assert.deepStrictEqual(prod.slots[0].starter.name,"Veteran","production input must remain unchanged");
console.log(JSON.stringify({suite:"Automatic Rookie Live Adapter",production:prod.slots.map(s=>({slot:s.slotLabel,starter:s.starter.name})),shadow:shadow.slots.map(s=>({slot:s.slotLabel,starter:s.starter&&s.starter.name,decidedBy:s.decidedBy,trace:s.shadow||null})),authority:shadow.authority},null,2));
console.log("Automatic Rookie live adapter: PASS");
