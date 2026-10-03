"use strict";
const assert=require("assert");
const {buildAvailabilityImpact}=require("../netlify/functions/_super-sage-availability-impact");
const x=buildAvailabilityImpact({player:"Starter RB",status:"IR",team:"AAA",position:"RB",role:{rushSharePct:64,targetSharePct:12},replacement:{player:"Backup RB",rushSharePct:20},observedAt:"2026-10-02T20:00:00Z",source:"verified"});
assert.strictEqual(x.lostRole.rushSharePct,64);
assert.strictEqual(x.replacement.roleKnown,true);
assert.ok(x.rules.some(r=>/nominal backup/.test(r)));
assert.strictEqual(x.canChangeProductionRanking,false);
console.log("Super SAGE availability-impact assertions passed.");
