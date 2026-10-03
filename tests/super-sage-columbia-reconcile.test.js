"use strict";
const assert=require("assert");
const {reconcileColumbiaEvidence}=require("../netlify/functions/_super-sage-columbia-reconcile");
const x=reconcileColumbiaEvidence([
 {tributary:"defense-performance",concept:"pass-defense-weakness",claim:"poor EPA",direction:"favorable",source:"A"},
 {tributary:"wr-matchup",concept:"pass-defense-weakness",claim:"favorable matchup",direction:"favorable",source:"B"},
 {tributary:"injury",concept:"qb-protection",claim:"LT out",direction:"unfavorable",source:"C"},
 {tributary:"current-evidence",concept:"qb-protection",claim:"LT active",direction:"favorable",source:"D"}
]);
const p=x.concepts.find(c=>c.concept==="pass-defense-weakness");
assert.strictEqual(p.corroborated,true);
assert.ok(/not additive/.test(p.rule));
assert.ok(x.contradictions.includes("qb-protection"));
assert.strictEqual(x.canChangeProductionRanking,false);
console.log("Super SAGE Columbia reconciliation assertions passed.");
