"use strict";
const assert=require("assert");
const {buildQbMatchupIntelligence}=require("../netlify/functions/_super-sage-qb-matchup");
const x=buildQbMatchupIntelligence({
 qb:"Test QB",offense:"AAA",defense:"BBB",
 schemeTeam:{source:"Verified scheme source",sample:{dropbacks:120},defense:{zonePct:65,blitzPct:30,pressurePct:38},offense:{motionPct:55}},
 stressProfile:{all:{dropbacks:200,epaPerDropback:.18,scramblePct:7,explosivePct:12},disruptionProxyPct:25,disruptionProxy:{dropbacks:50,epaPerDropback:-.08,sackPct:12},noRecordedDisruptionProxy:{dropbacks:150,epaPerDropback:.27},pressureDefinition:"proxy"}
});
assert.strictEqual(x.primaryInteraction,"pressure-response");
assert.strictEqual(x.stressDeltaEpa,-.35);
assert.ok(x.advancedDetail.metrics.some(m=>m.label==="Defense charted pressure"));
assert.ok(x.progressiveDisclosure.prompt.includes("Test QB"));
assert.strictEqual(x.canChangeProductionRanking,false);
console.log("Super SAGE QB matchup intelligence assertions passed.");
