"use strict";
const assert=require("assert");
const {buildLiveShadowComparison,gradeLiveShadowComparison}=require("../netlify/functions/_super-sage-live-shadow");

const prod={slots:[
 {slotLabel:"QB",starter:{name:"Drake Maye"},decisionState:"RESOLVED",decidedBy:"production-weekly-sage",confidence:{label:"MODERATE"}},
 {slotLabel:"RB1",starter:{name:"Chase Brown"},decisionState:"RESOLVED",decidedBy:"production-weekly-sage",confidence:{label:"HIGH"}}
]};
const shadow={slots:[
 {slotLabel:"QB",starter:{name:"Drake Maye"},decisionState:"RESOLVED",decidedBy:"operator-shadow",confidence:{label:"HIGH"}},
 {slotLabel:"RB1",starter:{name:"Alternative RB"},decisionState:"RESOLVED",decidedBy:"operator-shadow",confidence:{label:"LOW"}}
]};
const c=buildLiveShadowComparison({season:2026,week:5,scoring:"half",productionRecord:prod,shadowRecord:shadow,decisionAt:"2026-10-06T18:00:00-07:00",caseLabel:"Live harness acceptance"});
assert.strictEqual(c.authority.customerDecision,"PRODUCTION_ONLY");
assert.strictEqual(c.authority.shadowCanChangeProduction,false);
assert.strictEqual(c.authority.providerCallsAllowed,false);
assert.strictEqual(c.authority.outcomeDataAllowed,false);
assert.strictEqual(c.summary.agreements,1);
assert.strictEqual(c.summary.disagreements,1);
assert.strictEqual(c.slots.find(x=>x.slotLabel==="QB").sameCall,true);
assert.strictEqual(c.slots.find(x=>x.slotLabel==="RB1").sameCall,false);
const reviewed=gradeLiveShadowComparison(c,{decisionQuality:"PASS_DIFFERENT_CALL",reasoningQuality:"QUESTIONABLE",explanationQuality:"PASS",notes:["Synthetic acceptance only; no NFL outcome used."]});
assert.strictEqual(reviewed.learning.decisionLabCandidate,true);
assert.strictEqual(reviewed.learning.automaticCodeChange,false);
console.log(JSON.stringify({suite:"Super SAGE Live Shadow Harness",summary:c.summary,authority:c.authority,review:reviewed.review,learning:reviewed.learning},null,2));
console.log("Super SAGE live shadow harness: PASS");
