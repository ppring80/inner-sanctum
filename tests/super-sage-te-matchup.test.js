"use strict";
const assert=require("assert");
const {buildTeMatchupIntelligence}=require("../netlify/functions/_super-sage-te-matchup");
const x=buildTeMatchupIntelligence({player:"Test TE",offense:"AAA",defense:"BBB",schemeTeam:{source:"verified",sample:{dropbacks:120},defense:{middleOpenPct:48,zonePct:70},offense:{personnel12Pct:31}},opportunity:{targetsPerGame:6,targetSharePct:19,routeParticipationPct:78,redZoneTargetSharePct:24,sample:{games:3},source:"verified role"}});
assert.strictEqual(x.primaryInteraction,"middle-field-role");
assert.ok(x.advancedDetail.metrics.some(m=>m.label==="Route participation"));
assert.ok(x.progressiveDisclosure.prompt.includes("Test TE"));
assert.strictEqual(x.canChangeProductionRanking,false);
console.log("Super SAGE TE matchup intelligence assertions passed.");
