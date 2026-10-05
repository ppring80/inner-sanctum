"use strict";
const assert=require("assert");
const {createDecisionRecord}=require("../netlify/functions/_super-sage-decision-ledger");
const {buildLearningCaseFromOutcome}=require("../netlify/functions/_super-sage-learning-pipeline");
const {buildWeekPostmortem,postmortemText}=require("../netlify/functions/_super-sage-postmortem-presenter");
function packet(name,projection,actual,review){const d=createDecisionRecord({season:2026,week:4,player:{name,position:"RB"},decision:"START",createdAt:"2026-10-03T18:00:00Z",evidenceSnapshot:{projection:{points:projection}}});return buildLearningCaseFromOutcome(d,{outcome:{observedAt:"2026-10-05T23:30:00Z",actualFantasyPoints:actual,started:true},review});}
const injury=packet("Sound Start",15,1,{decisionQuality:"GOOD_DECISION",evidenceQuality:"GOOD",explanationQuality:"GOOD",varianceClass:"INJURY"});
const miss=packet("Missed Role",9,22,{decisionQuality:"BAD_DECISION",evidenceQuality:"MISSING",explanationQuality:"INCOMPLETE",varianceClass:"ROLE_SURPRISE",hypothesis:"React to verified teammate absence."});
const r=buildWeekPostmortem([injury,miss],{teamName:"The Vanilla Gorilla",season:2026,week:4});
assert.strictEqual(r.counts.reviewed,2);assert.strictEqual(r.counts.goodDecisions,1);assert.strictEqual(r.counts.badDecisions,1);assert.strictEqual(r.counts.injuryVariance,1);assert.strictEqual(r.counts.investigations,1);assert.strictEqual(r.expectation.projected,24);assert.strictEqual(r.expectation.actual,23);assert.strictEqual(r.productionChangeAllowed,false);
const t=postmortemText(r);assert.ok(t.includes("The Vanilla Gorilla"));assert.ok(t.includes("1 good"));assert.ok(t.includes("1 bad"));assert.ok(t.includes("No postgame result or learning case can automatically change production SAGE."));
console.log("Super SAGE Turbine #6 postmortem presenter assertions passed.");
